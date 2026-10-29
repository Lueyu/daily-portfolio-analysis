/**
 * @file pages/Paper/PaperPage.tsx
 * @description Route `/paper`: the AI paper-trading terminal.
 *
 * Sections:
 *  - KPI cards (equity, cash, today's P&L, total P&L, today's orders)
 *  - Watchbot card: on/off toggle, scan-now button, circuit-breaker status,
 *    guardrail settings dialog, account reset
 *  - Equity curve (ECharts)
 *  - Paper positions with live-ish market values and unrealized P&L
 *  - Order feed with status badges (filled / rejected by risk gate) and
 *    per-order bot reasons
 *  - Activity timeline (bot scans, fills, guardrail triggers)
 *  - Notification channel manager (webhook / bark / serverchan / smtp /
 *    telegram) with test-send
 *  - Manual order dialog (market orders, same solvency checks as the bot)
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Bot,
  BotOff,
  PlayCircle,
  Wallet,
  TrendingUp,
  TrendingDown,
  Activity,
  Settings2,
  RotateCcw,
  BellRing,
  Plus,
  Trash2,
  FlaskConical,
  ShieldAlert,
  Loader2,
} from 'lucide-react';
import ReactECharts from 'echarts-for-react';

import {
  fetchPaperOverview,
  placePaperOrder,
  runPaperBot,
  togglePaperBot,
  updatePaperGuardrails,
  resetPaperAccount,
  fetchNotificationChannels,
  createNotificationChannel,
  deleteNotificationChannel,
  setNotificationChannelEnabled,
  testNotificationChannel,
} from '@/api';
import type {
  CreatePaperOrderDto,
  NotificationChannelType,
  PaperOverview,
} from '@shared/api.interface';
import { cn } from '@/utils/format';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** Money formatter for USD figures. */
const usd = (v: string | null | undefined) =>
  v == null
    ? '—'
    : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Signed percent formatter. */
const pct = (v: string | null | undefined) =>
  v == null ? '—' : `${Number(v) >= 0 ? '+' : ''}${Number(v).toFixed(2)}%`;

/** Badge styles per order status. */
const orderStatusStyles: Record<string, string> = {
  filled: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  rejected_risk: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30',
  cancelled: 'bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/30',
  pending: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
  failed: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30',
};
const orderStatusLabel: Record<string, string> = {
  filled: '已成交',
  rejected_risk: '风控拦截',
  cancelled: '已撤销',
  pending: '待成交',
  failed: '失败',
};
const eventLabel: Record<string, string> = {
  bot_started: '盯盘开启',
  bot_stopped: '盯盘停止',
  bot_scan: '例行扫描',
  order_placed: '下单',
  order_filled: '成交',
  order_rejected: '风控拦截',
  circuit_breaker: '熔断触发',
  manual_action: '手动操作',
  account_reset: '账户重置',
};

