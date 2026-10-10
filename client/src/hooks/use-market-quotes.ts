import { useEffect, useRef, useState, useCallback } from 'react';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { logger } from '@lark-apaas/client-toolkit/logger';
import type { QuoteResponse, Market } from '@shared/api.interface';

export type MarketPhase = 'trading' | 'pre' | 'post' | 'closed';

const TRADING_INTERVAL = 60 * 1000;         // 60s during trading
const PRE_POST_INTERVAL = 5 * 60 * 1000;    // 5min pre/post
const IDLE_INTERVAL = 10 * 60 * 1000;       // 10min closed

const MARKET_TIMEZONES: Record<Market, string> = {
  US: 'America/New_York',
  HK: 'Asia/Hong_Kong',
  CN: 'Asia/Shanghai',
};

type TimeSession = { start: number; end: number; phase: MarketPhase };

// Minute-of-day ranges (market-local time) for each market.
const MARKET_SESSIONS: Record<Market, TimeSession[]> = {
  US: [
    { start: 4 * 60, end: 9 * 60 + 30, phase: 'pre' },
    { start: 9 * 60 + 30, end: 16 * 60, phase: 'trading' },
    { start: 16 * 60, end: 20 * 60, phase: 'post' },
  ],
  HK: [
    { start: 9 * 60 + 30, end: 12 * 60, phase: 'trading' },
    { start: 13 * 60, end: 16 * 60, phase: 'trading' },
  ],
  CN: [
    { start: 9 * 60 + 30, end: 11 * 60 + 30, phase: 'trading' },
    { start: 13 * 60, end: 15 * 60, phase: 'trading' },
  ],
};

const ALL_MARKETS: Market[] = ['US', 'HK', 'CN'];

// Infer market from ticker: .HK / 5-digit numeric -> HK; 6-digit -> CN; else US.
export function inferMarket(ticker: string): Market {
  const clean = ticker.trim().toUpperCase();
  if (/\.HK$/.test(clean)) return 'HK';
  if (/^\d{5,6}$/.test(clean)) return clean.length === 6 ? 'CN' : 'HK';
  return 'US';
}

// Normalize a quote symbol to match local holding ticker format.
// - HK: "1810.HK" -> "01810" (5-digit, zero-padded); already 5-digit numeric -> as-is
// - US: pass through (e.g. "TQQQ", "MSFT")
// - CN: 6-digit numeric -> as-is
function normalizeQuoteSymbol(symbol: string, market: Market): string {
  const s = symbol.trim().toUpperCase();
  if (market === 'HK') {
    const dotHk = s.replace(/\.HK$/, '');
    if (/^\d+$/.test(dotHk)) {
      return dotHk.padStart(5, '0');
    }
    return s;
  }
  return s;
}

function getMarketLocalTime(market: Market, date: Date): {
  weekday: number; hour: number; minute: number;
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: MARKET_TIMEZONES[market],
    weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(date);
  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return {
    weekday: weekdayMap[get('weekday')] ?? 0,
    hour: parseInt(get('hour'), 10) || 0,
    minute: parseInt(get('minute'), 10) || 0,
  };
}

// Returns the current market phase (trading/pre/post/closed) for `market`.
export function isMarketTrading(market: Market, date?: Date): MarketPhase {
  const now = date ?? new Date();
  const { weekday, hour, minute } = getMarketLocalTime(market, now);

  // Weekend -> closed
  if (weekday === 0 || weekday === 6) return 'closed';

  const minuteOfDay = hour * 60 + minute;
  const sessions = MARKET_SESSIONS[market];

  for (const session of sessions) {
    if (minuteOfDay >= session.start && minuteOfDay < session.end) {
      return session.phase;
    }
  }
  return 'closed';
}

function intervalForPhase(phase: MarketPhase): number {
  if (phase === 'trading') return TRADING_INTERVAL;
  if (phase === 'pre' || phase === 'post') return PRE_POST_INTERVAL;
  return IDLE_INTERVAL;
}

