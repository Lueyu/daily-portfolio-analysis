/**
 * @file server/common/market-clock.ts
 * @description Market trading-session clock (server-side).
 *
 * Session windows mirror the client definition (use-market-quotes.ts):
 *   US 09:30–16:00 America/New_York · HK 09:30–12:00 / 13:00–16:00
 *   Asia/Hong_Kong · CN 09:30–11:30 / 13:00–15:00 Asia/Shanghai
 * Weekends are always closed. Lunch breaks are honored for HK/CN; US
 * holidays are not (a free self-hosted bot tolerates the approximation).
 *
 * Local wall-clock resolution uses Intl with explicit IANA zones — no
 * dependency on the host machine's timezone.
 */
import type { Market } from '@shared/api.interface';

/** A trading session as minute-of-day (market-local) bounds. */
interface SessionWindow {
  start: number;
  end: number;
}

const MARKET_TIMEZONES: Record<Market, string> = {
  US: 'America/New_York',
  HK: 'Asia/Hong_Kong',
  CN: 'Asia/Shanghai',
};

const MARKET_SESSIONS: Record<Market, SessionWindow[]> = {
  US: [{ start: 9 * 60 + 30, end: 16 * 60 }],
  HK: [
    { start: 9 * 60 + 30, end: 12 * 60 },
    { start: 13 * 60, end: 16 * 60 },
  ],
  CN: [
    { start: 9 * 60 + 30, end: 11 * 60 + 30 },
    { start: 13 * 60, end: 15 * 60 },
  ],
};

/** Parts of a market-local wall clock. */
interface LocalClock {
  weekday: number;
  minuteOfDay: number;
}

/** Resolve the market-local wall clock for a UTC instant. */
function localClock(timezone: string, now: Date): LocalClock {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const hour = Number(parts.hour === '24' ? '0' : parts.hour);
  return {
    weekday: weekdays.indexOf(parts.weekday),
    minuteOfDay: hour * 60 + Number(parts.minute),
  };
}

/** Whether the market is in its continuous trading session right now. */
export function isMarketOpen(market: Market, now: Date = new Date()): boolean {
  const clock = localClock(MARKET_TIMEZONES[market], now);
  if (clock.weekday === 0 || clock.weekday === 6) return false;
  return MARKET_SESSIONS[market].some(
    (s) => clock.minuteOfDay >= s.start && clock.minuteOfDay < s.end,
  );
}

/** Whether at least one of the three markets is currently trading. */
export function anyMarketOpen(now: Date = new Date()): boolean {
  return (['US', 'HK', 'CN'] as Market[]).some((m) => isMarketOpen(m, now));
}
