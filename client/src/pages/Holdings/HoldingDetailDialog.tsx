import { useState } from 'react';
import { toast } from 'sonner';
import { Pencil, Trash2, FolderOpen, X, Check, Sparkles, TrendingUp, TrendingDown, ShieldAlert, ExternalLink } from 'lucide-react';
import type { Holding, Group, AgentRating, AgentConfidence } from '@shared/api.interface';
import { updateHolding, deleteHolding } from '@/api';
import {
  formatPrice,
  formatShares,
  formatCurrency,
  formatPercent,
  formatDate,
  plClass,
  ratingColor,
  actionColor,
  cn,
} from '@/utils/format';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent } from '@/components/ui/card';
import RatingBadge from '@/components/MultiAgent/RatingBadge';
import ConfidenceBadge from '@/components/MultiAgent/ConfidenceBadge';
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

interface AiRatingInfo {
  rating: AgentRating;
  confidence: AgentConfidence;
  targetPrice: string | null;
  action: string;
  runId: string;
  bullSummary: string | null;
  bearSummary: string | null;
}

interface HoldingDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  holding: Holding | null;
  groups: Group[];
  onUpdated: () => void;
  onDeleted: () => void;
  aiRating?: AiRatingInfo | null;
  onViewFullAnalysis?: (runId: string) => void;
}

function computeDerived(h: Holding) {
  const shares = parseFloat(h.shares || '0');
  const buyPrice = parseFloat(h.buyPrice || '0');
  const currentPrice = parseFloat(h.currentPrice || '0');
  const marketValue = shares * currentPrice;
  const cost = shares * buyPrice;
  const pl = marketValue - cost;
  const returnPct = cost > 0 ? (pl / cost) * 100 : 0;
  return { marketValue, cost, pl, returnPct };
}