function PaperPage() {
  const queryClient = useQueryClient();
  const [orderOpen, setOrderOpen] = useState(false);
  const [guardrailsOpen, setGuardrailsOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  const overviewQuery = useQuery<PaperOverview>({
    queryKey: ['paper', 'overview'],
    queryFn: fetchPaperOverview,
    refetchInterval: 60_000,
  });
  const overview = overviewQuery.data;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['paper'] });

  const toggleMutation = useMutation({
    mutationFn: (enabled: boolean) => togglePaperBot(enabled),
    onSuccess: (account) => {
      toast.success(account.botEnabled ? 'AI 盯盘已开启：按你的分析评级自动跑模拟盘' : 'AI 盯盘已停止');
      invalidate();
    },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '操作失败'),
  });

  const scanMutation = useMutation({
    mutationFn: runPaperBot,
    onSuccess: (result) => {
      if (result.placed === 0 && result.rejected === 0) {
        toast.info(`扫描了 ${result.scanned} 个信号源，本次无可执行信号`);
      } else {
        toast.success(`扫描完成：下单 ${result.placed} 笔，拦截 ${result.rejected} 笔`);
      }
      invalidate();
    },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '扫描失败'),
  });

  const resetMutation = useMutation({
    mutationFn: (initialCash?: number) => resetPaperAccount(initialCash),
    onSuccess: () => {
      toast.success('模拟盘已重置');
      setResetOpen(false);
      invalidate();
    },
  });

  const busy = overviewQuery.isLoading;
  const botOn = overview?.account.botEnabled ?? false;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-serif text-2xl font-semibold">
            <FlaskConical size={22} className="text-primary" />
            AI 模拟盘
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            独立于真实记录的虚拟账户——AI 按你的分析评级全天候盯盘下单，全程受风控守护。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setOrderOpen(true)}>
            手动下单
          </Button>
          <Button
            variant={botOn ? 'destructive' : 'default'}
            onClick={() => toggleMutation.mutate(!botOn)}
            disabled={toggleMutation.isPending || busy}
          >
            {botOn ? <BotOff size={16} className="mr-1" /> : <Bot size={16} className="mr-1" />}
            {botOn ? '停止盯盘' : '开启 AI 盯盘'}
          </Button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">模拟盘净值 (USD)</div>
          <div className="mt-1 font-mono-nums text-xl font-semibold">${usd(overview?.equity)}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-1 text-xs text-muted-foreground"><Wallet size={12} /> 现金</div>
          <div className="mt-1 font-mono-nums text-xl font-semibold">${usd(overview?.account.cashBalance)}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            {Number(overview?.todayPl ?? 0) >= 0 ? <TrendingUp size={12} className="text-success" /> : <TrendingDown size={12} className="text-destructive" />}
            今日盈亏
          </div>
          <div className={cn('mt-1 font-mono-nums text-xl font-semibold', Number(overview?.todayPl ?? 0) >= 0 ? 'text-success' : 'text-destructive')}>
            ${usd(overview?.todayPl)}
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">总收益</div>
          <div className={cn('mt-1 font-mono-nums text-xl font-semibold', Number(overview?.totalPl ?? 0) >= 0 ? 'text-success' : 'text-destructive')}>
            ${usd(overview?.totalPl)}
            <span className="ml-1 text-sm">({pct(overview?.totalPlPct)})</span>
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">今日 bot 订单</div>
          <div className="mt-1 font-mono-nums text-xl font-semibold">{overview?.todayOrderCount ?? 0}</div>
        </CardContent></Card>
      </div>

      {/* Bot control bar */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <Badge
            variant="outline"
            className={cn(
              'gap-1.5 py-1',
              botOn
                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                : 'bg-slate-500/10 text-muted-foreground border-border',
            )}
          >
            {botOn ? <Bot size={12} /> : <BotOff size={12} />}
            {botOn ? 'AI 正在盯盘' : '盯盘未开启'}
          </Badge>
          {overview?.circuitBreakerActive && (
            <Badge variant="outline" className="gap-1.5 border-rose-500/40 bg-rose-500/15 py-1 text-rose-600 dark:text-rose-400">
              <ShieldAlert size={12} /> 日亏损熔断已触发
            </Badge>
          )}
          <span className="text-xs text-muted-foreground">
            守护：日亏损 {overview?.account.guardrails.dailyLossLimitPct ?? 3}% 熔断 · 单笔 ≤ {overview?.account.guardrails.maxOrderPct ?? 5}% · 日限 {overview?.account.guardrails.maxOrdersPerDay ?? 10} 笔
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => scanMutation.mutate()} disabled={!botOn || scanMutation.isPending}>
              {scanMutation.isPending ? <Loader2 size={14} className="mr-1 animate-spin" /> : <PlayCircle size={14} className="mr-1" />}
              立即扫描
            </Button>
            <Button variant="outline" size="sm" onClick={() => setGuardrailsOpen(true)}>
              <Settings2 size={14} className="mr-1" /> 风控参数
            </Button>
            <Button variant="outline" size="sm" onClick={() => setResetOpen(true)}>
              <RotateCcw size={14} className="mr-1" /> 重置
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Equity curve */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">净值曲线</CardTitle></CardHeader>
        <CardContent className="p-2 pt-0">
          <PaperEquityChart data={overview?.curve ?? []} />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Positions */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">模拟持仓（{overview?.positions.length ?? 0}）</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-4 py-2 font-medium">股票</th>
                    <th className="px-4 py-2 font-medium">股数</th>
                    <th className="px-4 py-2 font-medium">成本/现价</th>
                    <th className="px-4 py-2 text-right font-medium">浮盈亏</th>
                  </tr>
                </thead>
                <tbody>
                  {(overview?.positions ?? []).map((p) => {
                    const pl = Number(p.unrealizedPl ?? 0);
                    const pctVal = Number(p.unrealizedPct ?? 0);
                    return (
                      <tr key={p.id} className="border-b last:border-0">
                        <td className="px-4 py-2.5">
                          <div className="font-medium">{p.ticker}</div>
                          <div className="text-xs text-muted-foreground">{p.company ?? ''}</div>
                        </td>
                        <td className="px-4 py-2.5 font-mono-nums">{Number(p.shares)}</td>
                        <td className="px-4 py-2.5 font-mono-nums text-xs">
                          {Number(p.avgCost).toFixed(2)} / {p.lastPrice ?? '—'}
                        </td>
                        <td className={cn('px-4 py-2.5 text-right font-mono-nums', pl >= 0 ? 'text-success' : 'text-destructive')}>
                          {pl >= 0 ? '+' : ''}${usd(p.unrealizedPl)}
                          <span className="ml-1 text-xs">({pctVal >= 0 ? '+' : ''}{pctVal.toFixed(2)}%)</span>
                        </td>
                      </tr>
                    );
                  })}
                  {(overview?.positions.length ?? 0) === 0 && (
                    <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">
                      暂无模拟持仓——开启 AI 盯盘或手动下单试试
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Events */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-1.5 text-sm"><Activity size={14} /> 盯盘动态</CardTitle></CardHeader>
          <CardContent className="max-h-80 space-y-2 overflow-y-auto p-4">
            {(overview?.recentEvents ?? []).map((e) => (
              <div key={e.id} className="flex items-start gap-2 text-sm">
                <Badge
                  variant="outline"
                  className={cn(
                    'shrink-0 text-[10px]',
                    e.eventType === 'order_filled' && 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
                    e.eventType === 'circuit_breaker' && 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
                    (e.eventType === 'order_rejected') && 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
                  )}
                >
                  {eventLabel[e.eventType] ?? e.eventType}
                </Badge>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs text-foreground/90">{summarizeEvent(e.eventType, e.detail)}</div>
                  <div className="text-[10px] text-muted-foreground">{new Date(e.createdAt).toLocaleString('zh-CN', { hour12: false })}</div>
                </div>
              </div>
            ))}
            {(overview?.recentEvents.length ?? 0) === 0 && (
              <div className="py-8 text-center text-sm text-muted-foreground">暂无动态</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Orders feed */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">订单流</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">时间</th>
                  <th className="px-4 py-2 font-medium">股票</th>
                  <th className="px-4 py-2 font-medium">方向</th>
                  <th className="px-4 py-2 font-medium">数量</th>
                  <th className="px-4 py-2 font-medium">成交价</th>
                  <th className="px-4 py-2 font-medium">状态</th>
                  <th className="px-4 py-2 font-medium">来源</th>
                  <th className="px-4 py-2 font-medium">理由</th>
                </tr>
              </thead>
              <tbody>
                {(overview?.recentOrders ?? []).map((o) => (
                  <tr key={o.id} className="border-b last:border-0">
                    <td className="px-4 py-2.5 whitespace-nowrap text-xs text-muted-foreground">
                      {new Date(o.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}
                    </td>
                    <td className="px-4 py-2.5 font-medium">{o.ticker}</td>
                    <td className={cn('px-4 py-2.5 font-medium', o.side === 'buy' ? 'text-success' : 'text-destructive')}>
                      {o.side === 'buy' ? '买入' : '卖出'}
                    </td>
                    <td className="px-4 py-2.5 font-mono-nums">{Number(o.quantity)}</td>
                    <td className="px-4 py-2.5 font-mono-nums">{o.filledPrice ?? '—'}</td>
                    <td className="px-4 py-2.5">
                      <Badge variant="outline" className={cn('text-[10px]', orderStatusStyles[o.status])}>
                        {orderStatusLabel[o.status] ?? o.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      {o.source === 'agent' ? '🤖 AI' : '👤 手动'}
                    </td>
                    <td className="max-w-xs px-4 py-2.5 text-xs text-muted-foreground">
                      <div className="truncate" title={o.reason ?? ''}>{o.reason ?? '—'}</div>
                    </td>
                  </tr>
                ))}
                {(overview?.recentOrders.length ?? 0) === 0 && (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">暂无订单</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Notifications */}
      <NotificationChannelsCard />

      {/* Dialogs */}
      <ManualOrderDialog open={orderOpen} onOpenChange={setOrderOpen} onDone={invalidate} />
      <GuardrailsDialog open={guardrailsOpen} onOpenChange={setGuardrailsOpen} overview={overview} onDone={invalidate} />
      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>重置模拟盘</DialogTitle>
            <DialogDescription>
              将清空全部模拟持仓、订单与曲线，现金恢复为初始值。此操作不影响你的真实持仓记录。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setResetOpen(false)}>取消</Button>
            <Button variant="destructive" onClick={() => resetMutation.mutate(undefined)} disabled={resetMutation.isPending}>
              {resetMutation.isPending ? '重置中…' : '确认重置'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Equity line chart for the paper account. */
function PaperEquityChart({ data }: { data: Array<{ date: string; equity: string; dailyPl: string }> }) {
  const option = useMemo(() => {
    if (data.length === 0) return {};
    return {
      tooltip: { trigger: 'axis' },
      grid: { top: 20, right: 20, bottom: 30, left: 70 },
      xAxis: {
        type: 'category',
        data: data.map((d) => d.date.slice(5)),
        axisLabel: { fontSize: 10, color: '#94a3b8' },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        scale: true,
        axisLabel: {
          fontSize: 10,
          color: '#94a3b8',
          formatter: (v: number) => `$${(v / 1000).toFixed(0)}k`,
        },
        splitLine: { lineStyle: { color: 'rgba(148,163,184,0.15)' } },
      },
      series: [
        {
          name: '净值',
          type: 'line',
          smooth: true,
          symbol: 'circle',
          symbolSize: 5,
          data: data.map((d) => Number(d.equity)),
          lineStyle: { color: 'hsl(152 55% 48%)', width: 2 },
          itemStyle: { color: 'hsl(152 55% 48%)' },
          areaStyle: {
            color: {
              type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(47,158,110,0.25)' },
                { offset: 1, color: 'rgba(47,158,110,0)' },
              ],
            },
          },
        },
      ],
    };
  }, [data]);
  if (data.length === 0) {
    return <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">开启盯盘后，每日会自动记录净值快照</div>;
  }
  return <ReactECharts option={option} style={{ height: 260 }} notMerge />;
}

/** One-line Chinese summary for a timeline event. */
function summarizeEvent(type: string, detail: Record<string, unknown> | null): string {
  const d = detail ?? {};
  if (type === 'order_filled') {
    const side = d.side === 'buy' ? '买入' : '卖出';
    const pl = d.realizedPl != null ? `，已实现 ${Number(d.realizedPl) >= 0 ? '+' : ''}${d.realizedPl}` : '';
    return `${d.ticker} ${side} ${d.quantity} 股 @ ${d.price}${pl}`;
  }
  if (type === 'order_rejected') {
    const side = d.side === 'buy' ? '买入' : '卖出';
    return `${d.ticker} ${side}被拦截：${d.reason ?? ''}`;
  }
  if (type === 'circuit_breaker') return `熔断：${d.reason ?? '日亏损超限，今日停止交易'}`;
  if (type === 'bot_scan') {
    return `扫描 ${d.scanned} 个信号源，下单 ${d.placed} 笔，拦截 ${d.rejected} 笔`;
  }
  if (type === 'bot_started') return 'AI 盯盘开启，信号源为你的每日分析评级';
  if (type === 'bot_stopped') return 'AI 盯盘停止';
  if (type === 'account_reset') return `账户重置，初始资金 ${d.initialCash ?? ''}`;
  return JSON.stringify(d);
}

/** Manual market-order dialog. */
function ManualOrderDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void }) {
  const [ticker, setTicker] = useState('');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [quantity, setQuantity] = useState('10');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const dto: CreatePaperOrderDto = {
      ticker: ticker.trim(),
      side,
      quantity: Number(quantity),
      orderType: 'market',
    };
    try {
      setSubmitting(true);
      const order = await placePaperOrder(dto);
      if (order.status === 'filled') {
        toast.success(`${order.ticker} ${side === 'buy' ? '买入' : '卖出'}成交 @ ${order.filledPrice}`);
      } else {
        toast.warning(`订单被拦截：${order.reason ?? '风控未通过'}`);
      }
      onOpenChange(false);
      setTicker('');
      onDone();
    } catch (error) {
      toast.error((error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '下单失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>模拟盘手动下单</DialogTitle>
          <DialogDescription>市价单，立即按当前可获取价格成交（仅影响模拟盘）。</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>股票代码</Label>
            <Input placeholder="如 NVDA / 0700 / 600519" value={ticker} onChange={(e) => setTicker(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>方向</Label>
            <Select value={side} onValueChange={(v) => setSide(v as 'buy' | 'sell')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="buy">买入</SelectItem>
                <SelectItem value="sell">卖出</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>数量（股）</Label>
            <Input type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={submit} disabled={submitting || !ticker.trim()}>
            {submitting ? '下单中…' : '下单'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Guardrail thresholds dialog. */
function GuardrailsDialog({ open, onOpenChange, overview, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; overview: PaperOverview | undefined; onDone: () => void }) {
  const g = overview?.account.guardrails;
  const [loss, setLoss] = useState(String(g?.dailyLossLimitPct ?? 3));
  const [orderPct, setOrderPct] = useState(String(g?.maxOrderPct ?? 5));
  const [daily, setDaily] = useState(String(g?.maxOrdersPerDay ?? 10));
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    try {
      setSubmitting(true);
      await updatePaperGuardrails({
        dailyLossLimitPct: Number(loss),
        maxOrderPct: Number(orderPct),
        maxOrdersPerDay: Number(daily),
      });
      toast.success('风控参数已更新');
      onOpenChange(false);
      onDone();
    } catch {
      toast.error('保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>风控守护参数</DialogTitle>
          <DialogDescription>约束 AI 盯盘代理的下单行为；手动下单不受频次与金额上限限制。</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>日亏损熔断线（%）</Label>
            <Input type="number" min={0.5} step={0.5} value={loss} onChange={(e) => setLoss(e.target.value)} />
            <p className="text-xs text-muted-foreground">当日权益回撤达到该比例后，今日停止 bot 交易</p>
          </div>
          <div className="space-y-2">
            <Label>单笔金额上限（占净值 %）</Label>
            <Input type="number" min={0.5} step={0.5} value={orderPct} onChange={(e) => setOrderPct(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>每日订单上限（笔）</Label>
            <Input type="number" min={1} value={daily} onChange={(e) => setDaily(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={submit} disabled={submitting}>{submitting ? '保存中…' : '保存'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Channel type metadata for the manager UI. */
const CHANNEL_META: Record<NotificationChannelType, { name: string; hint: string; fields: Array<{ key: string; label: string; placeholder: string }> }> = {
  webhook: {
    name: 'Webhook',
    hint: '通用 JSON POST，可接 Twilio 短信网关等任意服务',
    fields: [{ key: 'url', label: 'Webhook URL', placeholder: 'https://example.com/hook' }],
  },
  bark: {
    name: 'Bark (iOS)',
    hint: '手机安装 Bark App 后复制推送 Key',
    fields: [
      { key: 'key', label: 'Bark Key', placeholder: '你的设备 Key' },
      { key: 'server', label: '自建服务器（可选）', placeholder: 'https://api.day.app' },
    ],
  },
  serverchan: {
    name: 'Server酱（微信）',
    hint: 'sct.ftqq.com 获取 SendKey，消息送达微信服务号',
    fields: [{ key: 'key', label: 'SendKey', placeholder: 'SCT...' }],
  },
  smtp: {
    name: '邮件 (SMTP)',
    hint: '任意邮箱的 SMTP 发信配置',
    fields: [
      { key: 'host', label: 'SMTP 服务器', placeholder: 'smtp.example.com' },
      { key: 'port', label: '端口', placeholder: '465' },
      { key: 'user', label: '用户名', placeholder: 'you@example.com' },
      { key: 'pass', label: '密码/授权码', placeholder: '••••••' },
      { key: 'to', label: '收件邮箱', placeholder: 'you@example.com' },
    ],
  },
  telegram: {
    name: 'Telegram',
    hint: '与 @BotFather 创建的机器人对话后获取',
    fields: [
      { key: 'token', label: 'Bot Token', placeholder: '123456:ABC-...' },
      { key: 'chatId', label: 'Chat ID', placeholder: '你的 chat id' },
    ],
  },
};

/** Notification channel manager card. */
function NotificationChannelsCard() {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [channelType, setChannelType] = useState<NotificationChannelType>('webhook');
  const [label, setLabel] = useState('');
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const channelsQuery = useQuery({
    queryKey: ['notifications', 'channels'],
    queryFn: fetchNotificationChannels,
  });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['notifications'] });

  const addChannel = async () => {
    const config: Record<string, string> = {};
    for (const f of CHANNEL_META[channelType].fields) {
      const v = (fieldValues[f.key] ?? '').trim();
      if (v) config[f.key] = v;
    }
    if (Object.keys(config).length === 0) {
      toast.warning('请至少填写一个配置项');
      return;
    }
    try {
      setSubmitting(true);
      await createNotificationChannel({ channelType, label: label.trim() || undefined, config });
      toast.success('渠道已添加，建议发送一条测试消息验证');
      setAddOpen(false);
      setFieldValues({});
      setLabel('');
      invalidate();
    } catch {
      toast.error('添加失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-1.5 text-sm">
          <BellRing size={14} /> 成交通知
        </CardTitle>
        <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
          <Plus size={14} className="mr-1" /> 添加渠道
        </Button>
      </CardHeader>
      <CardContent className="space-y-2 p-4">
        <p className="text-xs text-muted-foreground">
          AI 成交、风控拦截与熔断会推送到你配置的渠道。配置只存在你自己的数据库里。
        </p>
        {(channelsQuery.data ?? []).map((ch) => (
          <div key={ch.id} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
            <Badge variant="outline" className="shrink-0 text-[10px]">{CHANNEL_META[ch.channelType]?.name ?? ch.channelType}</Badge>
            <span className="truncate text-foreground/90">{ch.label ?? Object.values(ch.config)[0] ?? ''}</span>
            <div className="ml-auto flex items-center gap-2">
              <Switch checked={ch.enabled} onCheckedChange={async (v) => { await setNotificationChannelEnabled(ch.id, v); invalidate(); }} />
              <Button
                variant="ghost" size="sm"
                onClick={async () => {
                  const r = await testNotificationChannel(ch.id);
                  if (r.ok) toast.success('测试消息已发送');
                  else toast.error(`发送失败：${r.error ?? '未知错误'}`);
                }}
              >
                测试
              </Button>
              <Button
                variant="ghost" size="sm"
                onClick={async () => { await deleteNotificationChannel(ch.id); invalidate(); }}
              >
                <Trash2 size={14} className="text-destructive" />
              </Button>
            </div>
          </div>
        ))}
        {(channelsQuery.data ?? []).length === 0 && (
          <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            还没有通知渠道——支持 Webhook / Bark / Server酱 / 邮件 / Telegram
          </div>
        )}
      </CardContent>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>添加通知渠道</DialogTitle>
            <DialogDescription>{CHANNEL_META[channelType].hint}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>渠道类型</Label>
              <Select value={channelType} onValueChange={(v) => { setChannelType(v as NotificationChannelType); setFieldValues({}); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(CHANNEL_META) as NotificationChannelType[]).map((k) => (
                    <SelectItem key={k} value={k}>{CHANNEL_META[k].name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>备注名（可选）</Label>
              <Input placeholder="如 我的 iPhone" value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>
            {CHANNEL_META[channelType].fields.map((f) => (
              <div key={f.key} className="space-y-2">
                <Label>{f.label}</Label>
                <Input
                  placeholder={f.placeholder}
                  value={fieldValues[f.key] ?? ''}
                  onChange={(e) => setFieldValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>取消</Button>
            <Button onClick={addChannel} disabled={submitting}>{submitting ? '添加中…' : '添加'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default PaperPage;
