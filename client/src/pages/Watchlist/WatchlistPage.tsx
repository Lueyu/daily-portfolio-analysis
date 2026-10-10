/**
 * @file pages/Watchlist/WatchlistPage.tsx
 * @description Route `/watchlist`: tracked tickers with live quotes.
 *
 * Renders a desktop table and mobile card grid, both click-through to a detail
 * dialog. Supports text search, signal filter, and an add-watch dialog. Live
 * quotes are subscribed via `useMarketQuotes`; when a quote is fresher than
 * the stored `currentPrice`, the quote price is displayed instead.
 */
import { useState, useEffect, useMemo } from 'react';
import { Search, Plus, Eye, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import type { WatchItem, Signal, Market } from '@shared/api.interface';
import { fetchWatchlist, createWatchItem } from '@/api';
import { useMarketQuotes } from '@/hooks/use-market-quotes';
import { MarketStatusBadges } from '@/components/MarketStatusBadges';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
  DialogClose,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Separator } from '@/components/ui/separator';
import {
  formatPrice,
  formatPercent,
  formatDate,
  formatTime,
  signalColor,
  ratingColor,
  plClass,
  cn,
} from '@/utils/format';
import DetailDialog from './DetailDialog';
import WatchForm, { type WatchFormData } from './WatchForm';

/** Signal filter options for the toolbar. */
const SIGNAL_FILTERS: Array<{ value: 'all' | Signal; label: string }> = [
  { value: 'all', label: '全部信号' },
  { value: '强烈买入', label: '强烈买入' },
  { value: '买入', label: '买入' },
  { value: '观望', label: '观望' },
  { value: '回避', label: '回避' },
];

/** Blank watch-form state; `dateAdded` defaults to today. */
const EMPTY_FORM: WatchFormData = {
  ticker: '',
  company: '',
  sector: '',
  dateAdded: new Date().toISOString().split('T')[0],
  entryPrice: '',
  currentPrice: '',
  targetBuy: '',
  rating: '',
  signal: '',
  analysis: '',
};

/** Parse a string to a number, returning undefined for empty/NaN input. */
function parseNumber(v: string): number | undefined {
  const n = parseFloat(v);
  return isNaN(n) ? undefined : n;
}

/**
 * Compute how far the current price is below the target buy price, as a
 * positive percent. Returns null when the price is at/above target or inputs
 * are missing/invalid.
 */
function belowTargetPct(
  current: string | null,
  target: string | null
): number | null {
  const c = parseFloat(current ?? '');
  const t = parseFloat(target ?? '');
  if (isNaN(c) || isNaN(t) || t <= 0) return null;
  if (c >= t) return null;
  return ((t - c) / t) * 100;
}

/**
 * Watchlist page component.
 *
 * State: watch items, search/signal filters, selected item for the detail
 * dialog, add-dialog open state, and the create form.
 */
