/**
 * @file pages/Dashboard/DashboardPage.tsx
 * @description Route `/`: portfolio overview landing page.
 *
 * Sections:
 *  - Top metric cards (account value, market value, cost, cash, cumulative P/L, return %)
 *  - AI analysis status card (running / awaiting-human / completed counts,
 *    latest rating, hard-rule risk-gate failures)
 *  - Daily P/L chart + per-holding P/L breakdown (DailyPlChart / DailyPnLBreakdown)
 *  - Holdings grouped by market (table on desktop, cards on mobile)
 *  - Cash balances by currency
 *
 * Data: parallel-fetches overview, holdings and daily P/L; subscribes to live
 * quotes via `useMarketQuotes`; reloads on the global `portfolio-updated` event
 * so any mutating page can trigger a refresh.
 */
import { useMemo, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  TrendingUp,
  Wallet,
  PiggyBank,
  DollarSign,
  BarChart3,
  PieChart,
  ChevronDown,
  RefreshCw,
  Clock,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Eye,
} from 'lucide-react';
import http from '@/api/http';
import { toast } from 'sonner';
import { fetchDashboard, fetchHoldings, fetchDailyPl, logger, getAgentRuns } from '@/api';
import type {
  DashboardOverview,
  GroupSummary,
  Holding,
  Currency,
  Market,
  AgentRunWithRating,
  RiskGateResult,
} from '@shared/api.interface';
import RatingBadge from '@/components/MultiAgent/RatingBadge';
import ConfidenceBadge from '@/components/MultiAgent/ConfidenceBadge';
import { useMarketQuotes } from '@/hooks/use-market-quotes';
import { MarketStatusBadges } from '@/components/MarketStatusBadges';
import {
  formatCurrencyWithCode,
  formatPercent,
  formatNumber,
  formatTime,
  plClass,
  cn,
} from '@/utils/format';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from '@/components/ui/empty';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import DailyPlChart from './DailyPlChart';
import DailyPnLBreakdown from './DailyPnLBreakdown';
import { Badge } from '@/components/ui/badge';

/**
 * Pick a display company name, returning null when the name is effectively
 * the same as the ticker (case-insensitive, before any dot suffix).
 * @param company - Company name from the holding record.
 * @param ticker - Holding ticker.
 * @returns The display name, or null when it duplicates the ticker.
 */
function displayCompany(
  company: string | null | undefined,
  ticker: string,
): string | null {
  const name = (company ?? '').trim();
  if (!name) return null;
  const base = (s: string): string => s.split('.')[0].toUpperCase();
  if (base(name) === base(ticker)) return null;
  return name;
}

/** Shape of a dashboard metric card config. */
interface MetricCard {
  label: string;
  icon: typeof Wallet;
  key: keyof Pick<
    DashboardOverview,
    'accountValue' | 'totalMv' | 'cost' | 'cash' | 'totalPl' | 'totalPct'
  >;
  format: (v: string | number | null | undefined, c: string) => string;
  large?: boolean;
  pl?: boolean;
  percent?: boolean;
}

/** Selectable base (reporting) currencies for converted amounts. */
const CURRENCY_OPTIONS: { value: Currency; label: string }[] = [
  { value: 'USD', label: 'USD / 美元' },
  { value: 'HKD', label: 'HKD / 港币' },
  { value: 'CNY', label: 'CNY / 人民币' },
];

/** Props for {@link RealtimeBadge}. */
interface RealtimeBadgeProps {
  marketStatus: Record<string, string>;
  holdings: Holding[];
}

/**
 * Show "实时" (live, pulsing green) when any held market is in pre/regular/post
 * trading, otherwise "已收盘" (closed).
 */
function RealtimeBadge({ marketStatus, holdings }: RealtimeBadgeProps) {
  const heldMarkets = new Set(holdings.map((h: Holding) => h.market));
  const heldActive = Array.from(heldMarkets).filter(
    (m) => marketStatus[m] === 'trading' || marketStatus[m] === 'pre' || marketStatus[m] === 'post'
  );
  const isRealtime = heldActive.length > 0;
  return (
    <Badge
      variant="outline"
      className={cn(
        'h-5 px-2 text-[11px] font-medium',
        isRealtime
          ? 'bg-success/15 text-success border-transparent'
          : 'bg-muted text-muted-foreground border-transparent'
      )}
    >
      <span className={cn(
        'mr-1 inline-block size-1.5 rounded-full',
        isRealtime ? 'bg-success animate-pulse' : 'bg-muted-foreground/50'
      )} />
      {isRealtime ? '实时' : '已收盘'}
    </Badge>
  );
}

