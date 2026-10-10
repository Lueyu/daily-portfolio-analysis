import { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import {
  Receipt,
  Plus,
  TrendingUp,
  Search,
  RefreshCw,
  ArrowDownToLine,
  ArrowUpFromLine,
} from 'lucide-react';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type { Transaction, ClosedPosition, RealizedPlSummary } from '@shared/api.interface';
import {
  fetchTransactions,
  fetchClosed,
  fetchRealizedPlSummary,
  reconcileTransactions,
} from '@/api';
import {
  formatCurrency,
  formatPrice,
  formatShares,
  formatPercent,
  formatDate,
  formatCurrencyWithCurrency,
  plClass,
  cn,
} from '@/utils/format';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
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
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Trash2, Calculator } from 'lucide-react';
import AddTransactionDialog from './AddTransactionDialog';
import AddClosedDialog from './AddClosedDialog';
import TransactionList from './TransactionList';

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [closed, setClosed] = useState<ClosedPosition[]>([]);
  const [realizedPl, setRealizedPl] = useState<RealizedPlSummary | null>(null);
  const [txLoading, setTxLoading] = useState(true);
  const [closedLoading, setClosedLoading] = useState(true);
  const [realizedPlLoading, setRealizedPlLoading] = useState(true);
  const [txError, setTxError] = useState<string | null>(null);
  const [closedError, setClosedError] = useState<string | null>(null);
  const [realizedPlError, setRealizedPlError] = useState<string | null>(null);
  const [tickerFilter, setTickerFilter] = useState('');
  const [addTxOpen, setAddTxOpen] = useState(false);
  const [addClosedOpen, setAddClosedOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [reconciling, setReconciling] = useState(false);

  const notifyPortfolioUpdate = () => {
    window.dispatchEvent(new CustomEvent('portfolio-updated'));
  };

  const loadTransactions = async () => {
    setTxLoading(true);
    setTxError(null);
    try {
      const params = tickerFilter.trim()
        ? { ticker: tickerFilter.trim().toUpperCase() }
        : undefined;
      const data = await fetchTransactions(params);
      const list = (data as Transaction[]).slice().sort((a, b) =>
        b.txDate.localeCompare(a.txDate)
      );
      setTransactions(list);
    } catch (err) {
      setTxError('加载交易记录失败');
      toast.error('加载交易记录失败');
    } finally {
      setTxLoading(false);
    }
  };

  const loadClosed = async () => {
    setClosedLoading(true);
    setClosedError(null);
    try {
      const data = await fetchClosed();
      setClosed(data as ClosedPosition[]);
    } catch (err) {
      setClosedError('加载已平仓记录失败');
      toast.error('加载已平仓记录失败');
    } finally {
      setClosedLoading(false);
    }
  };

  const loadRealizedPl = async () => {
    setRealizedPlLoading(true);
    setRealizedPlError(null);
    try {
      const data = await fetchRealizedPlSummary();
      setRealizedPl(data as RealizedPlSummary);
    } catch (err) {
      setRealizedPlError('加载已实现盈亏失败');
      toast.error('加载已实现盈亏失败');
    } finally {
      setRealizedPlLoading(false);
    }
  };

  useEffect(() => {
    loadTransactions();
    loadClosed();
    loadRealizedPl();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadTransactions();
    }, 300);
    return () => clearTimeout(timer);
  }, [tickerFilter]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await axiosForBackend({
        url: `/api/portfolio/transactions/${deleteTarget}`,
        method: 'DELETE',
      });
      toast.success('已删除，持仓已同步更新');
      setTransactions((prev) => prev.filter((t) => t.id !== deleteTarget));
      setDeleteTarget(null);
      loadClosed();
      loadRealizedPl();
      notifyPortfolioUpdate();
    } catch (err) {
      toast.error('删除失败');
    } finally {
      setDeleting(false);
    }
  };

  const handleReconcile = async () => {
    setReconciling(true);
    try {
      const result = await reconcileTransactions();
      toast.success(
        `对账完成：${result.holdingsCount} 只持仓 / ${result.closedCount} 笔已平仓 / ${result.processedTxCount} 笔交易`
      );
      loadTransactions();
      loadClosed();
      loadRealizedPl();
      notifyPortfolioUpdate();
    } catch (err) {
      toast.error('对账失败');
    } finally {
      setReconciling(false);
    }
  };

  const txStats = useMemo(() => {
    const buyTotal = transactions
      .filter((t) => t.txType === 'Buy')
      .reduce(
        (sum, t) =>
          sum +
          parseFloat(t.shares) * parseFloat(t.price) +
          parseFloat(t.fees || '0'),
        0
      );
    const sellTotal = transactions
      .filter((t) => t.txType === 'Sell')
      .reduce(
        (sum, t) =>
          sum +
          parseFloat(t.shares) * parseFloat(t.price) -
          parseFloat(t.fees || '0'),
        0
      );
    return { buyTotal, sellTotal, count: transactions.length };
  }, [transactions]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl md:text-3xl font-semibold tracking-tight flex items-center gap-2.5">
            <Receipt className="size-6 text-primary" />
            交易记录
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            追踪每一笔交易与已平仓盈亏
          </p>
        </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              loadTransactions();
              loadClosed();
              loadRealizedPl();
            }}
          >
          <RefreshCw className="size-4" />
          刷新
        </Button>
      </div>

      <Tabs defaultValue="transactions" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="transactions">
            <TrendingUp className="size-4 mr-1.5" />
            交易流水
          </TabsTrigger>
          <TabsTrigger value="realized">
            <TrendingUp className="size-4 mr-1.5" />
            已实现盈亏
          </TabsTrigger>
        </TabsList>

        <TabsContent value="transactions" className="mt-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div className="relative flex-1 sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="筛选代码..."
                value={tickerFilter}
                onChange={(e) => setTickerFilter(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleReconcile}
                disabled={reconciling}
              >
                <Calculator className="size-4" />
                {reconciling ? '对账中...' : '重算对账'}
              </Button>
              <Button size="sm" onClick={() => setAddTxOpen(true)}>
                <Plus className="size-4" />
                添加交易
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 mb-4 sm:grid-cols-3">
             <Card>
               <CardContent className="p-4">
                 <div className="text-xs text-muted-foreground">交易笔数</div>
                <div className="font-mono-nums text-xl font-semibold mt-1">
                  {txLoading ? '—' : txStats.count}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <ArrowDownToLine className="size-3 text-muted-foreground" />
                  买入总额
                </div>
                <div className="font-mono-nums text-xl font-semibold mt-1 text-foreground">
                  {txLoading ? '—' : formatCurrency(txStats.buyTotal)}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <ArrowUpFromLine className="size-3 text-muted-foreground" />
                  卖出总额
                </div>
                <div className="font-mono-nums text-xl font-semibold mt-1 text-foreground">
                  {txLoading ? '—' : formatCurrency(txStats.sellTotal)}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Desktop Table */}
          <Card className="hidden md:block">
            <CardContent className="p-0">
              {txLoading ? (
                <div className="p-6 space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-9 w-full" />
                  ))}
                </div>
              ) : txError ? (
                <div className="p-12 text-center text-destructive text-sm">
                  {txError}
                </div>
              ) : transactions.length === 0 ? (
                <div className="p-12">
                  <Empty>
                    <EmptyMedia variant="icon">
                      <Receipt />
                    </EmptyMedia>
                    <EmptyHeader>
                      <EmptyTitle>暂无交易记录</EmptyTitle>
                      <EmptyDescription>
                        点击「添加交易」记录第一笔交易
                      </EmptyDescription>
                    </EmptyHeader>
                    <EmptyContent>
                      <Button size="sm" onClick={() => setAddTxOpen(true)}>
                        <Plus className="size-4" />
                        添加交易
                      </Button>
                    </EmptyContent>
                  </Empty>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>日期</TableHead>
                      <TableHead>类型</TableHead>
                      <TableHead>代码</TableHead>
                      <TableHead>币种</TableHead>
                      <TableHead className="text-right">股数</TableHead>
                      <TableHead className="text-right">价格</TableHead>
                      <TableHead className="text-right">手续费</TableHead>
                      <TableHead className="text-right">金额</TableHead>
                      <TableHead className="max-w-[200px]">备注</TableHead>
                      <TableHead className="w-[60px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transactions.map((t) => {
                      const isBuy = t.txType === 'Buy';
                      const isSell = t.txType === 'Sell';
                      const isDeposit = t.txType === 'Deposit';
                      const isWithdrawal = t.txType === 'Withdrawal';
                      const isOpening = t.txType === 'Opening';
                      const amount = isDeposit
                        ? parseFloat(t.shares)
                        : isWithdrawal
                          ? -parseFloat(t.shares)
                          : isOpening
                            ? 0
                            : parseFloat(t.shares) * parseFloat(t.price) +
                              (isBuy
                                ? parseFloat(t.fees || '0')
                                : -parseFloat(t.fees || '0'));
                      const isOutflow = isBuy || isWithdrawal;
                      const typeLabel = isBuy ? '买入' : isSell ? '卖出' : isDeposit ? '存入' : isWithdrawal ? '取款' : '期初';
                      const typeClass = isOpening
                        ? 'bg-slate-500/15 text-slate-300 border-slate-500/30'
                        : isBuy
                          ? 'bg-primary/10 text-primary border-primary/20'
                          : isSell
                            ? 'bg-muted text-muted-foreground border-border'
                            : isDeposit
                              ? 'bg-warning/15 text-warning border-warning/20'
                              : 'bg-destructive/10 text-destructive border-destructive/20';
                      return (
                        <TableRow key={t.id}>
                          <TableCell className="font-mono-nums">
                            {formatDate(t.txDate)}
                          </TableCell>
                          <TableCell>
                            <Badge className={cn(typeClass)} variant="outline">
                              {typeLabel}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono-nums font-semibold text-primary">
                            {t.ticker}
                          </TableCell>
                          <TableCell>
                            <span className="text-xs text-muted-foreground font-mono">
                              {t.currency || 'USD'}
                            </span>
                          </TableCell>
                          <TableCell className="text-right font-mono-nums">
                            {formatShares(t.shares)}
                          </TableCell>
                          <TableCell className="text-right font-mono-nums">
                            {isDeposit || isWithdrawal || isOpening ? '—' : formatPrice(t.price)}
                          </TableCell>
                          <TableCell className="text-right font-mono-nums text-muted-foreground">
                            {formatCurrency(t.fees || '0')}
                          </TableCell>
                          <TableCell
                             className={cn(
                               'text-right font-mono-nums font-medium',
                               isOpening ? 'text-slate-400' : 'text-foreground'
                             )}
                           >
                            {isOpening ? (
                              '—'
                            ) : (
                              <>
                                <span className="text-muted-foreground">
                                  {isOutflow ? '-' : '+'}
                                </span>
                                {formatCurrency(Math.abs(amount))}
                              </>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-xs max-w-[200px] truncate">
                            {t.notes ?? '—'}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              onClick={() => setDeleteTarget(t.id)}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Mobile */}
          <TransactionList
            loading={txLoading}
            error={txError}
            transactions={transactions}
            onAdd={() => setAddTxOpen(true)}
            onDelete={(id) => setDeleteTarget(id)}
          />
        </TabsContent>

        <TabsContent value="realized" className="mt-0">
          {realizedPlLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-32 w-full rounded-lg" />
              <Card>
                <CardContent className="p-6 space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-9 w-full" />
                  ))}
                </CardContent>
              </Card>
            </div>
          ) : realizedPlError ? (
            <div className="p-12 text-center text-destructive text-sm">
              {realizedPlError}
            </div>
          ) : !realizedPl || realizedPl.items.length === 0 ? (
            <div className="p-12">
              <Empty>
                <EmptyMedia variant="icon">
                  <TrendingUp />
                </EmptyMedia>
                <EmptyHeader>
                  <EmptyTitle>暂无已实现盈亏</EmptyTitle>
                  <EmptyDescription>
                    完成平仓后，这里将汇总你的已实现盈亏表现
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button size="sm" onClick={() => setAddClosedOpen(true)}>
                    <Plus className="size-4" />
                    添加已平仓
                  </Button>
                </EmptyContent>
              </Empty>
            </div>
          ) : (
            <RealizedPlContent summary={realizedPl} onAddClosed={() => setAddClosedOpen(true)} />
          )}
        </TabsContent>
      </Tabs>

      <AddTransactionDialog
        open={addTxOpen}
        onOpenChange={setAddTxOpen}
        onCreated={() => {
          loadTransactions();
          loadClosed();
          notifyPortfolioUpdate();
        }}
      />

      <AddClosedDialog
        open={addClosedOpen}
        onOpenChange={setAddClosedOpen}
        onCreated={() => {
          loadClosed();
          loadRealizedPl();
        }}
      />

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除这笔交易记录吗？此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? '删除中...' : '确认删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function RealizedPlContent({
  summary,
  onAddClosed,
}: {
  summary: RealizedPlSummary;
  onAddClosed: () => void;
}) {
  const totalPl = Object.values(summary.totalByCurrency).reduce(
    (acc, v) => acc + parseFloat(v || '0'),
    0
  );
  const isPositive = totalPl >= 0;
  const currencies = Object.entries(summary.totalByCurrency).filter(
    ([, v]) => parseFloat(v || '0') !== 0
  );
  const sortedItems = [...summary.items].sort(
    (a, b) => parseFloat(b.realizedPl) - parseFloat(a.realizedPl)
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={onAddClosed}>
          <Plus className="size-4" />
          添加已平仓
        </Button>
      </div>

      {/* Total summary card */}
      <Card
        className={cn(
          'overflow-hidden border-0',
          isPositive
            ? 'bg-gradient-to-br from-success/15 via-success/5 to-transparent'
            : 'bg-gradient-to-br from-destructive/15 via-destructive/5 to-transparent'
        )}
      >
        <CardContent className="p-6 md:p-8">
          <div className="text-sm font-medium text-muted-foreground">
            Total Realized P&L
          </div>
          <div
            className={cn(
              'mt-2 font-mono-nums text-4xl md:text-5xl font-bold tracking-tight',
              isPositive ? 'text-success' : 'text-destructive'
            )}
          >
            {isPositive ? '+' : ''}
            {formatCurrency(totalPl)}
          </div>
          <div className="mt-3 flex items-center gap-3 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="font-semibold text-success">
                {summary.totalWinners}
              </span>
              笔盈利
            </span>
            <span className="text-border">·</span>
            <span className="flex items-center gap-1">
              <span className="font-semibold text-destructive">
                {summary.totalLosers}
              </span>
              笔亏损
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Per-currency breakdown */}
      {currencies.length > 1 && (
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              分币种汇总
            </div>
            {currencies.map(([currency, value]) => {
              const num = parseFloat(value);
              return (
                <div
                  key={currency}
                  className="flex items-center justify-between py-1.5 border-b last:border-b-0 border-border/50"
                >
                  <span className="text-sm text-muted-foreground font-mono">
                    {currency}
                  </span>
                  <span
                    className={cn(
                      'font-mono-nums font-semibold',
                      plClass(value)
                    )}
                  >
                    {num >= 0 ? '+' : ''}
                    {formatCurrencyWithCurrency(value, currency)}
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Desktop table */}
      <Card className="hidden md:block">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>股票</TableHead>
                <TableHead>已实现盈亏</TableHead>
                <TableHead className="text-right">收益率</TableHead>
                <TableHead className="text-right">累计平仓股数</TableHead>
                <TableHead className="text-right">平仓次数</TableHead>
                <TableHead className="text-right">最近平仓</TableHead>
                <TableHead className="text-right">币种</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedItems.map((item) => (
                <TableRow key={item.ticker}>
                  <TableCell>
                    <div className="font-mono-nums font-semibold text-primary">
                      {item.ticker}
                    </div>
                    <div className="text-xs text-muted-foreground truncate max-w-[180px]">
                      {item.company ?? '—'}
                    </div>
                  </TableCell>
                  <TableCell
                    className={cn(
                      'font-mono-nums font-semibold',
                      plClass(item.realizedPl)
                    )}
                  >
                    {parseFloat(item.realizedPl) >= 0 ? '+' : ''}
                    {formatCurrencyWithCurrency(item.realizedPl, item.currency)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      'text-right font-mono-nums font-medium',
                      plClass(item.returnPct)
                    )}
                  >
                    {formatPercent(item.returnPct)}
                  </TableCell>
                  <TableCell className="text-right font-mono-nums">
                    {formatShares(item.totalShares)}
                  </TableCell>
                  <TableCell className="text-right font-mono-nums text-muted-foreground">
                    {item.closeCount}
                  </TableCell>
                  <TableCell className="text-right font-mono-nums text-muted-foreground">
                    {formatDate(item.lastCloseDate)}
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="text-xs text-muted-foreground font-mono">
                      {item.currency}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {sortedItems.map((item) => (
          <Card key={item.ticker}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between mb-2">
                <div className="min-w-0 flex-1">
                  <div className="font-mono-nums font-bold text-primary text-lg">
                    {item.ticker}
                  </div>
                  <div className="text-sm text-muted-foreground truncate">
                    {item.company ?? '—'}
                  </div>
                </div>
                <div className="text-right">
                  <div
                    className={cn(
                      'font-mono-nums text-lg font-semibold',
                      plClass(item.realizedPl)
                    )}
                  >
                    {parseFloat(item.realizedPl) >= 0 ? '+' : ''}
                    {formatCurrencyWithCurrency(item.realizedPl, item.currency)}
                  </div>
                  <div
                    className={cn(
                      'font-mono-nums text-sm',
                      plClass(item.returnPct)
                    )}
                  >
                    {formatPercent(item.returnPct)}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-sm pt-2 border-t border-border/50">
                <div>
                  <div className="text-xs text-muted-foreground">股数</div>
                  <div className="font-mono-nums">
                    {formatShares(item.totalShares)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">次数</div>
                  <div className="font-mono-nums">{item.closeCount}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">最近</div>
                  <div className="font-mono-nums text-xs">
                    {formatDate(item.lastCloseDate)}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}