export default function HoldingDetailDialog({
  open,
  onOpenChange,
  holding,
  groups,
  onUpdated,
  onDeleted,
  aiRating,
  onViewFullAnalysis,
}: HoldingDetailDialogProps) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});

  const startEdit = () => {
    if (!holding) return;
    setForm({
      company: holding.company ?? '',
      sector: holding.sector ?? '',
      buyDate: holding.buyDate ?? '',
      buyPrice: holding.buyPrice ?? '',
      shares: holding.shares ?? '',
      currentPrice: holding.currentPrice ?? '',
      rating: holding.rating ?? '',
      action: holding.action ?? '',
      targetPrice: holding.targetPrice ?? '',
      analysis: holding.analysis ?? '',
      groupId: holding.groupId ?? '',
    });
    setEditing(true);
  };

  const closeEdit = () => {
    setEditing(false);
    setForm({});
  };

  const handleSave = async () => {
    if (!holding) return;
    setSaving(true);
    try {
      const payload: Record<string, string | number | undefined> = {};
      if (form.company !== undefined) payload.company = form.company || undefined;
      if (form.sector !== undefined) payload.sector = form.sector || undefined;
      if (form.buyDate !== undefined) payload.buyDate = form.buyDate || undefined;
      if (form.buyPrice !== undefined)
        payload.buyPrice = form.buyPrice ? parseFloat(form.buyPrice) : undefined;
      if (form.shares !== undefined)
        payload.shares = form.shares ? parseFloat(form.shares) : undefined;
      if (form.currentPrice !== undefined)
        payload.currentPrice = form.currentPrice
          ? parseFloat(form.currentPrice)
          : undefined;
      if (form.rating !== undefined) payload.rating = form.rating || undefined;
      if (form.action !== undefined) payload.action = form.action || undefined;
      if (form.targetPrice !== undefined)
        payload.targetPrice = form.targetPrice
          ? parseFloat(form.targetPrice)
          : undefined;
      if (form.analysis !== undefined)
        payload.analysis = form.analysis || undefined;
      if (form.groupId !== undefined)
        payload.groupId = form.groupId || undefined;

      await updateHolding(holding.id, payload);
      toast.success('已保存');
      setEditing(false);
      onUpdated();
    } catch (err) {
      toast.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!holding) return;
    setSaving(true);
    try {
      await deleteHolding(holding.id);
      toast.success('已删除');
      setConfirmDelete(false);
      onOpenChange(false);
      onDeleted();
    } catch (err) {
      toast.error('删除失败');
    } finally {
      setSaving(false);
    }
  };

  const handleGroupChange = async (value: string) => {
    if (!holding) return;
    try {
      await updateHolding(holding.id, { groupId: value || undefined });
      toast.success('分组已更新');
      onUpdated();
    } catch (err) {
      toast.error('更新分组失败');
    }
  };

  if (!holding) return null;

  const { marketValue, cost, pl, returnPct } = computeDerived(holding);
  const groupName =
    groups.find((g: Group) => g.id === holding.groupId)?.name ?? '未分组';

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl flex items-center gap-3">
              <span className="font-mono-nums text-primary">
                {holding.ticker}
              </span>
              <span className="text-base font-normal text-muted-foreground">
                {holding.company}
              </span>
              {holding.rating && (
                <Badge
                  className={cn(ratingColor(holding.rating), 'ml-auto')}
                  variant="outline"
                >
                  {holding.rating}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>

          {editing ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-2">
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
                  onValueChange={(v) =>
                    setForm({ ...form, rating: v })
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择评级" />
                  </SelectTrigger>
                  <SelectContent>
                    {[
                      'Strong Buy',
                      'Buy',
                      'Hold',
                      'Sell',
                      'Strong Sell',
                    ].map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>操作建议</Label>
                <Select
                  value={form.action}
                  onValueChange={(v) =>
                    setForm({ ...form, action: v })
                  }
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
              <div className="space-y-1.5">
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
              <div className="space-y-1.5">
                <Label>所属分组</Label>
                <Select
                  value={form.groupId}
                  onValueChange={(v) =>
                    setForm({ ...form, groupId: v })
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="未分组" />
                  </SelectTrigger>
                  <SelectContent>
                    {groups.map((g: Group) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label>分析</Label>
                <Textarea
                  rows={4}
                  value={form.analysis}
                  onChange={(e) =>
                    setForm({ ...form, analysis: e.target.value })
                  }
                />
              </div>
            </div>
           ) : (
             <Tabs defaultValue="detail" className="w-full">
               <TabsList className="w-full">
                 <TabsTrigger value="detail" className="flex-1">详情</TabsTrigger>
                 <TabsTrigger value="ai" className="flex-1">
                   <Sparkles className="size-3.5" />
                   AI 推理
                 </TabsTrigger>
               </TabsList>
               <TabsContent value="detail" className="pt-3 space-y-5">
                 <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">
                    现价
                  </div>
                  <div className="font-mono-nums text-lg font-semibold">
                    {formatPrice(holding.currentPrice)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">
                    收益率
                  </div>
                  <div
                    className={cn(
                      'font-mono-nums text-lg font-semibold',
                      plClass(returnPct)
                    )}
                  >
                    {formatPercent(returnPct)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">
                    浮盈亏
                  </div>
                  <div
                    className={cn(
                      'font-mono-nums text-lg font-semibold',
                      plClass(pl)
                    )}
                  >
                    {formatCurrency(pl)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">
                    操作建议
                  </div>
                  <div>
                    {holding.action ? (
                      <Badge
                        className={cn(actionColor(holding.action))}
                        variant="outline"
                      >
                        {holding.action}
                      </Badge>
                    ) : (
                      '—'
                    )}
                  </div>
                </div>
              </div>

              <Separator />

              <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">行业</span>
                  <span>{holding.sector ?? '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">买入日期</span>
                  <span className="font-mono-nums">
                    {formatDate(holding.buyDate)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">买入价</span>
                  <span className="font-mono-nums">
                    {formatPrice(holding.buyPrice)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">股数</span>
                  <span className="font-mono-nums">
                    {formatShares(holding.shares)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">市值</span>
                  <span className="font-mono-nums">
                    {formatCurrency(marketValue)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">成本</span>
                  <span className="font-mono-nums">
                    {formatCurrency(cost)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">目标价</span>
                  <span className="font-mono-nums">
                    {formatPrice(holding.targetPrice)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">所属分组</span>
                  <span className="flex items-center gap-1.5">
                    <FolderOpen className="size-3.5 text-primary" />
                    {groupName}
                  </span>
                </div>
              </div>

              <Separator />

              <div>
                <div className="text-xs text-muted-foreground mb-1.5">
                  分析
                </div>
                <div className="text-sm whitespace-pre-wrap leading-relaxed text-foreground/90">
                  {holding.analysis ?? '暂无分析记录'}
                </div>
              </div>

              <Separator />

                 <div className="flex items-center justify-between">
                   <div className="flex items-center gap-2">
                     <Label className="text-xs text-muted-foreground">
                       移动分组
                     </Label>
                     <Select
                       value={holding.groupId ?? ''}
                       onValueChange={handleGroupChange}
                     >
                       <SelectTrigger className="w-40 h-8 text-xs" size="sm">
                         <SelectValue placeholder="未分组" />
                       </SelectTrigger>
                       <SelectContent>
                         {groups.map((g: Group) => (
                           <SelectItem key={g.id} value={g.id}>
                             {g.name}
                           </SelectItem>
                         ))}
                       </SelectContent>
                     </Select>
                   </div>
                 </div>
               </TabsContent>
               <TabsContent value="ai" className="pt-3 space-y-5">
                 {aiRating ? (
                   <>
                     <div className="flex flex-wrap items-center gap-3">
                       <RatingBadge rating={aiRating.rating} size="md" />
                       <ConfidenceBadge confidence={aiRating.confidence} size="md" />
                       {aiRating.targetPrice && (
                         <div className="flex items-center gap-1.5 text-sm">
                           <span className="text-muted-foreground">目标价</span>
                           <span className="font-mono-nums font-semibold">
                             {formatPrice(aiRating.targetPrice)}
                           </span>
                         </div>
                       )}
                       <Badge variant="outline" className={cn(actionColor(aiRating.action))}>
                         {aiRating.action}
                       </Badge>
                     </div>

                     <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                       <Card>
                         <CardContent className="p-4">
                           <div className="flex items-center gap-2 text-emerald-600 mb-2">
                             <TrendingUp className="size-4" />
                             <span className="font-medium text-sm">多头观点</span>
                           </div>
                           <div className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">
                             {aiRating.bullSummary ?? '暂无多头摘要'}
                           </div>
                         </CardContent>
                       </Card>
                       <Card>
                         <CardContent className="p-4">
                           <div className="flex items-center gap-2 text-rose-600 mb-2">
                             <TrendingDown className="size-4" />
                             <span className="font-medium text-sm">空头观点</span>
                           </div>
                           <div className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">
                             {aiRating.bearSummary ?? '暂无空头摘要'}
                           </div>
                         </CardContent>
                       </Card>
                     </div>

                     <div className="flex items-center gap-2 pt-2 border-t">
                       <ShieldAlert className="size-4 text-muted-foreground" />
                       <span className="text-sm text-muted-foreground flex-1">
                         风控结果已通过 Multi-Agent 风险门控检查
                       </span>
                     </div>

                     <Button
                       variant="outline"
                       size="sm"
                       className="w-full"
                       onClick={() => onViewFullAnalysis?.(aiRating.runId)}
                     >
                       <ExternalLink className="size-4" />
                       查看完整推理过程
                     </Button>
                   </>
                 ) : (
                   <div className="py-12 text-center space-y-3">
                     <div className="flex justify-center">
                       <Sparkles className="size-10 text-muted-foreground/40" />
                     </div>
                     <div className="text-sm font-medium text-foreground">
                       暂无 AI 分析记录
                     </div>
                     <div className="text-xs text-muted-foreground">
                       前往每日分析页运行 Multi-Agent 深度分析
                     </div>
                   </div>
                 )}
               </TabsContent>
             </Tabs>
           )}

          <DialogFooter className="flex-row gap-2 sm:gap-2">
            <Button
              variant="destructive"
              size="sm"
              className="mr-auto"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="size-4" />
              删除
            </Button>
            {editing ? (
              <>
                <Button variant="outline" size="sm" onClick={closeEdit}>
                  <X className="size-4" />
                  取消
                </Button>
                <Button size="sm" onClick={handleSave} disabled={saving}>
                  <Check className="size-4" />
                  保存
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={startEdit}>
                <Pencil className="size-4" />
                编辑
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除持仓</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除 {holding.ticker} 的持仓记录吗？此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {saving ? '删除中...' : '确认删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
