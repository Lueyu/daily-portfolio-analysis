import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import {
  Plus,
  Pencil,
  Trash2,
  RotateCcw,
  GripVertical,
  AlertTriangle,
  Shield,
  Lightbulb,
  Check,
  X,
} from 'lucide-react';
import { logger } from '@lark-apaas/client-toolkit/logger';
import type {
  StrategyRule,
  RuleCategory,
  RuleSeverity,
  RuleType,
  CreateStrategyRuleDto,
  UpdateStrategyRuleDto,
} from '@shared/api.interface';
import {
  getStrategyRules,
  createStrategyRule,
  updateStrategyRule,
  deleteStrategyRule,
  reorderStrategyRules,
  resetStrategyRules,
} from '@/api';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

// ── 分组定义 ──────────────────────────────────────────────
const CATEGORY_ORDER: Array<{
  key: RuleCategory | 'other';
  label: string;
  icon?: string;
}> = [
  { key: 'position_concentration', label: '仓位与集中度' },
  { key: 'stop_loss_take_profit', label: '止损止盈' },
  { key: 'buy_conditions', label: '买入条件' },
  { key: 'cash_management', label: '现金管理' },
  { key: 'risk_gate', label: '风控闸门' },
  { key: 'other', label: '其他' },
];

const CATEGORY_LABELS: Record<RuleCategory | 'other', string> = {
  position_concentration: '仓位与集中度',
  stop_loss_take_profit: '止损止盈',
  buy_conditions: '买入条件',
  cash_management: '现金管理',
  risk_gate: '风控闸门',
  other: '其他',
};

const SEVERITY_LABELS: Record<RuleSeverity, string> = {
  hard_block: '硬阻断',
  warning: '警告',
};

const RULE_TYPE_LABELS: Record<RuleType, string> = {
  hard: '硬性',
  soft: '软性',
};

// ── 工具函数 ──────────────────────────────────────────────
function getCategoryKey(rule: StrategyRule): RuleCategory | 'other' {
  if (!rule.category) return 'other';
  const defined = CATEGORY_ORDER.slice(0, -1).some(
    (c) => c.key === rule.category,
  );
  return defined ? rule.category : 'other';
}

function groupRules(rules: StrategyRule[]): Record<string, StrategyRule[]> {
  const groups: Record<string, StrategyRule[]> = {};
  for (const cat of CATEGORY_ORDER) {
    groups[cat.key] = [];
  }
  for (const rule of rules) {
    const key = getCategoryKey(rule);
    groups[key].push(rule);
  }
  for (const key of Object.keys(groups)) {
    groups[key].sort((a, b) => a.sort - b.sort);
  }
  return groups;
}

function formatThreshold(
  threshold: string | number | null,
  unit: string | null,
): string {
  if (threshold === null || threshold === '') return '—';
  const num = typeof threshold === 'number' ? threshold : parseFloat(threshold);
  if (Number.isNaN(num)) return '—';
  const numStr = String(num);
  const u = (unit ?? '').trim().toLowerCase();
  if (u === 'pct' || u === '%') return `${numStr}%`;
  if (u === 'days' || u === 'day') return `${numStr}天`;
  if (u === 'usd') return `$${numStr}`;
  if (!u) return numStr;
  return `${numStr} ${unit}`;
}