type SubscribeCallback = (data: {
  quotes: Record<string, QuoteResponse>;
  marketStatus: Record<Market, MarketPhase>;
  marketErrors: Record<Market, boolean>;
  lastUpdated: Date | null;
}) => void;

// Singleton quote scheduler: all subscribers share tickers, quote cache, per-market timers.
class QuoteScheduler {
  private tickers = new Set<string>();
  private subscribers = new Map<SubscribeCallback, string[]>();
  private quotes: Record<string, QuoteResponse> = {};
  private marketStatus: Record<Market, MarketPhase> = {
    US: 'closed', HK: 'closed', CN: 'closed',
  };
  private marketErrors: Record<Market, boolean> = {
    US: false, HK: false, CN: false,
  };
  private marketLastUpdated: Record<Market, Date | null> = {
    US: null, HK: null, CN: null,
  };
  private lastUpdated: Date | null = null;
  private marketTimers: Record<Market, number | null> = { US: null, HK: null, CN: null };
  private marketNextRefresh: Record<Market, number> = { US: 0, HK: 0, CN: 0 };
  private visibilityHandler: (() => void) | null = null;
  private visible = true;
  private marketFetching: Record<Market, boolean> = { US: false, HK: false, CN: false };

  subscribe(tickers: string[], callback: SubscribeCallback): void {
    const prevSize = this.tickers.size;
    const uniqueTickers = Array.from(new Set(tickers));
    for (const t of uniqueTickers) this.tickers.add(t);
    this.subscribers.set(callback, uniqueTickers);

    // Recompute phases for all markets with tickers.
    this.refreshMarketStatus();

    callback({
      quotes: this.quotes,
      marketStatus: { ...this.marketStatus },
      marketErrors: { ...this.marketErrors },
      lastUpdated: this.lastUpdated,
    });

    if (this.visibilityHandler === null) this.startVisibilityListener();
    this.scheduleAllMarkets();
    if (this.tickers.size > prevSize && this.visible) {
      // Immediately fetch markets that gained new tickers.
      const grouped = this.groupTickersByMarket();
      for (const m of ALL_MARKETS) {
        if (grouped[m].length > 0 && this.marketLastUpdated[m] === null) {
          void this.fetchMarketBatch(m);
        }
      }
    }
  }

  unsubscribe(callback: SubscribeCallback): void {
    this.subscribers.delete(callback);
    if (this.subscribers.size === 0) {
      this.tickers.clear();
      this.stopAllTimers();
      this.stopVisibilityListener();
      return;
    }
    // Rebuild ticker set from remaining subscribers.
    this.rebuildTickers();
    this.scheduleAllMarkets();
  }

  private rebuildTickers(): void {
    this.tickers.clear();
    for (const ts of this.subscribers.values()) {
      for (const t of ts) this.tickers.add(t);
    }
  }

  refresh(): void {
    const grouped = this.groupTickersByMarket();
    for (const m of ALL_MARKETS) {
      if (grouped[m].length > 0) void this.fetchMarketBatch(m);
    }
  }

  // ---- internals ----

  private groupTickersByMarket(): Record<Market, string[]> {
    const result: Record<Market, string[]> = { US: [], HK: [], CN: [] };
    for (const t of this.tickers) result[inferMarket(t)].push(t);
    return result;
  }

  private refreshMarketStatus(): void {
    for (const m of ALL_MARKETS) {
      this.marketStatus[m] = isMarketTrading(m);
    }
  }

  private startVisibilityListener(): void {
    if (typeof document === 'undefined') return;
    this.visibilityHandler = () => {
      this.visible = document.visibilityState === 'visible';
      if (this.visible) {
        // Page became visible — refresh immediately and restart all timers.
        this.stopAllTimers();
        const grouped = this.groupTickersByMarket();
        const fetches: Promise<void>[] = [];
        for (const m of ALL_MARKETS) {
          if (grouped[m].length > 0) {
            fetches.push(this.fetchMarketBatch(m));
          }
        }
        Promise.all(fetches).finally(() => this.scheduleAllMarkets());
      } else {
        this.stopAllTimers();
      }
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);
    this.visible = document.visibilityState === 'visible';
  }