/**
 * Dashboard landing component.
 *
 * State: overview payload, holdings list, daily P/L series, selected base
 * currency, P/L window length, today's agent runs, and hard-rule failure count.
 */
export default function DashboardPage() {
  const [dashboard, setDashboard] = useState<DashboardOverview | null>(null);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [dailyPl, setDailyPl] = useState<
    Array<{ date: string; accountValue: string; dailyPl: string; dailyPct: string }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [baseCurrency, setBaseCurrency] = useState<Currency>('USD');
  const [plRange, setPlRange] = useState<number>(30);
  const [agentRuns, setAgentRuns] = useState<AgentRunWithRating[]>([]);
  const [agentRunsLoading, setAgentRunsLoading] = useState(true);
  const [hardRuleFailures, setHardRuleFailures] = useState<number>(0);
  const [riskGateLoading, setRiskGateLoading] = useState(true);

  const tickers = useMemo(
    () => holdings.map((h) => h.ticker),
    [holdings]
  );

  const { quotes, marketStatus, marketErrors, lastUpdated } = useMarketQuotes(tickers);

  /**
   * Parallel-fetch overview, holdings and daily P/L for the given currency and
   * window. Errors surface a toast; `loading` is cleared in `finally`.
   */
  const loadData = async (currency: Currency, range: number) => {
    try {
      const [dashData, holdingsData, plData] = await Promise.all([
        fetchDashboard(currency),
        fetchHoldings(),
        fetchDailyPl(range, currency),
      ]);
      setDashboard(dashData);
      setHoldings(holdingsData || []);
      setDailyPl(plData || []);
    } catch (error) {
      logger.error('加载仪表盘失败', error);
      toast.error('加载失败，请刷新重试');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    loadData(baseCurrency, plRange).then(() => {
      if (!mounted) return;
    });

    const handleUpdate = () => {
      if (!mounted) return;
      setLoading(true);
      loadData(baseCurrency, plRange);
    };
    window.addEventListener('portfolio-updated', handleUpdate);

    return () => {
      mounted = false;
      window.removeEventListener('portfolio-updated', handleUpdate);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseCurrency, plRange]);

  const metricCards: MetricCard[] = useMemo(
    () => [
      {
        label: '账户总值',
        icon: Wallet,
        key: 'accountValue',
        format: formatCurrencyWithCode,
        large: true,
      },
      {
        label: '总市值',
        icon: TrendingUp,
        key: 'totalMv',
        format: formatCurrencyWithCode,
      },
      {
        label: '总成本',
        icon: PiggyBank,
        key: 'cost',
        format: formatCurrencyWithCode,
      },
      {
        label: '现金总额',
        icon: DollarSign,
        key: 'cash',
        format: formatCurrencyWithCode,
      },
      {
        label: '累计浮盈亏',
        icon: BarChart3,
        key: 'totalPl',
        format: formatCurrencyWithCode,
        pl: true,
      },
      {
        label: '累计收益率',
        icon: PieChart,
        key: 'totalPct',
        format: (v) => formatPercent(v),
        pl: true,
        percent: true,
      },
    ],
    []
  );

  /** Group-level summaries sorted by market value (desc) for the market table. */
  const sortedMarkets = useMemo<GroupSummary[]>(() => {
    if (!dashboard?.groups) return [];
    return [...dashboard.groups].sort(
      (a, b) => Number(b.marketValue) - Number(a.marketValue)
    );
  }, [dashboard]);

  /** Most recent day's P/L and percent from the daily series. */
  const dailyPlTotal = useMemo(() => {
    if (!dailyPl || dailyPl.length === 0) return { pl: '0', pct: '0' };
    const latest = dailyPl[dailyPl.length - 1];
    return { pl: latest.dailyPl, pct: latest.dailyPct };
  }, [dailyPl]);

  /** Bucket holdings by their market, used to render per-market mobile cards. */
  const holdingsByMarket = useMemo(() => {
    const map = new Map<string, Holding[]>();
    for (const h of holdings) {
      const mkt = h.market || 'US';
      const list = map.get(mkt) ?? [];
      list.push(h);
      map.set(mkt, list);
    }
    return map;
  }, [holdings]);

  /** Tally today's agent runs into running / awaiting-human / completed buckets. */
  const runStats = useMemo(() => {
    const stats = {
      running: 0,
      awaiting: 0,
      completed: 0,
    };
    for (const run of agentRuns) {
      if (run.status === 'completed') {
        stats.completed += 1;
      } else if (run.status === 'awaiting_human') {
        stats.awaiting += 1;
      } else if (
        run.status === 'pending' ||
        run.status === 'fetching' ||
        run.status === 'debating' ||
        run.status === 'critiquing' ||
        run.status === 'risk_check'
      ) {
        stats.running += 1;
      }
    }
    return stats;
  }, [agentRuns]);

  /** Pick the first completed run that has a rating, for the "latest" card. */
  const latestCompletedRun = useMemo(() => {
    const completed = agentRuns.filter(
      (r: AgentRunWithRating) => r.status === 'completed' && r.rating
    );
    return completed.length > 0 ? completed[0] : null;
  }, [agentRuns]);

  // Load today's agent runs and tally hard-rule risk-gate failures.
  useEffect(() => {
    let mounted = true;
    const today = new Date().toISOString().split('T')[0];

    const loadRuns = async () => {
      try {
        setAgentRunsLoading(true);
        setRiskGateLoading(true);
        const data = await getAgentRuns({
          from: today,
          to: today,
          limit: 20,
        });
        if (!mounted) return;
        const items: AgentRunWithRating[] = data?.items ?? [];
        setAgentRuns(items);

        const completedIds = items
          .filter((r: AgentRunWithRating) => r.status === 'completed')
          .map((r: AgentRunWithRating) => r.id);

        if (completedIds.length === 0) {
          setHardRuleFailures(0);
          setRiskGateLoading(false);
          return;
        }

        const results = await Promise.all(
          completedIds.map(async (id: string) => {
            try {
              const res = await http({
                url: `/api/multi-agent/runs/${id}/risk-gate`,
                method: 'GET',
              });
              return (res.data as RiskGateResult[]) || [];
            } catch {
              return [] as RiskGateResult[];
            }
          })
        );
        if (!mounted) return;

        let failures = 0;
        for (const gate of results) {
          for (const rule of gate) {
            if (rule.ruleType === 'hard' && !rule.passed) {
              failures += 1;
            }
          }
        }
        setHardRuleFailures(failures);
      } catch (error) {
        logger.error('加载 AI 分析状态失败', error);
      } finally {
        if (mounted) {
          setAgentRunsLoading(false);
          setRiskGateLoading(false);
        }
      }
    };

    loadRuns();

    return () => {
      mounted = false;
    };
  }, []);



  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-3 md:flex-row md:items-center">
        <div>
          <h1 className="font-serif text-3xl font-semibold tracking-tight text-foreground">
            投资仪表盘
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
            <MarketStatusBadges
              marketStatus={marketStatus}
              marketErrors={marketErrors}
              lastUpdated={lastUpdated}
            />
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            全资产概览、按市场分组与每日盈亏
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={baseCurrency}
            onValueChange={(v) => setBaseCurrency(v as Currency)}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="选择本位币" />
            </SelectTrigger>
            <SelectContent>
              {CURRENCY_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
        {loading
          ? Array.from({ length: 6 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-4">
                  <Skeleton className="mb-2 h-4 w-16" />
                  <Skeleton className="h-7 w-24" />
                </CardContent>
              </Card>
            ))
          : metricCards.map((m) => {
              const value = dashboard ? dashboard[m.key] : '0';
              const colorCls = m.pl ? plClass(value) : 'text-foreground';
              const displayValue = m.percent
                ? formatPercent(value)
                : formatCurrencyWithCode(value, baseCurrency);
              return (
                <Card key={m.key}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <m.icon size={14} className="text-primary" />
                      <span>{m.label}</span>
                    </div>
                    <div
                      className={cn(
                        'mt-1.5 font-mono tabular-nums font-semibold',
                        m.large ? 'text-xl md:text-2xl' : 'text-lg',
                        colorCls
                      )}
                    >
                      {displayValue}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-primary" />
                <CardTitle className="font-serif text-base">AI 分析状态</CardTitle>
              </div>
              <Link
                to="/analysis"
                className="flex items-center gap-0.5 text-xs text-primary hover:underline"
              >
                查看全部
                <ChevronDown size={12} className="-rotate-90" />
              </Link>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {agentRunsLoading ? (
              <div className="space-y-3">
                <div className="flex gap-3">
                  <Skeleton className="h-10 flex-1" />
                  <Skeleton className="h-10 flex-1" />
                  <Skeleton className="h-10 flex-1" />
                </div>
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-9 w-full" />
              </div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-md border border-border bg-muted/30 p-2 text-center">
                    <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
                      <Loader2 size={11} className="animate-spin text-primary" />
                      进行中
                    </div>
                    <div className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-foreground">
                      {runStats.running}
                    </div>
                  </div>
                  <div className="rounded-md border border-border bg-muted/30 p-2 text-center">
                    <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
                      <Eye size={11} className="text-amber-500" />
                      待决策
                    </div>
                    <div className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-amber-600">
                      {runStats.awaiting}
                    </div>
                  </div>
                  <div className="rounded-md border border-border bg-muted/30 p-2 text-center">
                    <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
                      <CheckCircle2 size={11} className="text-emerald-500" />
                      已完成
                    </div>
                    <div className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-emerald-600">
                      {runStats.completed}
                    </div>
                  </div>
                </div>

                <div className="rounded-md border border-border p-3">
                  <div className="mb-1.5 text-xs text-muted-foreground">最近完成</div>
                  {latestCompletedRun?.rating ? (
                    <div className="flex items-center justify-between">
                      <div className="font-medium text-foreground">
                        {latestCompletedRun.ticker}
                        {latestCompletedRun.tickerName && (
                          <span className="ml-1.5 text-xs text-muted-foreground">
                            {latestCompletedRun.tickerName}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <RatingBadge
                          rating={latestCompletedRun.rating.rating}
                          size="sm"
                        />
                        <ConfidenceBadge
                          confidence={latestCompletedRun.rating.confidence}
                          size="sm"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">今日暂无完成的分析</div>
                  )}
                </div>

                <div className="rounded-md border border-border p-3">
                  <div className="mb-1.5 text-xs text-muted-foreground">风控告警</div>
                  {riskGateLoading ? (
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-4 w-32" />
                    </div>
                  ) : hardRuleFailures > 0 ? (
                    <div className="flex items-center gap-2">
                      <AlertTriangle size={14} className="text-amber-500" />
                      <span className="text-sm font-medium text-amber-700">
                        {hardRuleFailures} 条硬规则未通过
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <CheckCircle2 size={14} className="text-emerald-500" />
                      <span className="text-sm font-medium text-emerald-700">
                        全部通过
                      </span>
                    </div>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <div className="flex flex-row items-center justify-between">
              <div className="flex items-center gap-2">
                <CardTitle className="font-serif text-lg">每日盈亏概览</CardTitle>
              {lastUpdated && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock size={12} />
                  最后更新 {formatTime(lastUpdated)}
                </span>
              )}
              <RealtimeBadge marketStatus={marketStatus} holdings={holdings} />
            </div>
            <Select value={String(plRange)} onValueChange={(v) => setPlRange(parseInt(v, 10))}>
              <SelectTrigger className="w-[110px]">
                <SelectValue placeholder="时间范围" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">近 7 日</SelectItem>
                <SelectItem value="30">近 30 日</SelectItem>
                <SelectItem value="90">近 90 日</SelectItem>
                <SelectItem value="180">近 180 日</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-4">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-[280px] w-full" />
            </div>
          ) : (
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
                <div>
                  <div className="text-xs text-muted-foreground">当日盈亏 ({baseCurrency})</div>
                  <div
                    className={cn(
                      'mt-1 font-mono text-2xl font-semibold tabular-nums',
                      plClass(dailyPlTotal.pl)
                    )}
                  >
                    {formatCurrencyWithCode(dailyPlTotal.pl, baseCurrency)}
                  </div>
                  <div
                    className={cn(
                      'mt-0.5 font-mono text-xs tabular-nums',
                      plClass(dailyPlTotal.pct)
                    )}
                  >
                    {formatPercent(dailyPlTotal.pct)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">最新净值</div>
                  <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-foreground">
                    {dailyPl.length > 0
                      ? formatCurrencyWithCode(dailyPl[dailyPl.length - 1].accountValue, baseCurrency)
                      : '—'}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    账户总值
                  </div>
                </div>
                <div className="hidden md:block">
                  <div className="text-xs text-muted-foreground">当日收益率</div>
                  <div
                    className={cn(
                      'mt-1 font-mono text-2xl font-semibold tabular-nums',
                      plClass(dailyPlTotal.pct)
                    )}
                  >
                    {formatPercent(dailyPlTotal.pct)}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    较前一交易日
                  </div>
                </div>
              </div>
              <DailyPlChart data={dailyPl} baseCurrency={baseCurrency} />
              <div className="border-t border-border pt-4">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-medium">当日盈亏明细</h3>
                  <span className="text-xs text-muted-foreground">
                    按盈亏额降序 · 共 {holdings.length} 只持仓
                  </span>
                </div>
                <DailyPnLBreakdown
                  holdings={holdings}
                  quotes={quotes}
                  baseCurrency={baseCurrency}
                  loading={loading || (holdings.length > 0 && Object.keys(quotes).length === 0)}
                />
              </div>
            </div>
          )}
        </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between pb-3">
          <CardTitle className="font-serif text-lg">按市场分组</CardTitle>
          <span className="text-xs text-muted-foreground">
            按市值排序 · 共 {sortedMarkets.length} 个市场
          </span>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : sortedMarkets.length === 0 ? (
            <Empty className="py-10">
              <EmptyHeader>
                <EmptyTitle>暂无市场数据</EmptyTitle>
                <EmptyDescription>添加持仓后这里将显示按市场的汇总信息</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="space-y-6">
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>市场</TableHead>
                      <TableHead className="text-right">持仓数</TableHead>
                      <TableHead className="text-right">市值 (原币种)</TableHead>
                      <TableHead className="text-right">成本</TableHead>
                      <TableHead className="text-right">浮盈亏</TableHead>
                      <TableHead className="text-right">收益率</TableHead>
                      <TableHead className="text-right">市值占比</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedMarkets.map((g) => (
                      <TableRow key={g.groupId || 'unknown'}>
                        <TableCell>
                          <span className="font-medium">{g.groupName || '未分组'}</span>
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatNumber(g.count, 0)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatCurrencyWithCode(g.marketValue, baseCurrency)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatCurrencyWithCode(g.cost, baseCurrency)}
                        </TableCell>
                        <TableCell
                          className={cn('text-right font-mono tabular-nums', plClass(g.pl))}
                        >
                          {formatCurrencyWithCode(g.pl, baseCurrency)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            'text-right font-mono tabular-nums',
                            plClass(g.returnPct)
                          )}
                        >
                          {formatPercent(g.returnPct)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                          {formatPercent(g.weight)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {sortedMarkets.map((g) => {
                const mkt = g.groupId || 'US';
                const mktHoldings = holdingsByMarket.get(mkt) ?? [];
                return (
                  <div key={mkt} className="space-y-2">
                    <div className="flex items-center justify-between border-b border-border pb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{g.groupName}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatNumber(g.count, 0)} 只
                        </span>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-sm font-semibold tabular-nums">
                          {formatCurrencyWithCode(g.marketValue, baseCurrency)}
                        </div>
                        <div
                          className={cn(
                            'font-mono text-xs tabular-nums',
                            plClass(g.returnPct)
                          )}
                        >
                          {formatPercent(g.returnPct)}
                        </div>
                      </div>
                    </div>

                    {mktHoldings.length > 0 && (
                      <div className="md:hidden">
                        {mktHoldings.map((h) => {
                          const current = Number(h.currentPrice) || 0;
                          const buy = Number(h.buyPrice) || 0;
                          const pl = current - buy;
                          const pct = buy > 0 ? ((current - buy) / buy) * 100 : 0;
                          const company = displayCompany(h.company, h.ticker);
                          return (
                            <Card key={h.id} className="mb-2 p-3">
                              <div className="flex items-center justify-between">
                                <div>
                                  <div className="font-medium">{h.ticker}</div>
                                  <div className="text-xs text-muted-foreground">
                                    {company ?? (
                                      <span className="text-muted-foreground/60">—</span>
                                    )}
                                  </div>
                                </div>
                                <div className="text-right">
                                  <div className="font-mono tabular-nums">
                                    {formatCurrencyWithCode(h.currentPrice || '0', h.currency || 'USD')}
                                  </div>
                                  <div
                                    className={cn(
                                      'font-mono text-xs tabular-nums',
                                      plClass(String(pct))
                                    )}
                                  >
                                    {formatPercent(pct)}
                                  </div>
                                </div>
                              </div>
                            </Card>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between pb-3">
          <CardTitle className="font-serif text-lg">现金明细</CardTitle>
          <span className="text-xs text-muted-foreground">共 {dashboard?.cashByCurrency ? Object.keys(dashboard.cashByCurrency).length : 0} 个币种</span>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : dashboard?.cashByCurrency ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {Object.entries(dashboard.cashByCurrency).map(([cur, bal]) => (
                <div
                  key={cur}
                  className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2"
                >
                  <span className="text-sm font-medium text-foreground">{cur}</span>
                  <span className="font-mono text-sm tabular-nums">
                    {formatCurrencyWithCode(bal, cur)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <Empty className="py-8">
              <EmptyHeader>
                <EmptyTitle>暂无现金数据</EmptyTitle>
              </EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
