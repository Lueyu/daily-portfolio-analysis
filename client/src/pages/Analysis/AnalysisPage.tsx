import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  Calendar,
  AlertTriangle,
  BarChart3,
  Sparkles,
  Bot,
  LayoutGrid,
  Info,
  ArrowRight,
} from 'lucide-react';
import { toast } from 'sonner';
import type {
  Analysis as AnalysisType,
  AgentRunWithRating,
} from '@shared/api.interface';
import {
  fetchAnalysis,
  fetchAnalysisDates,
  getAgentRuns,
} from '@/api';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { formatDate, formatDateTime, cn } from '@/utils/format';
import AnalysisCard from './AnalysisCard';

const PORTFOLIO_TICKER = 'PORTFOLIO';

const RATING_ORDER = ['Strong Buy', 'Buy', 'Hold', 'Sell', 'Strong Sell'];

type ViewMode = 'traditional' | 'multiagent';

function AnalysisPage() {
  const [analyses, setAnalyses] = useState<AnalysisType[]>([]);
  const [dates, setDates] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [datesLoading, setDatesLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentDate, setCurrentDate] = useState<string>('');

  // Multi-Agent view state (deep reports list)
  const [viewMode, setViewMode] = useState<ViewMode>('traditional');
  const [ratingFilter, setRatingFilter] = useState<string | null>(null);
  const [deepReports, setDeepReports] = useState<AgentRunWithRating[]>([]);
  const [deepReportsLoading, setDeepReportsLoading] = useState(false);

  // Multi-Agent info dialogs
  const [batchInfoOpen, setBatchInfoOpen] = useState(false);
  const [singleInfoOpen, setSingleInfoOpen] = useState(false);

  useEffect(() => {
    void loadDates();
  }, []);

  useEffect(() => {
    if (currentDate) {
      void loadAnalysis(currentDate);
    }
  }, [currentDate]);

  useEffect(() => {
    setRatingFilter(null);
  }, [currentDate]);

  const loadDates = async () => {
    setDatesLoading(true);
    try {
      const data: string[] = await fetchAnalysisDates();
      const sorted = Array.isArray(data)
        ? [...data].sort((a, b) => b.localeCompare(a))
        : [];
      setDates(sorted);
      if (sorted.length > 0 && !currentDate) {
        setCurrentDate(sorted[0]);
      } else if (sorted.length === 0) {
        setLoading(false);
      }
    } catch {
      toast.error('分析日期加载失败，请稍后重试');
      setLoading(false);
    } finally {
      setDatesLoading(false);
    }
  };

  const loadAnalysis = async (date: string) => {
    setLoading(true);
    setError(null);
    try {
      const data: AnalysisType[] = await fetchAnalysis(date);
      setAnalyses(Array.isArray(data) ? data : []);
    } catch {
      setError('分析内容加载失败，请稍后重试');
      toast.error('分析内容加载失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const loadDeepReports = useCallback(async () => {
    setDeepReportsLoading(true);
    try {
      const pt = window.__pt;
      let items: AgentRunWithRating[] = [];
      if (pt && typeof pt.listDeepReports === 'function') {
        const raw = await pt.listDeepReports();
        const list = Array.isArray(raw) ? raw : [];
        items = list.map((r: {
          runId: string;
          ticker: string;
          tickerName: string | null;
          rating: string | null;
          confidence: string | null;
          targetBear: string | null;
          targetBase: string | null;
          targetBull: string | null;
          reportDate: string;
          updatedAt: string;
          url?: string;
        }) => ({
          id: r.runId,
          ticker: r.ticker,
          tickerName: r.tickerName,
          market: null,
          triggerType: 'manual',
          runMode: 'full',
          status: 'completed',
          modelFast: null,
          modelSlow: null,
          tokensUsed: 0,
          costEstimate: '0',
          startedAt: null,
          completedAt: r.reportDate + 'T00:00:00.000Z',
          errorMessage: null,
          humanDecision: null,
          humanNote: null,
          createdAt: r.updatedAt,
          updatedAt: r.updatedAt,
          targetBear: r.targetBear,
          targetBase: r.targetBase,
          targetBull: r.targetBull,
          confidence: (r.confidence as AgentRunWithRating['confidence']) ?? null,
          rating: r.rating
            ? ({ rating: r.rating } as unknown as AgentRunWithRating['rating'])
            : null,
        }));
      } else {
        const data = await getAgentRuns({ runMode: 'full', status: 'completed', limit: 50 });
        items = data?.items ?? [];
      }
      items.sort(
        (a: AgentRunWithRating, b: AgentRunWithRating) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
      setDeepReports(items);
    } catch {
      toast.error('深度报告列表加载失败，请稍后重试');
    } finally {
      setDeepReportsLoading(false);
    }
  }, []);

  // Load deep reports on page init so traditional view can show deep report badges
  useEffect(() => {
    void loadDeepReports();
  }, [loadDeepReports]);

  // When user switches to multiagent tab, reload if list is empty
  // (window.__pt may not be ready on first mount)
  useEffect(() => {
    if (viewMode === 'multiagent' && deepReports.length === 0 && !deepReportsLoading) {
      void loadDeepReports();
    }
  }, [viewMode, deepReports.length, deepReportsLoading, loadDeepReports]);

  // Auto-refresh when page becomes visible or regains focus
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      void refreshAll();
    };
    const handleFocus = () => {
      void refreshAll();
    };

    const refreshAll = async () => {
      await loadDates();
      const effectiveDate = currentDate || dates[0];
      if (effectiveDate) {
        await Promise.all([
          loadAnalysis(effectiveDate),
          loadDeepReports(),
        ]);
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocus);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocus);
    };
  }, [currentDate, dates, loadDeepReports]);

  const navigate = useNavigate();

  const handleOpenBatchInfo = () => setBatchInfoOpen(true);
  const handleOpenSingleInfo = () => setSingleInfoOpen(true);

  const handleDeepReportClick = (runId: string) => {
    navigate(`/analysis/deep-report/${runId}`);
  };

  const currentIndex = useMemo(
    () => dates.indexOf(currentDate),
    [dates, currentDate]
  );

  const prevDisabled = currentIndex >= dates.length - 1 || dates.length === 0;
  const nextDisabled = currentIndex <= 0 || dates.length === 0;

  const goPrev = () => {
    if (currentIndex < dates.length - 1) {
      setCurrentDate(dates[currentIndex + 1]);
    }
  };

  const goNext = () => {
    if (currentIndex > 0) {
      setCurrentDate(dates[currentIndex - 1]);
    }
  };

  // ticker -> deep report runId map for traditional view badges
  const deepReportByTicker = useMemo(() => {
    const map = new Map<string, string>();
    const normalizeTicker = (t: string): string => t.replace(/\.(HK|US)$/i, '');
    for (const r of deepReports) {
      if (r.ticker && r.id) {
        map.set(normalizeTicker(r.ticker), r.id);
      }
    }
    return map;
  }, [deepReports]);

  const { stockAnalyses, portfolioAnalysis } = useMemo(() => {
    const stocks = analyses.filter(
      (a: AnalysisType) => a.ticker !== PORTFOLIO_TICKER
    );
    stocks.sort((a, b) => a.ticker.localeCompare(b.ticker));
    const portfolio = analyses.find(
      (a: AnalysisType) => a.ticker === PORTFOLIO_TICKER
    );
    return { stockAnalyses: stocks, portfolioAnalysis: portfolio ?? null };
  }, [analyses]);

  const ratingOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of stockAnalyses) {
      if (a.rating) {
        counts.set(a.rating, (counts.get(a.rating) ?? 0) + 1);
      }
    }
    return RATING_ORDER.filter((r: string) => counts.has(r)).map((r: string) => ({
      rating: r,
      count: counts.get(r) ?? 0,
    }));
  }, [stockAnalyses]);

  const filteredStockAnalyses = useMemo(
    () =>
      ratingFilter
        ? stockAnalyses.filter((a: AnalysisType) => a.rating === ratingFilter)
        : stockAnalyses,
    [stockAnalyses, ratingFilter]
  );

  if (datesLoading && !currentDate) {
    return <AnalysisSkeleton />;
  }

  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-6">
      {/* Sidebar: date list */}
      <aside className="w-full shrink-0 md:w-48">
        <Card className="md:sticky md:top-4">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="font-serif text-base">历史分析</CardTitle>
          </CardHeader>
          <CardContent className="p-2">
            {datesLoading ? (
              <div className="space-y-2 p-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : dates.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                暂无分析记录
              </div>
            ) : (
              <div className="max-h-[300px] space-y-0.5 overflow-y-auto md:max-h-[calc(100vh-200px)]">
                {dates.map((d) => (
                  <button
                    key={d}
                    onClick={() => setCurrentDate(d)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors',
                      d === currentDate
                        ? 'bg-primary/10 font-medium text-primary'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    )}
                  >
                    <Calendar className="h-3.5 w-3.5 flex-shrink-0" />
                    <span className="font-mono-nums">{formatDate(d)}</span>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </aside>

      {/* Main content */}
      <div className="min-w-0 flex-1 space-y-4 md:space-y-6">
        {/* Date navigator */}
        <Card>
          <CardContent className="flex items-center justify-between p-4">
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0} className="inline-flex">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={goPrev}
                    disabled={prevDisabled}
                    aria-label="上一天"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                </span>
              </TooltipTrigger>
              {prevDisabled && (
                <TooltipContent>
                  {datesLoading ? '正在加载分析日期' : '已是最早的分析日期'}
                </TooltipContent>
              )}
            </Tooltip>
            <div className="text-center">
              <div className="font-serif text-xl font-semibold md:text-2xl">
                {currentDate ? formatDate(currentDate) : '选择日期'}
              </div>
              <div className="text-xs text-muted-foreground">
                {viewMode === 'traditional'
                  ? stockAnalyses.length > 0
                    ? `${stockAnalyses.length} 只股票分析`
                    : '当日无股票分析'
                  : deepReports.length > 0
                    ? `${deepReports.length} 份深度报告`
                    : '暂无深度报告'}
              </div>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0} className="inline-flex">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={goNext}
                    disabled={nextDisabled}
                    aria-label="下一天"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </span>
              </TooltipTrigger>
              {nextDisabled && (
                <TooltipContent>
                  {datesLoading ? '正在加载分析日期' : '已是最新的分析日期'}
                </TooltipContent>
              )}
            </Tooltip>
          </CardContent>
        </Card>

        {/* Tabs root wraps action bar + all tab content */}
        {/* Action bar */}
        <Card>
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={handleOpenBatchInfo}>
                <Bot className="mr-1.5 h-4 w-4" />
                运行 Multi-Agent 分析
              </Button>
              <Button variant="outline" onClick={handleOpenSingleInfo}>
                <Info className="mr-1.5 h-4 w-4" />
                单只深度分析
              </Button>
            </div>
            <div
              role="tablist"
              className="inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground w-full sm:w-auto"
            >
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'traditional'}
                data-state={viewMode === 'traditional' ? 'active' : 'inactive'}
                onClick={() => setViewMode('traditional')}
                className={cn(
                  'inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 flex-1 sm:flex-none',
                  viewMode === 'traditional'
                    ? 'bg-background text-foreground shadow'
                    : ''
                )}
              >
                <LayoutGrid className="mr-1.5 h-3.5 w-3.5" />
                传统分析
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'multiagent'}
                data-state={viewMode === 'multiagent' ? 'active' : 'inactive'}
                onClick={() => setViewMode('multiagent')}
                className={cn(
                  'inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 flex-1 sm:flex-none',
                  viewMode === 'multiagent'
                    ? 'bg-background text-foreground shadow'
                    : ''
                )}
              >
                <Bot className="mr-1.5 h-3.5 w-3.5" />
                Multi-Agent
              </button>
            </div>
          </CardContent>
        </Card>

        {viewMode === 'traditional' && (
          <div className="space-y-4 md:space-y-6">
            {/* Traditional view error */}
            {error && (
              <Card className="border-destructive/40">
                <CardContent className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-2 text-destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <span className="text-sm">{error}</span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => currentDate && loadAnalysis(currentDate)}
                  >
                    重试
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Portfolio strategy review (special card) */}
            {!loading && portfolioAnalysis && (
              <AnalysisCard
                analysis={portfolioAnalysis}
                deepReportRunId={deepReportByTicker.get(PORTFOLIO_TICKER)}
              />
            )}

            {/* No portfolio placeholder */}
            {!loading &&
              !error &&
              !portfolioAnalysis &&
              stockAnalyses.length > 0 && (
                <Card className="border-dashed border-primary/30 bg-primary/[0.02]">
                  <CardContent className="flex items-center gap-3 p-4">
                    <Sparkles className="h-5 w-5 text-primary/60" />
                    <div>
                      <div className="text-sm font-medium text-foreground/80">
                        今日暂无策略复盘
                      </div>
                      <div className="text-xs text-muted-foreground">
                        当日未发布组合层面的策略总结
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

            {/* Loading skeleton */}
            {loading && <AnalysisContentSkeleton />}

            {/* Stock analysis cards */}
            {!loading && !error && stockAnalyses.length > 0 && (
              <div className="space-y-4">
                <h2 className="font-serif text-lg font-semibold">
                  个股分析
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    {stockAnalyses.length} 只
                  </span>
                </h2>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setRatingFilter(null)}
                    className={cn(
                      'rounded-full px-3 py-1 text-xs transition-colors',
                      ratingFilter === null
                        ? 'bg-foreground text-background'
                        : 'bg-muted text-muted-foreground hover:text-foreground'
                    )}
                  >
                    全部
                  </button>
                  {ratingOptions.map(({ rating, count }) => (
                    <button
                      key={rating}
                      type="button"
                      onClick={() =>
                        setRatingFilter(ratingFilter === rating ? null : rating)
                      }
                      className={cn(
                        'rounded-full px-3 py-1 text-xs transition-colors',
                        ratingFilter === rating
                          ? 'bg-foreground text-background'
                          : 'bg-muted text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {rating} ({count})
                    </button>
                  ))}
                </div>
                {filteredStockAnalyses.length > 0 ? (
                  <div className="grid gap-4 xl:grid-cols-2">
                    {filteredStockAnalyses.map((a: AnalysisType) => (
                      <AnalysisCard
                        key={a.id}
                        analysis={a}
                        deepReportRunId={deepReportByTicker.get(a.ticker)}
                      />
                    ))}
                  </div>
                ) : (
                  <Card>
                    <CardContent className="p-8">
                      <Empty>
                        <EmptyMedia variant="icon">
                          <BarChart3 className="h-5 w-5" />
                        </EmptyMedia>
                        <EmptyContent>
                          <EmptyTitle className="font-serif">
                            该评级下暂无分析
                          </EmptyTitle>
                          <EmptyDescription>
                            试试切换其他评级或选择「全部」
                          </EmptyDescription>
                        </EmptyContent>
                      </Empty>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            {/* Empty state */}
            {!loading && !error && stockAnalyses.length === 0 && (
              <Card>
                <CardContent className="p-8">
                  <Empty>
                    <EmptyMedia variant="icon">
                      <BarChart3 className="h-5 w-5" />
                    </EmptyMedia>
                    <EmptyContent>
                      <EmptyTitle className="font-serif">
                        该日期无分析记录
                      </EmptyTitle>
                      <EmptyDescription>
                        {dates.length > 0
                          ? '请从左侧选择其他有分析记录的日期'
                          : '系统中暂无任何分析记录'}
                      </EmptyDescription>
                    </EmptyContent>
                  </Empty>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {viewMode === 'multiagent' && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              深度报告徽章仅对已完成深度分析的股票显示，可通过「单只深度分析」或「运行 Multi-Agent 分析」生成
            </p>
            <DeepReportListContent
              loading={deepReportsLoading}
              reports={deepReports}
              onReportClick={handleDeepReportClick}
              onRefresh={loadDeepReports}
            />
          </div>
        )}
      </div>

      {/* Multi-Agent batch info dialog */}
      <Dialog open={batchInfoOpen} onOpenChange={setBatchInfoOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>由豆包 Agent 运行</DialogTitle>
            <DialogDescription>
              Multi-Agent 分析不再从本页面直接触发
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2 text-sm leading-relaxed text-foreground/90">
            <p>
              Multi-Agent 分析由豆包 Agent 运行
              <span className="font-medium">
                「daily-portfolio-analysis」
              </span>
              技能完成。
            </p>
            <div>
              <p className="mb-1 font-medium text-foreground">触发方式：</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>在豆包对话中发送「执行每日持仓分析」</li>
                <li>或直接调用 daily-portfolio-analysis 技能</li>
              </ul>
            </div>
            <div>
              <p className="mb-1 font-medium text-foreground">
                Agent 会依次完成：
              </p>
              <p className="text-foreground/80">
                取数 → Bull/Bear 多空辩论 → Critic 批判 → 风控闸 → 最终评级
              </p>
            </div>
            <p className="text-foreground/70">
              结果写入本页并自动刷新。
            </p>
          </div>
          <DialogFooter>
            <Button onClick={() => setBatchInfoOpen(false)}>我知道了</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Single ticker deep analysis info dialog */}
      <Dialog open={singleInfoOpen} onOpenChange={setSingleInfoOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>单只深度分析</DialogTitle>
            <DialogDescription>
              单只股票深度分析由豆包 Agent 完成
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2 text-sm leading-relaxed text-foreground/90">
            <div>
              <p className="mb-1 font-medium text-foreground">触发方式：</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>
                  在豆包对话中发送「深度分析
                  <span className="font-mono-nums">{' '}股票代码{' '}</span>
                  」，例如「深度分析 MSFT」
                </li>
                <li>或运行 daily-portfolio-analysis 技能时一并完成</li>
              </ul>
            </div>
            <p>
              Agent 会对该股票跑完整 Multi-Agent 流程并写入本页。
            </p>
          </div>
          <DialogFooter>
            <Button onClick={() => setSingleInfoOpen(false)}>我知道了</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AnalysisSkeleton() {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:gap-6">
      <div className="w-full md:w-48">
        <Skeleton className="h-48 w-full" />
      </div>
      <div className="flex-1 space-y-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-32 w-full" />
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-48 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}

interface DeepReportListContentProps {
  loading: boolean;
  reports: AgentRunWithRating[];
  onReportClick: (runId: string) => void;
  onRefresh: () => void;
}

function DeepReportListContent({
  loading,
  reports,
  onReportClick,
  onRefresh,
}: DeepReportListContentProps) {
  if (loading) {
    return (
      <div className="grid gap-4 xl:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="space-y-3 p-5">
              <div className="flex items-center justify-between">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-5 w-16" />
              </div>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <div className="grid gap-2 pt-2 grid-cols-3">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
              <Skeleton className="h-8 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (reports.length === 0) {
    return (
      <Card>
        <CardContent className="p-8">
          <Empty>
            <EmptyMedia variant="icon">
              <Sparkles className="h-5 w-5 text-amber-500" />
            </EmptyMedia>
            <EmptyContent>
              <EmptyTitle className="font-serif">
                还没有深度报告
              </EmptyTitle>
              <EmptyDescription>
                请在豆包运行 daily-portfolio-analysis，或对豆包说「深度分析 股票代码」生成
              </EmptyDescription>
              <div className="mt-4">
                <Button variant="outline" size="sm" onClick={onRefresh}>
                  刷新
                </Button>
              </div>
            </EmptyContent>
          </Empty>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-500" />
          <h2 className="font-serif text-lg font-semibold">
            深度报告列表
          </h2>
          <Badge variant="secondary">{reports.length}</Badge>
        </div>
        <Button variant="outline" size="sm" onClick={onRefresh}>
          刷新
        </Button>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {reports.map((run: AgentRunWithRating) => (
          <DeepReportCard
            key={run.id}
            run={run}
            onClick={() => onReportClick(run.id)}
          />
        ))}
      </div>
    </div>
  );
}

function DeepReportCard({
  run,
  onClick,
}: {
  run: AgentRunWithRating;
  onClick: () => void;
}) {
  const hasThreeTargets =
    run.targetBear != null || run.targetBase != null || run.targetBull != null;
  const ratingValue: string | null =
    run.rating == null
      ? null
      : typeof run.rating === 'string'
        ? run.rating
        : typeof (run.rating as unknown as Record<string, unknown>).rating === 'string'
          ? String((run.rating as unknown as Record<string, unknown>).rating)
          : null;

  const confidenceLabel = (c: string | null | undefined): string => {
    switch (c) {
      case 'high': return '高置信度';
      case 'medium': return '中置信度';
      case 'low': return '低置信度';
      default: return '置信度未知';
    }
  };

  const confidenceColor = (c: string | null | undefined): string => {
    switch (c) {
      case 'high': return 'bg-success/15 text-success border-success/30';
      case 'medium': return 'bg-warning/15 text-warning border-warning/30';
      case 'low': return 'bg-destructive/15 text-destructive border-destructive/30';
      default: return 'bg-muted text-muted-foreground border-muted';
    }
  };

  const ratingBadgeColor = (r: string | null | undefined): string => {
    switch (r) {
      case 'Strong Buy': return 'bg-success/15 text-success';
      case 'Buy': return 'bg-success/10 text-success';
      case 'Hold': return 'bg-warning/15 text-warning';
      case 'Sell': return 'bg-destructive/10 text-destructive';
      case 'Strong Sell': return 'bg-destructive/20 text-destructive';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  return (
    <Card
      onClick={onClick}
      className="cursor-pointer border-amber-500/40 bg-amber-500/[0.02] transition-all hover:border-amber-500/60 hover:bg-amber-500/[0.05] hover:shadow-md hover:-translate-y-0.5"
    >
      <CardContent className="space-y-3 p-4">
        {/* Header: ticker + name + rating */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <h3 className="font-mono-nums text-lg font-semibold tracking-tight">
                {run.ticker}
              </h3>
              {run.tickerName && (
                <span className="truncate text-sm text-muted-foreground">
                  {run.tickerName}
                </span>
              )}
            </div>
            <Badge
              variant="outline"
              className="mt-1.5 gap-1 border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400 font-medium"
            >
              <Sparkles size={12} />
              深度报告
            </Badge>
          </div>
          {ratingValue && (
            <Badge
              variant="outline"
              data-testid="deep-report-rating-badge"
              className={cn('border-transparent shrink-0', ratingBadgeColor(ratingValue))}
            >
              {ratingValue}
            </Badge>
          )}
        </div>

        {/* Confidence badge */}
        {run.confidence && (
          <Badge
            variant="outline"
            className={cn('border-transparent w-fit', confidenceColor(run.confidence))}
          >
            {confidenceLabel(run.confidence)}
          </Badge>
        )}

        {/* Target prices: three-scenario or single */}
        {hasThreeTargets ? (
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-md bg-muted/30 px-2 py-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                悲观
              </div>
              <div className="font-mono-nums text-sm font-semibold text-destructive">
                {run.targetBear ? `$${Number(run.targetBear).toFixed(2)}` : '—'}
              </div>
            </div>
            <div className="rounded-md bg-muted/30 px-2 py-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                基准
              </div>
              <div className="font-mono-nums text-sm font-semibold text-foreground">
                {run.targetBase ? `$${Number(run.targetBase).toFixed(2)}` : '—'}
              </div>
            </div>
            <div className="rounded-md bg-muted/30 px-2 py-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                乐观
              </div>
              <div className="font-mono-nums text-sm font-semibold text-success">
                {run.targetBull ? `$${Number(run.targetBull).toFixed(2)}` : '—'}
              </div>
            </div>
          </div>
        ) : null}

        {/* Footer: generated time + CTA */}
        <div className="flex items-center justify-between pt-1 border-t border-border/50">
          <span className="text-xs text-muted-foreground font-mono-nums">
            {formatDateTime(run.completedAt)}
          </span>
          <span className="flex items-center gap-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
            查看完整深度报告
            <ArrowRight size={12} />
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function AnalysisContentSkeleton() {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i}>
          <CardContent className="space-y-3 p-5">
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-5 w-16" />
            </div>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-4/6" />
            <div className="grid gap-2 pt-2 sm:grid-cols-2">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default AnalysisPage;
