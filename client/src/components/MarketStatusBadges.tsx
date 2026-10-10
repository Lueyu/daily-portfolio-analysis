/**
 * @file components/MarketStatusBadges.tsx
 * @description Per-market phase badges (US/HK/CN) rendered on quote-bearing pages.
 *
 * Visual encoding:
 *  - trading = green, pre = blue, post = orange, closed = muted gray.
 *  - Markets with no holdings/watch items are dimmed and labeled "未持仓".
 *  - A red "!" + dot marks markets whose last quote fetch failed (stale data).
 *  - The "最后更新 HH:mm:ss" line shows the last successful quote refresh.
 */
import { Badge } from '@/components/ui/badge';
import { formatTime, cn } from '@/utils/format';
import type { Market } from '@shared/api.interface';
import type { MarketPhase } from '@/hooks/use-market-quotes';

/** Markets the app tracks, in display order. */
const MARKETS: Market[] = ['US', 'HK', 'CN'];

/** Chinese display labels per market. */
const MARKET_LABELS: Record<Market, string> = {
  US: '美股',
  HK: '港股',
  CN: 'A股',
};

/** Phase -> label + Tailwind classes used to render each badge. */
const PHASE_LABELS: Record<MarketPhase, { label: string; className: string }> = {
  trading: {
    label: '交易中',
    className: 'bg-success/15 text-success border-transparent',
  },
  pre: {
    label: '盘前',
    className: 'bg-blue-500/15 text-blue-600 border-transparent',
  },
  post: {
    label: '盘后',
    className: 'bg-orange-500/15 text-orange-600 border-transparent',
  },
  closed: {
    label: '休市',
    className: 'bg-muted text-muted-foreground border-transparent',
  },
};

/** Props for {@link MarketStatusBadges}. */
export interface MarketStatusBadgesProps {
  /** Current trading phase per market, as streamed by useMarketQuotes. */
  marketStatus: Record<Market, MarketPhase>;
  /** Whether the most recent quote fetch failed per market (stale-data flag). */
  marketErrors: Record<Market, boolean>;
  /** Timestamp of the last successful quote refresh; null before first fetch. */
  lastUpdated: Date | null;
  /** Markets that have no holdings/watch items — show dimmed "未持仓" state */
  inactiveMarkets?: Market[];
  /** Layout variant — badges inline with time or stacked */
  layout?: 'inline' | 'stack';
}

/**
 * Render one badge per market showing its current session phase.
 * @param props - See {@link MarketStatusBadgesProps}.
 */
export function MarketStatusBadges({
  marketStatus,
  marketErrors,
  lastUpdated,
  inactiveMarkets = [],
  layout = 'inline',
}: MarketStatusBadgesProps) {
  const inactiveSet = new Set(inactiveMarkets);

  const badges = MARKETS.map((market) => {
    const isInactive = inactiveSet.has(market);
    const hasError = marketErrors[market] === true;
    const phase = marketStatus[market];
    const phaseInfo = PHASE_LABELS[phase];

    const badgeClass = isInactive
      ? 'bg-muted/50 text-muted-foreground/50 border-transparent'
      : phaseInfo.className;

    const label = isInactive ? '未持仓' : phaseInfo.label;

    return (
      <div key={market} className="relative inline-flex items-center">
        <Badge
          variant="outline"
          className={cn(
            'h-5 px-2 text-[11px] font-medium',
            badgeClass
          )}
        >
          {MARKET_LABELS[market]}·{label}
          {hasError && !isInactive && (
            <span className="ml-1 text-destructive font-bold">!</span>
          )}
        </Badge>
        {hasError && !isInactive && (
          <span
            className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-destructive"
            aria-label="行情延迟"
          />
        )}
      </div>
    );
  });

  if (layout === 'stack') {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-1.5">{badges}</div>
        {lastUpdated && (
          <span className="text-xs text-muted-foreground">
            最后更新 {formatTime(lastUpdated)}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {badges}
      {lastUpdated && (
        <>
          <span className="mx-0.5 text-muted-foreground">·</span>
          <span className="text-xs text-muted-foreground">
            最后更新 {formatTime(lastUpdated)}
          </span>
        </>
      )}
    </div>
  );
}
