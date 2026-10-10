/**
 * @file pages/Transactions/AddTransactionDialog.tsx
 * @description Create-a-transaction dialog.
 *
 * Supports Buy, Sell, Deposit, and Withdrawal types. Deposit/Withdrawal are
 * cash flows (no ticker/price; shares field holds the amount). When a Buy
 * fails with a server-side "insufficient cash" error, a secondary alert offers
 * to either auto-deposit the shortfall and retry, or switch the form to a
 * manual Deposit for the shortfall amount.
 */
import { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import type { TxType, Currency, StockSearchResult } from '@shared/api.interface';
import { createTransaction, createTransactionWithAutoDeposit } from '@/api';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import TickerSearch from '@/components/ui/ticker-search';

/** Props for {@link AddTransactionDialog}. */
interface AddTransactionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  defaultTicker?: string;
  defaultCurrency?: Currency;
  defaultTxType?: TxType;
}

/**
 * Render the add-transaction dialog with controlled form state and the
 * cash-shortfall recovery flow.
 */
export default function AddTransactionDialog({
  open,
  onOpenChange,
  onCreated,
  defaultTicker = '',
  defaultCurrency = 'USD',
  defaultTxType = 'Buy',
}: AddTransactionDialogProps) {
  const [saving, setSaving] = useState(false);
  const [tickerInvalid, setTickerInvalid] = useState(false);
  const [form, setForm] = useState({
    txDate: new Date().toISOString().slice(0, 10),
    txType: 'Buy' as TxType,
    ticker: defaultTicker,
    shares: '',
    price: '',
    fees: '',
    notes: '',
    currency: defaultCurrency as Currency,
  });

  const [cashShortfallOpen, setCashShortfallOpen] = useState(false);
  const [shortfallInfo, setShortfallInfo] = useState<{
    currency: Currency;
    currentBalance: number;
    required: number;
    shortfall: number;
  } | null>(null);
  const [autoDepositing, setAutoDepositing] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({
        txDate: new Date().toISOString().slice(0, 10),
        txType: defaultTxType,
        ticker: defaultTicker,
        shares: '',
        price: '',
        fees: '',
        notes: '',
        currency: defaultCurrency,
      });
      setCashShortfallOpen(false);
      setShortfallInfo(null);
    }
  }, [open, defaultTicker, defaultCurrency, defaultTxType]);

  const isCashFlow = form.txType === 'Deposit' || form.txType === 'Withdrawal';

  /** Estimated cash required for a Buy/Sell: shares × price + fees. */
  const requiredAmount = useMemo(() => {
    if (isCashFlow) return 0;
    const shares = parseFloat(form.shares) || 0;
    const price = parseFloat(form.price) || 0;
    const fees = parseFloat(form.fees) || 0;
    return shares * price + fees;
  }, [form.shares, form.price, form.fees, isCashFlow]);

  /** Extract a human-readable error message from an unknown thrown value. */
  const extractErrMsg = (err: unknown): string => {
    const rawMsg = err instanceof Error ? err.message : '添加失败';
    const respErr = (err as { response?: { data?: { message?: string; error?: string } } })
      ?.response?.data;
    return respErr?.message || respErr?.error || rawMsg;
  };

  /**
   * Parse a server "insufficient cash" error message to extract the currency,
   * current balance, required amount, and shortfall. Returns null when the
   * message does not match the expected format.
   */
  const parseCashShortfall = (msg: string): {
    currency: Currency;
    currentBalance: number;
    required: number;
    shortfall: number;
  } | null => {
    const cashMatch = msg.match(/现金不足[：:].*余额\s*([\d.]+).*需要\s*([\d.]+)/);
    const currencyMatch = msg.match(/现金不足[：:]\s*([A-Z]{3})/);
    if (!cashMatch) return null;
    const cur = (currencyMatch?.[1] || form.currency) as Currency;
    const balance = Number(cashMatch[1]);
    const needed = Number(cashMatch[2]);
    return {
      currency: cur,
      currentBalance: balance,
      required: needed,
      shortfall: Math.max(0, needed - balance),
    };
  };

  /** Build the POST payload; cash flows use price=1 and empty ticker. */
  const buildPayload = (): Record<string, string | number> => {
    const payload: Record<string, string | number> = {
      txDate: form.txDate,
      txType: form.txType,
      ticker: isCashFlow ? '' : form.ticker.trim().toUpperCase(),
      shares: parseFloat(form.shares),
      price: isCashFlow ? 1 : parseFloat(form.price),
      currency: form.currency,
    };
    if (form.fees) payload.fees = parseFloat(form.fees);
    if (form.notes) payload.notes = form.notes;
    return payload;
  };

  /** Validate and submit; on insufficient-cash error for a Buy, open the recovery dialog. */
  const handleSubmit = async () => {
    if (!form.txDate) {
      toast.error('请选择日期');
      return;
    }
    if (!isCashFlow && !form.ticker.trim()) {
      setTickerInvalid(true);
      toast.error('请选择或输入股票代码');
      return;
    }
    if (!form.shares || parseFloat(form.shares) <= 0) {
      toast.error(isCashFlow ? '请输入有效的金额' : '请输入有效的股数');
      return;
    }
    if (!isCashFlow && (!form.price || parseFloat(form.price) <= 0)) {
      toast.error('请输入有效的价格');
      return;
    }
    setSaving(true);
    try {
      const payload = buildPayload();
      await createTransaction(payload);
      toast.success(isCashFlow ? '现金变动已记录' : '交易已记录');
      onOpenChange(false);
      onCreated();
    } catch (err: unknown) {
      const msg = extractErrMsg(err);
      const shortfall = parseCashShortfall(msg);
      if (shortfall && form.txType === 'Buy') {
        setShortfallInfo(shortfall);
        setCashShortfallOpen(true);
      } else {
        toast.error(msg);
      }
    } finally {
      setSaving(false);
    }
  };

  /** Auto-deposit the shortfall and retry the buy in one server call. */
  const handleAutoDeposit = async () => {
    if (!shortfallInfo) return;
    setAutoDepositing(true);
    try {
      const payload = buildPayload();
      await createTransactionWithAutoDeposit(payload);
      toast.success('已自动充值并完成买入');
      setCashShortfallOpen(false);
      setShortfallInfo(null);
      onOpenChange(false);
      onCreated();
    } catch (err: unknown) {
      const msg = extractErrMsg(err);
      toast.error(msg);
    } finally {
      setAutoDepositing(false);
    }
  };

  /** Switch the main form to a Deposit prefilled with the shortfall amount. */
  const handleGoToDeposit = () => {
    if (!shortfallInfo) return;
    setForm({
      txDate: form.txDate,
      txType: 'Deposit',
      ticker: '',
      shares: shortfallInfo.shortfall.toFixed(2),
      price: '',
      fees: '',
      notes: '',
      currency: shortfallInfo.currency,
    });
    setCashShortfallOpen(false);
    setShortfallInfo(null);
  };

  /** Apply a ticker from the search dropdown and adopt its currency. */
  const handleTickerSelect = (result: StockSearchResult) => {
    setTickerInvalid(false);
    setForm((prev) => ({
      ...prev,
      ticker: result.symbol.toUpperCase(),
      currency: result.currency,
    }));
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl">
              {isCashFlow ? '记录现金变动' : '添加交易记录'}
            </DialogTitle>
            <DialogDescription>
              {isCashFlow ? '记录一笔存入或取款' : '记录一笔买入或卖出交易'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="space-y-1.5">
              <Label>
                日期 <span className="text-destructive">*</span>
              </Label>
              <Input
                type="date"
                value={form.txDate}
                onChange={(e) => setForm({ ...form, txDate: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>
                类型 <span className="text-destructive">*</span>
              </Label>
              <Select
                value={form.txType}
                onValueChange={(v) => setForm({ ...form, txType: v as TxType })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Buy">买入 (Buy)</SelectItem>
                  <SelectItem value="Sell">卖出 (Sell)</SelectItem>
                  <SelectItem value="Deposit">存入 (Deposit)</SelectItem>
                  <SelectItem value="Withdrawal">取款 (Withdrawal)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>
                币种 <span className="text-destructive">*</span>
              </Label>
              <Select
                value={form.currency}
                onValueChange={(v) => setForm({ ...form, currency: v as Currency })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD / 美元</SelectItem>
                  <SelectItem value="HKD">HKD / 港币</SelectItem>
                  <SelectItem value="CNY">CNY / 人民币</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {!isCashFlow && (
              <div className="space-y-1.5 col-span-2">
                <Label>
                  股票 <span className="text-destructive">*</span>
                </Label>
                <TickerSearch
                  value={form.ticker}
                  onChange={(v) => {
                    setForm({ ...form, ticker: v.toUpperCase() });
                    setTickerInvalid(false);
                  }}
                  onSelect={handleTickerSelect}
                  placeholder="输入代码或公司名，如 AAPL / 腾讯 / 茅台"
                  invalid={tickerInvalid}
                />
                {tickerInvalid && (
                  <p className="text-xs text-destructive">
                    请从下拉列表中选择，或确认代码格式正确
                  </p>
                )}
              </div>
            )}
            <div className="space-y-1.5">
              <Label>
                {isCashFlow ? '金额' : '股数'}{' '}
                <span className="text-destructive">*</span>
              </Label>
              <Input
                type="number"
                step="0.0001"
                value={form.shares}
                onChange={(e) => setForm({ ...form, shares: e.target.value })}
              />
            </div>
            {!isCashFlow && (
              <div className="space-y-1.5">
                <Label>
                  价格 <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                />
              </div>
            )}
            <div className="space-y-1.5 col-span-2">
              <Label>手续费</Label>
              <Input
                type="number"
                step="0.01"
                value={form.fees}
                onChange={(e) => setForm({ ...form, fees: e.target.value })}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>备注</Label>
              <Textarea
                rows={3}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="交易原因、策略说明等"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button size="sm" onClick={handleSubmit} disabled={saving}>
              {saving ? '保存中...' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={cashShortfallOpen} onOpenChange={setCashShortfallOpen}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-serif text-lg">
              现金不足
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p>
                  本次买入需要 <span className="font-semibold text-foreground">{shortfallInfo?.currency} {shortfallInfo?.required.toFixed(2)}</span>，
                  当前余额仅 <span className="font-semibold text-foreground">{shortfallInfo?.currency} {shortfallInfo?.currentBalance.toFixed(2)}</span>，
                  缺口 <span className="font-semibold text-destructive">{shortfallInfo?.currency} {shortfallInfo?.shortfall.toFixed(2)}</span>。
                </p>
                <div className="rounded-lg bg-muted/50 p-3 space-y-1 text-xs text-muted-foreground">
                  <div>成交金额：{form.shares} × {form.price} = {(parseFloat(form.shares) * parseFloat(form.price)).toFixed(2)}</div>
                  <div>手续费：{form.fees || '0.00'}</div>
                  <div className="font-semibold text-foreground pt-1">合计所需：{requiredAmount.toFixed(2)} {shortfallInfo?.currency}</div>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogCancel asChild>
              <Button variant="outline" size="sm">
                取消
              </Button>
            </AlertDialogCancel>
            <Button variant="outline" size="sm" onClick={handleGoToDeposit}>
              手动去存入
            </Button>
            <Button size="sm" onClick={handleAutoDeposit} disabled={autoDepositing}>
              {autoDepositing ? '处理中...' : '自动充值并完成买入'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