  private stopVisibilityListener(): void {
    if (this.visibilityHandler && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
  }

  private stopAllTimers(): void {
    for (const m of ALL_MARKETS) {
      if (this.marketTimers[m] !== null) {
        window.clearTimeout(this.marketTimers[m]);
        this.marketTimers[m] = null;
      }
    }
  }

  private stopMarketTimer(market: Market): void {
    if (this.marketTimers[market] !== null) {
      window.clearTimeout(this.marketTimers[market]);
      this.marketTimers[market] = null;
    }
  }

  private scheduleAllMarkets(): void {
    if (!this.visible) return;
    const grouped = this.groupTickersByMarket();
    for (const m of ALL_MARKETS) {
      if (grouped[m].length > 0) {
        this.scheduleMarket(m);
      } else {
        this.stopMarketTimer(m);
      }
    }
  }

  private scheduleMarket(market: Market): void {
    this.stopMarketTimer(market);
    if (!this.visible) return;
    const phase = isMarketTrading(market);
    // Also update stored phase (it may have changed since last check).
    this.marketStatus[market] = phase;
    const interval = intervalForPhase(phase);
    this.marketNextRefresh[market] = Date.now() + interval;
    this.marketTimers[market] = window.setTimeout(() => {
      void this.fetchMarketBatch(market).finally(() => {
        this.scheduleMarket(market);
      });
    }, interval);
  }

  private async fetchMarketBatch(market: Market): Promise<void> {
    if (!this.visible) return;
    if (this.marketFetching[market]) return;

    const grouped = this.groupTickersByMarket();
    const symbols = grouped[market];
    if (symbols.length === 0) return;

    this.marketFetching[market] = true;

    // Recompute market phase independently of fetch result.
    this.marketStatus[market] = isMarketTrading(market);

    try {
      const resp = await axiosForBackend.get<{ items: QuoteResponse[] }>('/api/quote/batch', {
        params: { symbols: symbols.join(',') },
      });
      const items = resp.data?.items;
      if (!Array.isArray(items)) {
        logger.warn(`行情响应格式异常 (${market})`, resp.data);
        this.marketErrors[market] = true;
      } else {
        let gotAny = false;
        for (const q of items) {
          if (!q || typeof q.price === 'undefined' || q.price === null) continue;
          const rawSym = q.symbol;
          const normSym = normalizeQuoteSymbol(rawSym, q.market ?? market);
          this.quotes[rawSym] = q;
          if (normSym !== rawSym) {
            this.quotes[normSym] = q;
          }
          gotAny = true;
        }
        this.marketErrors[market] = !gotAny;
        if (gotAny) {
          this.marketLastUpdated[market] = new Date();
        }
      }
    } catch (err) {
      logger.warn(`行情请求失败 (${market})`, err);
      // Keep last prices; marketStatus unchanged.
      this.marketErrors[market] = true;
    } finally {
      this.marketFetching[market] = false;
      this.updateGlobalLastUpdated();
      this.emit();
    }
  }

  private updateGlobalLastUpdated(): void {
    let latest: Date | null = null;
    for (const m of ALL_MARKETS) {
      const t = this.marketLastUpdated[m];
      if (t !== null && (latest === null || t > latest)) latest = t;
    }
    this.lastUpdated = latest;
  }

  private emit(): void {
    if (this.subscribers.size === 0) return;
    const payload = {
      quotes: { ...this.quotes },
      marketStatus: { ...this.marketStatus },
      marketErrors: { ...this.marketErrors },
      lastUpdated: this.lastUpdated,
    };
    for (const cb of this.subscribers.keys()) {
      try {
        cb(payload);
      } catch (err) {
        logger.error('行情订阅回调异常', err);
      }
    }
  }

  // ---- diagnostic ----

  getMarketStatus(): {
    utcNow: string;
    markets: Record<Market, {
      phase: MarketPhase; timezone: string; localTime: string;
      weekday: number; nextRefresh: number;
      lastUpdated: Date | null; error: boolean; tickerCount: number;
    }>;
  } {
    const now = new Date();
    const grouped = this.groupTickersByMarket();
    const markets = {} as Record<Market, {
      phase: MarketPhase; timezone: string; localTime: string;
      weekday: number; nextRefresh: number;
      lastUpdated: Date | null; error: boolean; tickerCount: number;
    }>;
    for (const m of ALL_MARKETS) {
      const local = getMarketLocalTime(m, now);
      const hh = local.hour < 10 ? `0${local.hour}` : String(local.hour);
      const mm = local.minute < 10 ? `0${local.minute}` : String(local.minute);
      markets[m] = {
        phase: isMarketTrading(m, now),
        timezone: MARKET_TIMEZONES[m],
        localTime: `${hh}:${mm}`,
        weekday: local.weekday,
        nextRefresh: this.marketNextRefresh[m],
        lastUpdated: this.marketLastUpdated[m],
        error: this.marketErrors[m],
        tickerCount: grouped[m].length,
      };
    }
    return { utcNow: now.toISOString(), markets };
  }
}

const ALL_MARKETS_EXPORT: Market[] = ['US', 'HK', 'CN'];

// Module-level singleton.
const scheduler = new QuoteScheduler();

export function getAggregateMarketStatus(): {
  anyTrading: boolean;
  statuses: Record<Market, MarketPhase>;
} {
  const statuses = {} as Record<Market, MarketPhase>;
  let anyTrading = false;
  for (const m of ALL_MARKETS_EXPORT) {
    const phase = isMarketTrading(m);
    statuses[m] = phase;
    if (phase === 'trading') anyTrading = true;
  }
  return { anyTrading, statuses };
}

export function forceRefreshAllQuotes(): void {
  scheduler.refresh();
}

// Expose diagnostic API on window (extend existing __pt if present).
if (typeof window !== 'undefined') {
  const w = window as unknown as { __pt?: Record<string, unknown> };
  if (!w.__pt) w.__pt = {};
  w.__pt.getMarketStatus = () => scheduler.getMarketStatus();
}

// ---- Hook ----

export function useMarketQuotes(tickers: string[]): {
  quotes: Record<string, QuoteResponse>;
  marketStatus: Record<Market, MarketPhase>;
  marketErrors: Record<Market, boolean>;
  lastUpdated: Date | null;
  refresh: () => void;
} {
  const [quotes, setQuotes] = useState<Record<string, QuoteResponse>>({});
  const [marketStatus, setMarketStatus] = useState<Record<Market, MarketPhase>>({
    US: 'closed', HK: 'closed', CN: 'closed',
  });
  const [marketErrors, setMarketErrors] = useState<Record<Market, boolean>>({
    US: false, HK: false, CN: false,
  });
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const tickersRef = useRef<string[]>([]);

  const callbackRef = useRef<SubscribeCallback | null>(null);

  const refresh = useCallback(() => {
    scheduler.refresh();
  }, []);

  useEffect(() => {
    const next = tickers.slice();

    // If previous subscription exists, clean it up first.
    if (callbackRef.current) {
      scheduler.unsubscribe(callbackRef.current);
      callbackRef.current = null;
    }

    if (next.length === 0) {
      tickersRef.current = [];
      return;
    }

    const cb: SubscribeCallback = ({
      quotes: qs,
      marketStatus: ms,
      marketErrors: me,
      lastUpdated: lu,
    }) => {
      setQuotes(qs);
      setMarketStatus(ms);
      setMarketErrors(me);
      setLastUpdated(lu);
    };

    callbackRef.current = cb;
    tickersRef.current = next;
    scheduler.subscribe(next, cb);

    return () => {
      if (callbackRef.current) {
        scheduler.unsubscribe(callbackRef.current);
        callbackRef.current = null;
      }
      tickersRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickers.join(',')]);

  return { quotes, marketStatus, marketErrors, lastUpdated, refresh };
}