function WatchlistPage() {
  const [items, setItems] = useState<WatchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [signalFilter, setSignalFilter] = useState<'all' | Signal>('all');
  const [selected, setSelected] = useState<WatchItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [formData, setFormData] = useState<WatchFormData>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  const tickers = useMemo(
    () => items.map((item) => item.ticker),
    [items]
  );

  const { quotes, marketStatus, marketErrors, lastUpdated } = useMarketQuotes(tickers);



  /** Fetch the watchlist and populate state. */
  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const data: WatchItem[] = await fetchWatchlist();
      setItems(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '加载失败';
      setError(msg);
      toast.error('加载关注列表失败', { description: msg });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  /** Apply text search and signal filter to the watch items. */
  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item: WatchItem) => {
      if (signalFilter !== 'all' && item.signal !== signalFilter) return false;
      if (!q) return true;
      return (
        item.ticker.toLowerCase().includes(q) ||
        (item.company ?? '').toLowerCase().includes(q)
      );
    });
  }, [items, search, signalFilter]);

  /** Prefer the live quote price when available; fall back to stored currentPrice. */
  function getDisplayPrice(item: WatchItem): string {
    const quote = quotes[item.ticker];
    if (quote && quote.price !== undefined && !isNaN(parseFloat(quote.price))) {
      return quote.price;
    }
    return item.currentPrice ?? '';
  }

  /** Open the detail dialog for the selected watch item. */
  const openDetail = (item: WatchItem) => {
    setSelected(item);
    setDetailOpen(true);
  };

  /** Validate and submit the create-watch form, then reset and refetch. */
  const handleCreate = async () => {
    if (!formData.ticker.trim()) {
      toast.error('请输入股票代码');
      return;
    }
    setSubmitting(true);
    try {
      await createWatchItem({
        ticker: formData.ticker.trim().toUpperCase(),
        company: formData.company.trim() || undefined,
        sector: formData.sector.trim() || undefined,
        dateAdded: formData.dateAdded || undefined,
        entryPrice: parseNumber(formData.entryPrice),
        currentPrice: parseNumber(formData.currentPrice),
        targetBuy: parseNumber(formData.targetBuy),
        rating: formData.rating || undefined,
        signal: formData.signal || undefined,
        analysis: formData.analysis.trim() || undefined,
      });
      toast.success('已添加关注');
      setAddOpen(false);
      setFormData(EMPTY_FORM);
      void loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '创建失败';
      toast.error('添加失败', { description: msg });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <WatchlistSkeleton />;
  }

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header actions */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex-1">
          <h1 className="font-serif text-2xl font-semibold tracking-tight text-foreground">
            关注列表
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
            <MarketStatusBadges
              marketStatus={marketStatus}
              marketErrors={marketErrors}
              lastUpdated={lastUpdated}
            />
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="搜索代码或公司名称…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select
            value={signalFilter}
            onValueChange={(v) => setSignalFilter(v as 'all' | Signal)}
          >
            <SelectTrigger className="w-full sm:w-40">
              <SelectValue placeholder="信号筛选" />
            </SelectTrigger>
            <SelectContent>
              {SIGNAL_FILTERS.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4" />
              添加关注
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
            <DialogHeader>
              <DialogTitle className="font-serif text-xl">
                添加关注
              </DialogTitle>
            </DialogHeader>
            <WatchForm data={formData} onChange={setFormData} includeTicker />
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">取消</Button>
              </DialogClose>
              <Button onClick={handleCreate} disabled={submitting}>
                {submitting ? '保存中…' : '添加'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {error && (
        <Card className="border-destructive/40">
          <CardContent className="flex items-center justify-between p-4">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4" />
              <span className="text-sm">{error}</span>
            </div>
            <Button size="sm" variant="outline" onClick={loadData}>
              重试
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Desktop Table */}
      {!loading && !error && filteredItems.length > 0 && (
        <div className="hidden md:block">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="font-serif">代码</TableHead>
                    <TableHead className="font-serif">公司名称</TableHead>
                    <TableHead className="font-serif">行业</TableHead>
                    <TableHead className="font-serif">信号</TableHead>
                    <TableHead className="text-right font-serif">
                      买入价
                    </TableHead>
                     <TableHead className="text-right font-serif">
                       现价
                     </TableHead>
                     <TableHead className="text-right font-serif">
                       涨跌幅
                     </TableHead>
                     <TableHead className="text-right font-serif">
                      目标买入价
                    </TableHead>
                    <TableHead className="font-serif">评级</TableHead>
                    <TableHead className="font-serif">加入日期</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredItems.map((item: WatchItem) => {
                    const belowPct = belowTargetPct(
                      item.currentPrice,
                      item.targetBuy
                    );
                    return (
                      <TableRow
                        key={item.id}
                        onClick={() => openDetail(item)}
                        className="cursor-pointer"
                      >
                        <TableCell className="font-mono-nums font-semibold">
                          {item.ticker}
                        </TableCell>
                        <TableCell>{item.company ?? '—'}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {item.sector ?? '—'}
                        </TableCell>
                        <TableCell>
                          {item.signal ? (
                            <Badge
                              variant="outline"
                              className={cn(
                                'border-transparent font-medium',
                                signalColor(item.signal)
                              )}
                            >
                              {item.signal}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono-nums">
                          {formatPrice(item.entryPrice)}
                        </TableCell>
                         <TableCell className="text-right font-mono-nums">
                           {formatPrice(getDisplayPrice(item))}
                           {belowPct !== null && (
                             <div className="text-xs text-success">
                               低于目标{' '}
                               {formatPercent(belowPct).replace('+', '')}
                             </div>
                           )}
                         </TableCell>
                         {quotes[item.ticker] ? (
                           <TableCell
                             className={cn(
                               'text-right font-mono-nums font-medium',
                               plClass(
                                 quotes[item.ticker]?.changePercent ?? '0'
                               )
                             )}
                           >
                             {quotes[item.ticker]?.changePercent !== undefined
                               ? formatPercent(quotes[item.ticker].changePercent)
                               : '--'}
                           </TableCell>
                         ) : (
                           <TableCell className="text-right">
                             <span className="text-muted-foreground/60 font-mono-nums">
                               --
                             </span>
                           </TableCell>
                         )}
                        <TableCell className="text-right font-mono-nums">
                          {formatPrice(item.targetBuy)}
                        </TableCell>
                        <TableCell>
                          {item.rating ? (
                            <Badge
                              variant="outline"
                              className={cn(
                                'border-transparent text-xs',
                                ratingColor(item.rating)
                              )}
                            >
                              {item.rating}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {item.dateAdded ? (
                            formatDate(item.dateAdded)
                          ) : (
                            <span title="未记录加入日期">--</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Mobile Cards */}
      {!loading && !error && filteredItems.length > 0 && (
        <div className="grid gap-3 md:hidden">
          {filteredItems.map((item: WatchItem) => {
            const belowPct = belowTargetPct(
              item.currentPrice,
              item.targetBuy
            );
            return (
              <Card
                key={item.id}
                onClick={() => openDetail(item)}
                className="cursor-pointer transition-colors"
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono-nums text-lg font-bold">
                          {item.ticker}
                        </span>
                        {item.signal && (
                          <Badge
                            variant="outline"
                            className={cn(
                              'border-transparent text-xs',
                              signalColor(item.signal)
                            )}
                          >
                            {item.signal}
                          </Badge>
                        )}
                      </div>
                      <div className="truncate text-sm text-muted-foreground">
                        {item.company ?? '—'}
                      </div>
                    </div>
                    <Eye className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                  </div>
                  <Separator className="my-3" />
                   <div className="grid grid-cols-4 gap-2 text-sm">
                     <div>
                       <div className="text-xs text-muted-foreground">
                         现价
                       </div>
                       <div className="font-mono-nums font-medium">
                         {formatPrice(getDisplayPrice(item))}
                       </div>
                     </div>
                     <div>
                       <div className="text-xs text-muted-foreground">
                         涨跌幅
                       </div>
                        {quotes[item.ticker] ? (
                          <div
                            className={cn(
                              'font-mono-nums font-medium',
                              plClass(quotes[item.ticker]?.changePercent ?? '0')
                            )}
                          >
                            {quotes[item.ticker]?.changePercent !== undefined
                              ? formatPercent(quotes[item.ticker].changePercent)
                              : '--'}
                          </div>
                        ) : (
                          <div className="text-muted-foreground/60 font-mono-nums font-medium">
                            --
                          </div>
                        )}
                     </div>
                    <div>
                      <div className="text-xs text-muted-foreground">
                        目标买入
                      </div>
                      <div className="font-mono-nums font-medium">
                        {formatPrice(item.targetBuy)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">
                        买入价
                      </div>
                      <div className="font-mono-nums font-medium">
                        {formatPrice(item.entryPrice)}
                      </div>
                    </div>
                  </div>
                  {belowPct !== null && (
                    <div className="mt-2 text-xs text-success">
                      低于目标{' '}
                      {formatPercent(belowPct).replace('+', '')}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && filteredItems.length === 0 && (
        <Card>
          <CardContent className="p-6">
            <Empty>
              <EmptyMedia variant="icon">
                <Eye className="h-5 w-5" />
              </EmptyMedia>
              <EmptyContent>
                <EmptyTitle className="font-serif">
                  {search || signalFilter !== 'all'
                    ? '没有匹配的关注股票'
                    : '暂无关注股票'}
                </EmptyTitle>
                <EmptyDescription>
                  {search || signalFilter !== 'all'
                    ? '试试调整搜索关键词或筛选条件'
                    : '点击"添加关注"开始追踪你感兴趣的股票'}
                </EmptyDescription>
              </EmptyContent>
            </Empty>
          </CardContent>
        </Card>
      )}

      {/* Detail Dialog */}
      <DetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        item={selected}
        onUpdated={() => void loadData()}
        onDeleted={() => void loadData()}
      />
    </div>
  );
}

/** Loading skeleton shown while the watchlist is being fetched. */
function WatchlistSkeleton() {
  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row">
          <Skeleton className="h-9 flex-1" />
          <Skeleton className="h-9 w-full sm:w-40" />
        </div>
        <Skeleton className="h-9 w-28" />
      </div>
      <Card>
        <CardContent className="p-6">
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default WatchlistPage;