// ── 主组件 ────────────────────────────────────────────────
function StrategyRulesPage() {
  const [rules, setRules] = useState<StrategyRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 新增 / 编辑弹窗
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<StrategyRule | null>(null);
  const [formData, setFormData] = useState<{
    ruleKey: string;
    ruleName: string;
    ruleType: RuleType;
    threshold: string;
    unit: string;
    description: string;
    category: RuleCategory | 'none';
    severity: RuleSeverity;
  }>({
    ruleKey: '',
    ruleName: '',
    ruleType: 'soft',
    threshold: '',
    unit: '',
    description: '',
    category: 'none',
    severity: 'warning',
  });
  const [saving, setSaving] = useState(false);

  // 删除确认
  const [deleteTarget, setDeleteTarget] = useState<StrategyRule | null>(null);
  const [deleting, setDeleting] = useState(false);

  // 恢复默认确认
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  // 拖拽状态
  const dragIdRef = useRef<string | null>(null);
  const dragCatRef = useRef<RuleCategory | 'other' | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);

  // 阈值行内编辑
  const [editingThresholdId, setEditingThresholdId] = useState<string | null>(
    null,
  );
  const [thresholdValue, setThresholdValue] = useState('');

  // ── 数据加载 ────────────────────────────────────────────
  const loadRules = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = (await getStrategyRules()) as StrategyRule[];
      setRules(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : '加载失败';
      setError(message);
      logger.error('加载策略规则失败', err);
      toast.error('加载策略规则失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRules();
  }, [loadRules]);

  const grouped = useMemo(() => groupRules(rules), [rules]);

  const hardCount = rules.filter((r) => r.ruleType === 'hard').length;
  const softCount = rules.filter((r) => r.ruleType === 'soft').length;

  // ── 启停切换 ────────────────────────────────────────────
  const handleToggle = useCallback(
    async (rule: StrategyRule, nextEnabled: boolean) => {
      const previous = rule.enabled;
      setRules((prev) =>
        prev.map((r) =>
          r.id === rule.id ? { ...r, enabled: nextEnabled } : r,
        ),
      );
      try {
        await updateStrategyRule(rule.id, { enabled: nextEnabled });
        toast.success(`${rule.ruleName} 已${nextEnabled ? '启用' : '禁用'}`);
      } catch (err) {
        setRules((prev) =>
          prev.map((r) =>
            r.id === rule.id ? { ...r, enabled: previous } : r,
          ),
        );
        const message = err instanceof Error ? err.message : '操作失败';
        logger.error('更新规则状态失败', err);
        toast.error(`更新失败：${message}`);
      }
    },
    [],
  );

  // ── 新增规则 ────────────────────────────────────────────
  const openCreateDialog = useCallback(() => {
    setEditingRule(null);
    setFormData({
      ruleKey: '',
      ruleName: '',
      ruleType: 'soft',
      threshold: '',
      unit: '',
      description: '',
      category: 'none',
      severity: 'warning',
    });
    setDialogOpen(true);
  }, []);

  // ── 编辑规则 ────────────────────────────────────────────
  const openEditDialog = useCallback((rule: StrategyRule) => {
    setEditingRule(rule);
    setFormData({
      ruleKey: rule.ruleKey,
      ruleName: rule.ruleName,
      ruleType: rule.ruleType,
      threshold: rule.threshold ?? '',
      unit: rule.unit ?? '',
      description: rule.description ?? '',
      category: rule.category ?? 'none',
      severity: rule.severity,
    });
    setDialogOpen(true);
  }, []);

  const handleSaveDialog = useCallback(async () => {
    if (!formData.ruleKey.trim() || !formData.ruleName.trim()) {
      toast.error('请填写规则 Key 和规则名称');
      return;
    }

    const thresholdNum =
      formData.threshold.trim() !== ''
        ? Number(formData.threshold)
        : undefined;
    if (
      formData.threshold.trim() !== '' &&
      (Number.isNaN(thresholdNum) || !isFinite(thresholdNum))
    ) {
      toast.error('阈值必须是有效数字');
      return;
    }

    setSaving(true);
    try {
      const payload: CreateStrategyRuleDto & UpdateStrategyRuleDto = {
        ruleKey: formData.ruleKey.trim(),
        ruleName: formData.ruleName.trim(),
        ruleType: formData.ruleType,
        threshold: thresholdNum,
        unit: formData.unit.trim() || undefined,
        description: formData.description.trim() || undefined,
        category:
          formData.category === 'none' ? undefined : formData.category,
        severity: formData.severity,
      };

      if (editingRule) {
        await updateStrategyRule(editingRule.id, payload as unknown as Record<string, unknown>);
        toast.success('规则已更新');
      } else {
        await createStrategyRule(payload as unknown as Record<string, unknown>);
        toast.success('规则已创建');
      }

      setDialogOpen(false);
      setEditingRule(null);
      await loadRules();
    } catch (err) {
      const message = err instanceof Error ? err.message : '保存失败';
      logger.error('保存规则失败', err);
      toast.error(`保存失败：${message}`);
    } finally {
      setSaving(false);
    }
  }, [formData, editingRule, loadRules]);

  // ── 删除规则 ────────────────────────────────────────────
  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const target = deleteTarget;
    try {
      await deleteStrategyRule(target.id);
      toast.success(`${target.ruleName} 已删除`);
      setDeleteTarget(null);
      await loadRules();
    } catch (err) {
      const message = err instanceof Error ? err.message : '删除失败';
      logger.error('删除规则失败', err);
      toast.error(`删除失败：${message}`);
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, loadRules]);

  // ── 恢复默认 ────────────────────────────────────────────
  const handleReset = useCallback(async () => {
    setResetting(true);
    try {
      await resetStrategyRules();
      toast.success('已恢复默认规则');
      setResetOpen(false);
      await loadRules();
    } catch (err) {
      const message = err instanceof Error ? err.message : '恢复失败';
      logger.error('恢复默认规则失败', err);
      toast.error(`恢复失败：${message}`);
    } finally {
      setResetting(false);
    }
  }, [loadRules]);

  // ── 拖拽排序 ────────────────────────────────────────────
  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLDivElement>, rule: StrategyRule) => {
      dragIdRef.current = rule.id;
      dragCatRef.current = getCategoryKey(rule);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', rule.id);
    },
    [],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>, ruleId: string) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (dragOverId !== ruleId) {
        setDragOverId(ruleId);
      }
    },
    [dragOverId],
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      const related = e.relatedTarget as Node | null;
      const current = e.currentTarget as Node;
      if (related && current.contains(related)) return;
      setDragOverId(null);
    },
    [],
  );

  const handleDrop = useCallback(
    async (
      e: React.DragEvent<HTMLDivElement>,
      targetRule: StrategyRule,
    ) => {
      e.preventDefault();
      const draggedId = dragIdRef.current;
      const dragCat = dragCatRef.current;
      const targetCat = getCategoryKey(targetRule);
      dragIdRef.current = null;
      dragCatRef.current = null;
      setDragOverId(null);

      if (!draggedId || draggedId === targetRule.id) return;
      if (dragCat !== targetCat) {
        toast.error('只能在同一分组内调整顺序');
        return;
      }

      const groupList = grouped[targetCat];
      const dragIdx = groupList.findIndex((r) => r.id === draggedId);
      const targetIdx = groupList.findIndex((r) => r.id === targetRule.id);
      if (dragIdx === -1 || targetIdx === -1) return;
      if (dragIdx === targetIdx) return;

      // 乐观更新：重排
      const newGroupList = [...groupList];
      const [removed] = newGroupList.splice(dragIdx, 1);
      newGroupList.splice(targetIdx, 0, removed);

      const reordered: Array<{ id: string; sort: number }> = newGroupList.map(
        (r, i) => ({ id: r.id, sort: i }),
      );

      // 更新整体 rules 状态
      const updatedRules = rules.map((r) => {
        const found = reordered.find((o) => o.id === r.id);
        return found ? { ...r, sort: found.sort } : r;
      });
      setRules(updatedRules);

      setReordering(true);
      try {
        await reorderStrategyRules(reordered);
        toast.success('排序已保存');
      } catch (err) {
        // 失败回滚
        setRules(rules);
        const message = err instanceof Error ? err.message : '保存失败';
        logger.error('保存排序失败', err);
        toast.error(`排序保存失败：${message}`);
      } finally {
        setReordering(false);
      }
    },
    [grouped, rules],
  );

  const handleDragEnd = useCallback(() => {
    dragIdRef.current = null;
    dragCatRef.current = null;
    setDragOverId(null);
  }, []);

  // ── 行内阈值编辑 ────────────────────────────────────────
  const startThresholdEdit = useCallback((rule: StrategyRule) => {
    setEditingThresholdId(rule.id);
    setThresholdValue(rule.threshold ?? '');
  }, []);

  const cancelThresholdEdit = useCallback(() => {
    setEditingThresholdId(null);
    setThresholdValue('');
  }, []);

  const saveThreshold = useCallback(
    async (rule: StrategyRule) => {
      if (thresholdValue === (rule.threshold ?? '')) {
        cancelThresholdEdit();
        return;
      }
      const numValue = Number(thresholdValue);
      if (Number.isNaN(numValue) || !isFinite(numValue)) {
        toast.error('请输入有效的数字');
        return;
      }
      const previous = rule.threshold;
      setRules((prev) =>
        prev.map((r) =>
          r.id === rule.id ? { ...r, threshold: thresholdValue } : r,
        ),
      );
      try {
        await updateStrategyRule(rule.id, { threshold: numValue });
        toast.success(`${rule.ruleName} 阈值已更新`);
        setEditingThresholdId(null);
        setThresholdValue('');
      } catch (err) {
        setRules((prev) =>
          prev.map((r) =>
            r.id === rule.id ? { ...r, threshold: previous } : r,
          ),
        );
        const message = err instanceof Error ? err.message : '保存失败';
        logger.error('更新阈值失败', err);
        toast.error(`保存失败：${message}`);
      }
    },
    [thresholdValue, cancelThresholdEdit],
  );

  // ── 渲染 ────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* 顶部操作栏 */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            策略规则
          </h1>
          <p className="text-sm text-muted-foreground">
            管理风控检查的阈值、开关和优先级。拖拽可调整组内顺序，支持按分类分组管理。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setResetOpen(true)}
            className="border-amber-600/40 text-amber-500 hover:bg-amber-500/10 hover:text-amber-400"
          >
            <RotateCcw size={16} />
            恢复默认
          </Button>
          <Button variant="default" onClick={openCreateDialog}>
            <Plus size={16} />
            新增规则
          </Button>
        </div>
      </div>

      {/* 说明卡片 */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-rose-500/20 bg-rose-950/10">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-rose-500/10 text-rose-400">
                <Shield size={18} />
              </div>
              <CardTitle className="text-base text-rose-200">
                硬规则
              </CardTitle>
              <Badge
                variant="outline"
                className="border-rose-500/40 bg-rose-500/10 text-rose-300"
              >
                Hard
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-rose-200/80">
              触发后评级结果将进入「待人工决策」状态，必须由人工确认后才能生效。用于关键风险控制，
              <span className="font-medium text-rose-300">
                不建议随意关闭
              </span>
              。
            </p>
            <p className="mt-2 text-xs text-rose-400/70">
              当前共有 {hardCount} 条硬规则
            </p>
          </CardContent>
        </Card>

        <Card className="border-amber-500/20 bg-amber-950/10">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-amber-500/10 text-amber-400">
                <Lightbulb size={18} />
              </div>
              <CardTitle className="text-base text-amber-200">
                软规则
              </CardTitle>
              <Badge
                variant="outline"
                className="border-amber-500/40 bg-amber-500/10 text-amber-300"
              >
                Soft
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-amber-200/80">
              触发后仅在评级结果中给出提示，不会阻止评级自动生效。用于辅助参考类检查，可根据需要灵活开关。
            </p>
            <p className="mt-2 text-xs text-amber-400/70">
              当前共有 {softCount} 条软规则
            </p>
          </CardContent>
        </Card>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="flex items-start gap-3 rounded-md border border-rose-500/30 bg-rose-950/30 p-4 text-sm text-rose-300">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">加载失败</div>
            <div className="text-rose-300/80">{error}</div>
          </div>
        </div>
      )}

      {/* 分组展示 */}
      {loading ? (
        <div className="space-y-6">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-3">
              <Skeleton className="h-6 w-48" />
              <div className="space-y-2">
                {[0, 1].map((j) => (
                  <Skeleton key={j} className="h-20 w-full" />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-6" data-ai-section-type="card-list">
          {CATEGORY_ORDER.map((cat) => {
            const groupRulesList = grouped[cat.key] ?? [];
            return (
              <div key={cat.key}>
                {/* 分组标题 */}
                <div className="mb-3 flex items-center gap-2">
                  <h2 className="text-base font-semibold text-foreground">
                    {cat.label}
                  </h2>
                  <Badge
                    variant="outline"
                    className="border-amber-500/30 bg-amber-500/10 px-2 py-0 text-[10px] text-amber-400"
                  >
                    {groupRulesList.length}
                  </Badge>
                  <div className="ml-2 h-px flex-1 bg-border/50" />
                </div>

                {/* 规则列表 */}
                {groupRulesList.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border p-4">
                    <p className="text-center text-xs text-muted-foreground">
                      暂无该分类的规则，可点击「新增规则」添加
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {groupRulesList.map((rule) => (
                      <RuleCard
                        key={rule.id}
                        rule={rule}
                        editingThresholdId={editingThresholdId}
                        thresholdValue={thresholdValue}
                        setThresholdValue={setThresholdValue}
                        startThresholdEdit={startThresholdEdit}
                        cancelThresholdEdit={cancelThresholdEdit}
                        saveThreshold={saveThreshold}
                        onToggle={handleToggle}
                        onEdit={openEditDialog}
                        onDelete={(r) => setDeleteTarget(r)}
                        onDragStart={handleDragStart}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                        onDragEnd={handleDragEnd}
                        isDragOver={dragOverId === rule.id}
                        isReordering={reordering}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 新增 / 编辑弹窗 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {editingRule ? '编辑规则' : '新增规则'}
            </DialogTitle>
            <DialogDescription>
              {editingRule
                ? '修改规则的名称、类型、阈值等属性。'
                : '创建一条新的策略规则，填写以下信息。'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="ruleKey">规则 Key</Label>
                <Input
                  id="ruleKey"
                  value={formData.ruleKey}
                  onChange={(e) =>
                    setFormData({ ...formData, ruleKey: e.target.value })
                  }
                  placeholder="例如: max_position_weight"
                  disabled={!!editingRule}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ruleName">规则名称</Label>
                <Input
                  id="ruleName"
                  value={formData.ruleName}
                  onChange={(e) =>
                    setFormData({ ...formData, ruleName: e.target.value })
                  }
                  placeholder="例如: 单只股票最大仓位"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="ruleType">规则类型</Label>
                <Select
                  value={formData.ruleType}
                  onValueChange={(v) =>
                    setFormData({
                      ...formData,
                      ruleType: v as RuleType,
                    })
                  }
                >
                  <SelectTrigger id="ruleType" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hard">硬性 (Hard)</SelectItem>
                    <SelectItem value="soft">软性 (Soft)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="threshold">阈值</Label>
                <Input
                  id="threshold"
                  value={formData.threshold}
                  onChange={(e) =>
                    setFormData({ ...formData, threshold: e.target.value })
                  }
                  placeholder="例如: 25"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="unit">单位</Label>
                <Input
                  id="unit"
                  value={formData.unit}
                  onChange={(e) =>
                    setFormData({ ...formData, unit: e.target.value })
                  }
                  placeholder="例如: %"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="category">分类</Label>
                <Select
                  value={formData.category}
                  onValueChange={(v) =>
                    setFormData({
                      ...formData,
                      category: v as RuleCategory | 'none',
                    })
                  }
                >
                  <SelectTrigger id="category" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORY_ORDER.filter((c) => c.key !== 'other').map(
                      (c) => (
                        <SelectItem key={c.key} value={c.key}>
                          {c.label}
                        </SelectItem>
                      ),
                    )}
                    <SelectItem value="none">未分类</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="severity">严重级别</Label>
                <Select
                  value={formData.severity}
                  onValueChange={(v) =>
                    setFormData({
                      ...formData,
                      severity: v as RuleSeverity,
                    })
                  }
                >
                  <SelectTrigger id="severity" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="warning">警告</SelectItem>
                    <SelectItem value="hard_block">硬阻断</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">说明</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                placeholder="描述该规则的用途和触发场景"
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
            >
              取消
            </Button>
            <Button onClick={() => void handleSaveDialog()} disabled={saving}>
              {saving ? '保存中...' : editingRule ? '保存修改' : '创建规则'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认弹窗 */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-rose-500" />
              删除规则确认
            </AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除{' '}
              <span className="font-medium text-foreground">
                {deleteTarget?.ruleName}
              </span>{' '}
              吗？删除后无法自动恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 hover:bg-rose-700"
              onClick={() => void handleDelete()}
              disabled={deleting}
            >
              {deleting ? '删除中...' : '确认删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 恢复默认确认弹窗 */}
      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-5 w-5 text-amber-500" />
              恢复默认规则
            </AlertDialogTitle>
            <AlertDialogDescription>
              将重置所有策略规则为系统默认值，
              <span className="font-medium text-amber-500">
                您的自定义修改将被覆盖
              </span>
              。确认继续吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => setResetOpen(false)}
              disabled={resetting}
            >
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-600 hover:bg-amber-700"
              onClick={() => void handleReset()}
              disabled={resetting}
            >
              {resetting ? '恢复中...' : '确认恢复'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── 规则卡片子组件 ────────────────────────────────────────
interface RuleCardProps {
  rule: StrategyRule;
  editingThresholdId: string | null;
  thresholdValue: string;
  setThresholdValue: (v: string) => void;
  startThresholdEdit: (rule: StrategyRule) => void;
  cancelThresholdEdit: () => void;
  saveThreshold: (rule: StrategyRule) => Promise<void>;
  onToggle: (rule: StrategyRule, enabled: boolean) => Promise<void>;
  onEdit: (rule: StrategyRule) => void;
  onDelete: (rule: StrategyRule) => void;
  onDragStart: (
    e: React.DragEvent<HTMLDivElement>,
    rule: StrategyRule,
  ) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>, ruleId: string) => void;
  onDragLeave: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (
    e: React.DragEvent<HTMLDivElement>,
    rule: StrategyRule,
  ) => Promise<void>;
  onDragEnd: () => void;
  isDragOver: boolean;
  isReordering: boolean;
}

function RuleCard({
  rule,
  editingThresholdId,
  thresholdValue,
  setThresholdValue,
  startThresholdEdit,
  cancelThresholdEdit,
  saveThreshold,
  onToggle,
  onEdit,
  onDelete,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  isDragOver,
  isReordering,
}: RuleCardProps) {
  const isEditing = editingThresholdId === rule.id;
  const hasThreshold = rule.threshold !== null && rule.threshold !== undefined;

  return (
    <Card
      draggable={!isReordering}
      onDragStart={(e) => onDragStart(e, rule)}
      onDragOver={(e) => onDragOver(e, rule.id)}
      onDragLeave={onDragLeave}
      onDrop={(e) => void onDrop(e, rule)}
      onDragEnd={onDragEnd}
      className={`
        transition-all duration-150
        ${isDragOver ? 'border-amber-500/60 ring-2 ring-amber-500/30' : ''}
        ${!rule.enabled ? 'opacity-60' : ''}
      `}
    >
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-4">
        {/* 顶部行：拖拽手柄 + 名称 */}
        <div className="flex items-center gap-3 min-w-0 flex-1 w-full sm:w-auto">
          {/* 拖拽手柄 */}
          <div
            className="flex shrink-0 cursor-grab items-center justify-center text-muted-foreground/60 transition-colors hover:text-muted-foreground active:cursor-grabbing"
            title="拖拽排序"
          >
            <GripVertical size={18} />
          </div>

          {/* 名称 + 说明 */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-foreground">
                {rule.ruleName}
              </span>
              <span className="font-mono text-[11px] text-muted-foreground/70">
                {rule.ruleKey}
              </span>
            </div>
            {rule.description && (
              <p className="mt-0.5 text-xs text-muted-foreground break-words">
                {rule.description}
              </p>
            )}
          </div>
        </div>

        {/* 底部行（桌面端在右侧）：阈值 + 徽章 + 开关 + 操作 */}
        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto sm:justify-end">
          {/* 中部：阈值参数 */}
          <div className="flex items-center gap-2">
          {isEditing ? (
            <div className="flex items-center gap-2">
              <Input
                value={thresholdValue}
                onChange={(e) => setThresholdValue(e.target.value)}
                className="h-8 w-24 text-center font-mono"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    void saveThreshold(rule);
                  } else if (e.key === 'Escape') {
                    cancelThresholdEdit();
                  }
                }}
              />
              {rule.unit && (
                <span className="w-6 text-xs text-muted-foreground">
                  {rule.unit}
                </span>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-emerald-500 hover:bg-emerald-500/10 hover:text-emerald-400"
                onClick={() => void saveThreshold(rule)}
                title="保存"
              >
                <Check size={16} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={cancelThresholdEdit}
                title="取消"
              >
                <X size={16} />
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => hasThreshold && startThresholdEdit(rule)}
              disabled={!hasThreshold}
              className={`
                flex items-center gap-1.5 rounded-md border border-transparent
                px-2 py-1 text-sm transition-colors
                ${
                  hasThreshold
                    ? 'cursor-pointer hover:border-border hover:bg-accent/50'
                    : 'cursor-default'
                }
              `}
              title={hasThreshold ? '点击编辑阈值' : '无阈值参数'}
            >
              <span className="font-mono-nums font-medium text-foreground">
                {hasThreshold ? formatThreshold(rule.threshold, rule.unit) : '—'}
              </span>
              {hasThreshold && (
                <Pencil
                  size={12}
                  className="ml-0.5 text-muted-foreground/50 opacity-0 transition-opacity group-hover:opacity-100"
                />
              )}
            </button>
          )}
        </div>

          {/* 右部：徽章 + 开关 + 操作按钮 */}
          <div className="flex items-center gap-2 flex-wrap">
          {/* 严重级别徽章 */}
          <Badge
            variant={rule.severity === 'hard_block' ? 'destructive' : 'outline'}
            className={
              rule.severity === 'hard_block'
                ? 'bg-rose-600/90 text-rose-50'
                : 'border-amber-500/40 bg-amber-500/10 text-amber-400'
            }
          >
            {SEVERITY_LABELS[rule.severity]}
          </Badge>

          {/* ruleType 徽章 */}
          <Badge
            variant="outline"
            className={
              rule.ruleType === 'hard'
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-slate-500/40 bg-slate-500/10 text-slate-400'
            }
          >
            {RULE_TYPE_LABELS[rule.ruleType]}
          </Badge>

          {/* 启停开关 */}
          <Switch
            checked={rule.enabled}
            onCheckedChange={(checked) => {
              void onToggle(rule, checked);
            }}
          />

          {/* 编辑按钮 */}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={() => onEdit(rule)}
            title="编辑规则"
          >
            <Pencil size={16} />
          </Button>

          {/* 删除按钮 */}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-400"
            onClick={() => onDelete(rule)}
            title="删除规则"
          >
            <Trash2 size={16} />
          </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default StrategyRulesPage;
