/**
 * @file pages/Holdings/AddHoldingDialog.tsx
 * @description Create-a-holding dialog.
 *
 * Controlled form; only ticker and shares are required. Numeric fields are
 * parsed on submit; optional string fields are omitted from the payload when
 * empty so the backend can default them. Market is auto-detected from ticker.
 */
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { Group, Market, Currency } from '@shared/api.interface';
import { createHolding, createGroup } from '@/api';
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
import { Badge } from '@/components/ui/badge';
import { Plus } from 'lucide-react';
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
  /** 新建分组后通知父组件重新拉取 groups */
  onGroupsChanged?: () => void;
}

/** 与后端 quoteService.detectMarket 保持一致的前端预演 */
function detectMarket(symbol: string): {
  market: Market;
  currency: Currency;
  displaySymbol: string;
} {
  const upper = symbol.toUpperCase().trim();
  if (upper.endsWith('.HK')) {
    return { market: 'HK', currency: 'HKD', displaySymbol: upper };
  }
  if (upper.endsWith('.SH')) {
    return { market: 'CN', currency: 'CNY', displaySymbol: upper };
  }
  if (upper.endsWith('.SZ')) {
    return { market: 'CN', currency: 'CNY', displaySymbol: upper };
  }
  if (upper.endsWith('.BJ')) {
    return { market: 'CN', currency: 'CNY', displaySymbol: upper };
  }
  if (/^\d+$/.test(upper)) {
    if (upper.length === 5) {
      const displayCode = upper.startsWith('0') ? upper.slice(1) : upper;
      return {
        market: 'HK',
        currency: 'HKD',
        displaySymbol: `${displayCode}.HK`,
      };
    }
    if (upper.length === 6) {
      if (upper.startsWith('6')) {
        return { market: 'CN', currency: 'CNY', displaySymbol: `${upper}.SH` };
      }
      if (upper.startsWith('0') || upper.startsWith('3')) {
        return { market: 'CN', currency: 'CNY', displaySymbol: `${upper}.SZ` };
      }
      if (upper.startsWith('8') || upper.startsWith('4')) {
        return { market: 'CN', currency: 'CNY', displaySymbol: `${upper}.BJ` };
      }
    }
  }
  return { market: 'US', currency: 'USD', displaySymbol: upper };
}

const MARKET_LABEL: Record<Market, string> = {
  US: '美股 USD',
  HK: '港股 HKD',
  CN: 'A股 CNY',
};

export default function AddHoldingDialog({
  open,
  onOpenChange,
  groups,
  onCreated,
  onGroupsChanged,
}: AddHoldingDialogProps) {
  const [saving, setSaving] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [extraGroups, setExtraGroups] = useState<Group[]>([]);
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

  const allGroups = useMemo(
    () => [...groups, ...extraGroups],
    [groups, extraGroups],
  );

  const marketPreview = useMemo(() => {
    if (!form.ticker.trim()) return null;
    return detectMarket(form.ticker);
  }, [form.ticker]);

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
    setNewGroupName('');
    setCreatingGroup(false);
    setExtraGroups([]);
  };

  const handleCreateGroup = async () => {
    const name = newGroupName.trim();
    if (!name) {
      toast.error('请输入分组名称');
      return;
    }
    setCreatingGroup(true);
    try {
      const g = (await createGroup({ name })) as Group;
      setExtraGroups((prev) => [...prev, g]);
      setForm((f) => ({ ...f, groupId: g.id }));
      setNewGroupName('');
      setCreatingGroup(false);
      toast.success(`已创建分组「${name}」`);
      onGroupsChanged?.();
    } catch (err) {
      toast.error('创建分组失败');
    } finally {
      setCreatingGroup(false);
    }
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
            填写新的持仓信息，带 * 为必填项；市场会按代码自动识别
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-2">
          <div className="space-y-1.5">
            <Label>
              代码 <span className="text-destructive">*</span>
            </Label>
            <div className="flex items-center gap-2">
              <Input
                placeholder="如 AAPL / 600089 / 00700"
                value={form.ticker}
                onChange={(e) =>
                  setForm({ ...form, ticker: e.target.value.toUpperCase() })
                }
              />
              {marketPreview && (
                <Badge
                  variant="outline"
                  className="shrink-0 text-[10px] font-normal whitespace-nowrap"
                >
                  {MARKET_LABEL[marketPreview.market]} · {marketPreview.displaySymbol}
                </Badge>
              )}
            </div>
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
            <div className="flex items-center gap-2">
              <Select
                value={form.groupId}
                onValueChange={(v) => setForm({ ...form, groupId: v })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="未分组" />
                </SelectTrigger>
                <SelectContent>
                  {allGroups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 h-9 gap-1"
                onClick={() => setCreatingGroup((v) => !v)}
              >
                <Plus className="size-3.5" />
                新建
              </Button>
            </div>
            {creatingGroup && (
              <div className="flex items-center gap-2 pt-1">
                <Input
                  autoFocus
                  placeholder="新分组名称，如「港股科技」"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleCreateGroup();
                    }
                  }}
                  className="h-8"
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={handleCreateGroup}
                  disabled={!newGroupName.trim()}
                  className="h-8"
                >
                  确定
                </Button>
              </div>
            )}
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
