/**
 * @file pages/Holdings/AddHoldingDialog.tsx
 * @description Create-a-holding dialog.
 *
 * Controlled form; only ticker and shares are required. Numeric fields are
 * parsed on submit; optional string fields are omitted from the payload when
 * empty so the backend can default them.
 */
import { useState } from 'react';
import { toast } from 'sonner';
import type { Group } from '@shared/api.interface';
import { createHolding } from '@/api';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
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

/** Props for {@link AddHoldingDialog}. */
interface AddHoldingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: Group[];
  onCreated: () => void;
}

/**
 * Render the add-holding dialog with controlled form state.
 */
export default function AddHoldingDialog({
  open,
  onOpenChange,
  groups,
  onCreated,
}: AddHoldingDialogProps) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    ticker: '',
    company: '',
    sector: '',
    buyDate: '',
    buyPrice: '',
    shares: '',
    currentPrice: '',
    rating: '',
    action: '',
    targetPrice: '',
    analysis: '',
    groupId: '',
  });

  /** Reset the form to blank values (called after a successful create). */
  const reset = () => {
    setForm({
      ticker: '',
      company: '',
      sector: '',
      buyDate: '',
      buyPrice: '',
      shares: '',
      currentPrice: '',
      rating: '',
      action: '',
      targetPrice: '',
      analysis: '',
      groupId: '',
    });
  };

  /**
   * Validate required fields and POST the new holding. On success, resets the
   * form, closes the dialog and invokes `onCreated` so the parent refetches.
   */
  const handleSubmit = async () => {
    if (!form.ticker.trim()) {
      toast.error('请输入代码 (Ticker)');
      return;
    }
    if (!form.shares || parseFloat(form.shares) <= 0) {
      toast.error('请输入有效的股数');
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, string | number | undefined> = {
        ticker: form.ticker.trim().toUpperCase(),
        shares: parseFloat(form.shares),
      };
      if (form.company) payload.company = form.company;
      if (form.sector) payload.sector = form.sector;
      if (form.buyDate) payload.buyDate = form.buyDate;
      if (form.buyPrice) payload.buyPrice = parseFloat(form.buyPrice);
      if (form.currentPrice)
        payload.currentPrice = parseFloat(form.currentPrice);
      if (form.rating) payload.rating = form.rating;
      if (form.action) payload.action = form.action;
      if (form.targetPrice)
        payload.targetPrice = parseFloat(form.targetPrice);
      if (form.analysis) payload.analysis = form.analysis;
      if (form.groupId) payload.groupId = form.groupId;

      await createHolding(payload);
      toast.success('持仓已添加');
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
          <DialogTitle className="font-serif text-xl">添加持仓</DialogTitle>
          <DialogDescription>
            填写新的持仓信息，带 * 为必填项
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-2">
          <div className="space-y-1.5">
            <Label>
              代码 <span className="text-destructive">*</span>
            </Label>
            <Input
              placeholder="如 AAPL"
              value={form.ticker}
              onChange={(e) =>
                setForm({ ...form, ticker: e.target.value.toUpperCase() })
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
            <Label>行业</Label>
            <Input
              value={form.sector}
              onChange={(e) =>
                setForm({ ...form, sector: e.target.value })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label>所属分组</Label>
            <Select
              value={form.groupId}
              onValueChange={(v) => setForm({ ...form, groupId: v })}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="未分组" />
              </SelectTrigger>
              <SelectContent>
                {groups.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>买入日期</Label>
            <Input
              type="date"
              value={form.buyDate}
              onChange={(e) =>
                setForm({ ...form, buyDate: e.target.value })
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
            <Label>
              股数 <span className="text-destructive">*</span>
            </Label>
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
            <Label>现价</Label>
            <Input
              type="number"
              step="0.01"
              value={form.currentPrice}
              onChange={(e) =>
                setForm({ ...form, currentPrice: e.target.value })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label>评级</Label>
            <Select
              value={form.rating}
              onValueChange={(v) => setForm({ ...form, rating: v })}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="选择评级" />
              </SelectTrigger>
              <SelectContent>
                {['Strong Buy', 'Buy', 'Hold', 'Sell', 'Strong Sell'].map(
                  (r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>操作建议</Label>
            <Select
              value={form.action}
              onValueChange={(v) => setForm({ ...form, action: v })}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="选择操作" />
              </SelectTrigger>
              <SelectContent>
                {['加仓', '买入', '持有', '减仓', '卖出', '观望'].map(
                  (a) => (
                    <SelectItem key={a} value={a}>
                      {a}
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label>目标价</Label>
            <Input
              type="number"
              step="0.01"
              value={form.targetPrice}
              onChange={(e) =>
                setForm({ ...form, targetPrice: e.target.value })
              }
            />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label>分析</Label>
            <Textarea
              rows={3}
              value={form.analysis}
              onChange={(e) =>
                setForm({ ...form, analysis: e.target.value })
              }
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
            {saving ? '保存中...' : '添加'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
