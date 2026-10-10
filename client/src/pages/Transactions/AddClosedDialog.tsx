/**
 * @file pages/Transactions/AddClosedDialog.tsx
 * @description Create-a-closed-position dialog.
 *
 * Only ticker is required. Realized P/L and return % can be entered manually
 * or auto-derived from shares × (sellPrice − buyPrice); a live preview card
 * shows the derived P/L and return while the user types.
 */
import { useState } from 'react';
import { toast } from 'sonner';
import { createClosed } from '@/api';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  formatCurrency,
  formatPercent,
  plClass,
  cn,
} from '@/utils/format';

/** Props for {@link AddClosedDialog}. */
interface AddClosedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

/**
 * Render the add-closed-position dialog with live P/L preview.
 */
export default function AddClosedDialog({
  open,
  onOpenChange,
  onCreated,
}: AddClosedDialogProps) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    ticker: '',
    company: '',
    openDate: '',
    closeDate: '',
    buyPrice: '',
    sellPrice: '',
    shares: '',
    realizedPl: '',
    returnPct: '',
    notes: '',
  });

  const shares = parseFloat(form.shares || '0');
  const buyPrice = parseFloat(form.buyPrice || '0');
  const sellPrice = parseFloat(form.sellPrice || '0');
  const autoPl = shares * (sellPrice - buyPrice);
  const autoReturn =
    shares > 0 && buyPrice > 0 ? ((sellPrice - buyPrice) / buyPrice) * 100 : 0;

  /** Reset the form to blank after a successful create. */
  const reset = () => {
    setForm({
      ticker: '',
      company: '',
      openDate: '',
      closeDate: '',
      buyPrice: '',
      sellPrice: '',
      shares: '',
      realizedPl: '',
      returnPct: '',
      notes: '',
    });
  };

  /**
   * Validate and submit. If realized P/L / return % are left blank, derive
   * them from shares, buyPrice, and sellPrice.
   */
  const handleSubmit = async () => {
    if (!form.ticker.trim()) {
      toast.error('请输入代码');
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, string | number | undefined> = {
        ticker: form.ticker.trim().toUpperCase(),
      };
      if (form.company) payload.company = form.company;
      if (form.openDate) payload.openDate = form.openDate;
      if (form.closeDate) payload.closeDate = form.closeDate;
      if (form.buyPrice) payload.buyPrice = parseFloat(form.buyPrice);
      if (form.sellPrice) payload.sellPrice = parseFloat(form.sellPrice);
      if (form.shares) payload.shares = parseFloat(form.shares);
      if (form.realizedPl)
        payload.realizedPl = parseFloat(form.realizedPl);
      else if (shares && buyPrice && sellPrice)
        payload.realizedPl = autoPl;
      if (form.returnPct)
        payload.returnPct = parseFloat(form.returnPct);
      else if (shares && buyPrice && sellPrice)
        payload.returnPct = autoReturn;
      if (form.notes) payload.notes = form.notes;

      await createClosed(payload);
      toast.success('已平仓记录已添加');
      reset();
      onOpenChange(false);
      onCreated();
    } catch (err) {
      toast.error('添加失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">
            添加已平仓记录
          </DialogTitle>
          <DialogDescription>
            记录一笔已完成的平仓交易
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4 py-2">
          <div className="space-y-1.5">
            <Label>
              代码 <span className="text-destructive">*</span>
            </Label>
            <Input
              placeholder="如 AAPL"
              value={form.ticker}
              onChange={(e) =>
                setForm({
                  ...form,
                  ticker: e.target.value.toUpperCase(),
                })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label>公司名称</Label>
            <Input
              value={form.company}
              onChange={(e) =>
                setForm({ ...form, company: e.target.value })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label>开仓日期</Label>
            <Input
              type="date"
              value={form.openDate}
              onChange={(e) =>
                setForm({ ...form, openDate: e.target.value })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label>平仓日期</Label>
            <Input
              type="date"
              value={form.closeDate}
              onChange={(e) =>
                setForm({ ...form, closeDate: e.target.value })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label>买入价</Label>
            <Input
              type="number"
              step="0.01"
              value={form.buyPrice}
              onChange={(e) =>
                setForm({ ...form, buyPrice: e.target.value })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label>卖出价</Label>
            <Input
              type="number"
              step="0.01"
              value={form.sellPrice}
              onChange={(e) =>
                setForm({ ...form, sellPrice: e.target.value })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label>股数</Label>
            <Input
              type="number"
              step="0.0001"
              value={form.shares}
              onChange={(e) =>
                setForm({ ...form, shares: e.target.value })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label>实现盈亏</Label>
            <Input
              type="number"
              step="0.01"
              value={form.realizedPl}
              onChange={(e) =>
                setForm({ ...form, realizedPl: e.target.value })
              }
              placeholder={shares && buyPrice && sellPrice ? '自动计算' : ''}
            />
          </div>
          <div className="space-y-1.5 col-span-2">
            <Label>收益率 (%)</Label>
            <Input
              type="number"
              step="0.01"
              value={form.returnPct}
              onChange={(e) =>
                setForm({ ...form, returnPct: e.target.value })
              }
              placeholder={shares && buyPrice && sellPrice ? '自动计算' : ''}
            />
          </div>

          {shares > 0 && buyPrice > 0 && sellPrice > 0 && (
            <div className="col-span-2 p-3 bg-muted/50 rounded-md text-sm flex items-center justify-between">
              <span className="text-muted-foreground">预估盈亏</span>
              <div className="text-right">
                <div
                  className={cn(
                    'font-mono-nums font-semibold',
                    plClass(autoPl)
                  )}
                >
                  {formatCurrency(autoPl)}
                </div>
                <div
                  className={cn(
                    'font-mono-nums text-xs',
                    plClass(autoReturn)
                  )}
                >
                  {formatPercent(autoReturn)}
                </div>
              </div>
            </div>
          )}

          <div className="space-y-1.5 col-span-2">
            <Label>备注</Label>
            <Textarea
              rows={3}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
