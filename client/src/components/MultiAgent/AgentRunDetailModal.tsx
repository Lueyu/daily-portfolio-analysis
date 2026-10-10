import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
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
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Check,
  Clock,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  ShieldAlert,
  FileText,
  Newspaper,
  BarChart3,
  Globe,
  Target,
  Zap,
  AlertTriangle,
  XCircle,
  CheckCircle2,
  Loader2,
} from 'lucide-react';
import { getAgentRun, submitHumanDecision, logger } from '@/api';
import RatingBadge from './RatingBadge';
import ConfidenceBadge from './ConfidenceBadge';
import RunProgressBar from './RunProgressBar';
import RiskAlertBadge from './RiskAlertBadge';
import type {
  AgentRunDetail,
  AgentRunStatus,
  EvidenceRole,
  AgentRating,
  AgentConfidence,
  BullBearArgument,
  DebateRecord,
  RiskGateResult,
} from '@shared/api.interface';

interface AgentRunDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runId: string | null;
}

const statusLabels: Record<AgentRunStatus, string> = {
  pending: '等待中',
  fetching: '取证中',
  debating: '辩论中',
  critiquing: 'Critic 审核中',
  risk_check: '风控检查中',
  awaiting_human: '待决策',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

const roleLabels: Record<EvidenceRole, string> = {
  fundamental: '基本面',
  news: '新闻资讯',
  technical: '技术分析',
  macro: '宏观经济',
};

const roleIcons: Record<EvidenceRole, typeof FileText> = {
  fundamental: FileText,
  news: Newspaper,
  technical: BarChart3,
  macro: Globe,
};

const pipelineSteps = [
  { key: 'fetching', label: '取证', icon: FileText },
  { key: 'debating', label: '多空辩论', icon: TrendingUp },
  { key: 'critiquing', label: 'Critic 质疑', icon: AlertCircle },
  { key: 'risk_check', label: '风控检查', icon: ShieldAlert },
  { key: 'completed', label: '最终评级', icon: Target },
] as const;

const stepStatusOrder: AgentRunStatus[] = [
  'fetching',
  'debating',
  'critiquing',
  'risk_check',
  'completed',
];

function getPipelineStepState(
  stepKey: string,
  status: AgentRunStatus,
): 'done' | 'active' | 'pending' {
  const stepIdx = stepStatusOrder.indexOf(stepKey as AgentRunStatus);
  const currentIdx = stepStatusOrder.indexOf(status);

  if (status === 'pending') return 'pending';
  if (status === 'completed' || status === 'awaiting_human') return 'done';
  if (status === 'failed' || status === 'cancelled') {
    // Mark steps before failure point as done, current as pending-ish
    return stepIdx < currentIdx ? 'done' : 'pending';
  }

  if (stepIdx < currentIdx) return 'done';
  if (stepIdx === currentIdx) return 'active';
  return 'pending';
}

function AgentRunDetailModal({
  open,
  onOpenChange,
  runId,
}: AgentRunDetailModalProps) {
  const [run, setRun] = useState<AgentRunDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [decisionMode, setDecisionMode] = useState<'none' | 'approve' | 'modify' | 'reject'>('none');
  const [submitting, setSubmitting] = useState(false);

  // Modify form state
  const [modifyRating, setModifyRating] = useState<AgentRating>('Hold');
  const [modifyConfidence, setModifyConfidence] = useState<AgentConfidence>('medium');
  const [modifyTargetPrice, setModifyTargetPrice] = useState('');
  const [modifyAction, setModifyAction] = useState('');
  const [modifyNote, setModifyNote] = useState('');

  const loadRun = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const data: AgentRunDetail = await getAgentRun(id);
      setRun(data);
      if (data.rating) {
        setModifyRating(data.rating.rating);
        setModifyConfidence(data.rating.confidence);
        setModifyTargetPrice(data.rating.targetPrice || '');
        setModifyAction(data.rating.action);
      }
    } catch (err) {
      logger.error('加载 run 详情失败', err);
      setError('加载详情失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && runId) {
      loadRun(runId);
      setActiveTab('overview');
      setDecisionMode('none');
    } else {
      setRun(null);
      setError(null);
    }
  }, [open, runId, loadRun]);

  const handleSubmitDecision = async (
    decision: 'approved' | 'modified' | 'rejected',
  ) => {
    if (!runId || !run) return;
    setSubmitting(true);
    try {
      const payload: {
        decision: string;
        note?: string;
        modifiedRating?: Record<string, unknown>;
        applyToHoldings?: boolean;
        syncToAnalysis?: boolean;
      } = {
        decision,
        note: modifyNote || undefined,
      };

      if (decision === 'modified') {
        payload.modifiedRating = {
          rating: modifyRating,
          confidence: modifyConfidence,
          targetPrice: modifyTargetPrice ? Number(modifyTargetPrice) : undefined,
          action: modifyAction,
        };
      }

      if (decision === 'approved' || decision === 'modified') {
        payload.applyToHoldings = true;
        payload.syncToAnalysis = true;
      }

      await submitHumanDecision(runId, payload);

      if (decision === 'approved') {
        toast.success('评级已同步到持仓和分析记录');
      } else if (decision === 'modified') {
        toast.success('修改后的评级已同步到持仓和分析记录');
      } else {
        toast.info('已拒绝该评级');
      }

      setDecisionMode('none');
      await loadRun(runId);
    } catch (err) {
      logger.error('提交决策失败', err);
      toast.error('提交失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  const evidenceByRole = run
    ? run.evidence.reduce<Record<EvidenceRole, typeof run.evidence>>(
        (acc, item) => {
          if (!acc[item.role]) acc[item.role] = [];
          acc[item.role].push(item);
          return acc;
        },
        {} as Record<EvidenceRole, typeof run.evidence>,
      )
    : ({} as Record<EvidenceRole, typeof run.evidence>);

  const bullArguments = run?.arguments.filter(
    (a: BullBearArgument) => a.side === 'bull',
  ) || [];
  const bearArguments = run?.arguments.filter(
    (a: BullBearArgument) => a.side === 'bear',
  ) || [];
  const criticRecords = run?.debate.filter(
    (d: DebateRecord) => d.speaker === 'critic',
  ) || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <DialogTitle className="flex items-center gap-3">
            {loading ? (
              <Skeleton className="h-7 w-48" />
            ) : run ? (
              <>
                <span className="text-xl font-bold">{run.ticker}</span>
                {run.tickerName && (
                  <span className="text-base font-normal text-muted-foreground">
                    {run.tickerName}
                  </span>
                )}
                <Badge
                  variant="outline"
                  className={
                    run.status === 'failed'
                      ? 'border-rose-500/40 bg-rose-500/15 text-rose-700 dark:text-rose-400'
                      : run.status === 'awaiting_human'
                        ? 'border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-400'
                        : run.status === 'completed'
                          ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                          : 'border-primary/40 bg-primary/15 text-primary'
                  }
                >
                  {statusLabels[run.status]}
                </Badge>
              </>
            ) : null}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto">
          {error && (
            <div className="p-8 flex flex-col items-center justify-center text-center">
              <AlertCircle className="h-10 w-10 text-rose-500 mb-3" />
              <p className="text-rose-600 dark:text-rose-400 font-medium">
                {error}
              </p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => runId && loadRun(runId)}
              >
                重试
              </Button>
            </div>
          )}

          {loading && !run && <DetailSkeleton />}

          {run && !error && (
            <Tabs
              value={activeTab}
              onValueChange={setActiveTab}
              className="w-full"
            >
              <div className="px-6 pt-4 border-b">
                <TabsList className="mb-0">
                  <TabsTrigger value="overview">概览</TabsTrigger>
                  <TabsTrigger value="evidence">证据链</TabsTrigger>
                  <TabsTrigger value="debate">多空辩论</TabsTrigger>
                  <TabsTrigger value="risk">风控检查</TabsTrigger>
                  <TabsTrigger value="rating">最终评级</TabsTrigger>
                </TabsList>
              </div>

              <div className="p-6">
                {/* Overview Tab */}
                <TabsContent value="overview" className="mt-0 space-y-6">
                  {/* Summary bar */}
                  {run.rating && (
                    <div className="flex flex-wrap items-center gap-3">
                      <RatingBadge rating={run.rating.rating} />
                      <ConfidenceBadge confidence={run.rating.confidence} />
                      <Badge variant="secondary">{run.rating.action}</Badge>
                      {run.rating.targetPrice && (
                        <Badge variant="outline">
                          目标价 ${run.rating.targetPrice}
                        </Badge>
                      )}
                      {run.riskGate.length > 0 && (
                        <RiskAlertBadge results={run.riskGate} />
                      )}
                    </div>
                  )}

                  {/* Pipeline Timeline */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base font-semibold">
                        流水线进度
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="relative pl-2">
                        {pipelineSteps.map((step, idx) => {
                          const state = getPipelineStepState(
                            step.key,
                            run.status,
                          );
                          const StepIcon = step.icon;
                          return (
                            <div
                              key={step.key}
                              className="relative flex gap-4 pb-6 last:pb-0"
                            >
                              {/* Vertical line */}
                              {idx < pipelineSteps.length - 1 && (
                                <div
                                  className={[
                                    'absolute left-[15px] top-8 bottom-0 w-0.5',
                                    state === 'done'
                                      ? 'bg-emerald-500'
                                      : 'bg-slate-200 dark:bg-slate-700',
                                  ].join(' ')}
                                />
                              )}
                              {/* Dot / icon */}
                              <div
                                className={[
                                  'relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2',
                                  state === 'done'
                                    ? 'border-emerald-500 bg-emerald-500 text-white'
                                    : state === 'active'
                                      ? 'border-primary bg-primary text-primary-foreground animate-pulse'
                                      : 'border-slate-300 bg-white text-slate-400 dark:border-slate-600 dark:bg-slate-800',
                                ].join(' ')}
                              >
                                {state === 'done' ? (
                                  <Check size={14} strokeWidth={3} />
                                ) : (
                                  <StepIcon size={14} />
                                )}
                              </div>
                              <div className="pt-1">
                                <div className="font-medium text-sm">
                                  {step.label}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {state === 'done'
                                    ? '已完成'
                                    : state === 'active'
                                      ? '进行中...'
                                      : '待处理'}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Rating summary card */}
                  {run.rating && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base font-semibold">
                          最终评级摘要
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="flex items-center gap-3 flex-wrap">
                          <RatingBadge rating={run.rating.rating} />
                          <ConfidenceBadge
                            confidence={run.rating.confidence}
                          />
                        </div>
                        {run.rating.bullSummary && (
                          <div className="flex items-start gap-2 text-sm">
                            <TrendingUp
                              size={16}
                              className="mt-0.5 shrink-0 text-emerald-500"
                            />
                            <span className="text-emerald-700 dark:text-emerald-400">
                              {run.rating.bullSummary}
                            </span>
                          </div>
                        )}
                        {run.rating.bearSummary && (
                          <div className="flex items-start gap-2 text-sm">
                            <TrendingDown
                              size={16}
                              className="mt-0.5 shrink-0 text-rose-500"
                            />
                            <span className="text-rose-700 dark:text-rose-400">
                              {run.rating.bearSummary}
                            </span>
                          </div>
                        )}
                        {run.rating.aggregationLogic && (
                          <div className="text-sm text-muted-foreground">
                            <span className="font-medium text-foreground">
                              聚合逻辑：
                            </span>
                            {run.rating.aggregationLogic}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )}

                  {/* Failed error */}
                  {run.status === 'failed' && run.errorMessage && (
                    <Card className="border-rose-500/50 bg-rose-500/5">
                      <CardHeader>
                        <CardTitle className="text-base font-semibold text-rose-700 dark:text-rose-400 flex items-center gap-2">
                          <XCircle size={16} />
                          运行失败
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm text-rose-600 dark:text-rose-400">
                          {run.errorMessage}
                        </p>
                      </CardContent>
                    </Card>
                  )}
                </TabsContent>

                {/* Evidence Tab */}
                <TabsContent value="evidence" className="mt-0 space-y-4">
                  {(Object.keys(evidenceByRole) as EvidenceRole[]).length === 0 && (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      暂无证据数据
                    </div>
                  )}
                  {(Object.keys(evidenceByRole) as EvidenceRole[]).map(
                    (role) => {
                      const RoleIcon = roleIcons[role];
                      const items = evidenceByRole[role];
                      return (
                        <Card key={role}>
                          <CardHeader className="pb-3">
                            <CardTitle className="text-sm font-semibold flex items-center gap-2">
                              <RoleIcon size={16} />
                              {roleLabels[role]}
                              <Badge variant="outline" className="ml-auto text-xs">
                                {items.length} 条
                              </Badge>
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="pt-0">
                            <Accordion type="multiple" className="w-full">
                              {items.map((item) => (
                                <AccordionItem
                                  key={item.id}
                                  value={item.id}
                                >
                                  <AccordionTrigger className="py-3">
                                    <div className="flex-1 pr-4">
                                      <div className="font-medium text-sm">
                                        {item.title}
                                      </div>
                                      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                                        {item.sourceName && (
                                          <span>{item.sourceName}</span>
                                        )}
                                        <span>
                                          {new Date(
                                            item.fetchedAt,
                                          ).toLocaleString('zh-CN', {
                                            month: 'short',
                                            day: 'numeric',
                                            hour: '2-digit',
                                            minute: '2-digit',
                                          })}
                                        </span>
                                        {item.relevanceScore !==
                                          null &&
                                          item.relevanceScore !==
                                            undefined && (
                                            <span className="text-primary">
                                              相关度{' '}
                                              {Number(
                                                item.relevanceScore,
                                              ).toFixed(2)}
                                            </span>
                                          )}
                                      </div>
                                    </div>
                                  </AccordionTrigger>
                                  <AccordionContent>
                                    <div className="text-sm text-muted-foreground whitespace-pre-wrap bg-muted/50 rounded-md p-3 border">
                                      {item.content}
                                    </div>
                                  </AccordionContent>
                                </AccordionItem>
                              ))}
                            </Accordion>
                          </CardContent>
                        </Card>
                      );
                    },
                  )}
                </TabsContent>

                {/* Debate Tab */}
                <TabsContent value="debate" className="mt-0 space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    {/* Bull column */}
                    <Card className="border-emerald-500/30 bg-emerald-500/[0.03]">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-2">
                          <TrendingUp size={16} />
                          多头论点 (Bull)
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {bullArguments.length === 0 && (
                          <p className="text-sm text-muted-foreground">
                            暂无多头论点
                          </p>
                        )}
                        {bullArguments.map((arg: BullBearArgument, idx: number) => (
                          <div
                            key={arg.id}
                            className="rounded-md border border-emerald-500/20 bg-white dark:bg-slate-900 p-3 text-sm"
                          >
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                                第 {arg.round} 轮 · 论点 #{idx + 1}
                              </span>
                              {arg.evidenceIds.length > 0 && (
                                <span className="text-xs text-muted-foreground">
                                  引用 {arg.evidenceIds.length} 条证据
                                </span>
                              )}
                            </div>
                            <p className="text-foreground/90">{arg.argument}</p>
                          </div>
                        ))}
                      </CardContent>
                    </Card>

                    {/* Bear column */}
                    <Card className="border-rose-500/30 bg-rose-500/[0.03]">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-semibold text-rose-700 dark:text-rose-400 flex items-center gap-2">
                          <TrendingDown size={16} />
                          空头论点 (Bear)
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {bearArguments.length === 0 && (
                          <p className="text-sm text-muted-foreground">
                            暂无空头论点
                          </p>
                        )}
                        {bearArguments.map((arg: BullBearArgument, idx: number) => (
                          <div
                            key={arg.id}
                            className="rounded-md border border-rose-500/20 bg-white dark:bg-slate-900 p-3 text-sm"
                          >
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-xs font-medium text-rose-600 dark:text-rose-400">
                                第 {arg.round} 轮 · 论点 #{idx + 1}
                              </span>
                              {arg.evidenceIds.length > 0 && (
                                <span className="text-xs text-muted-foreground">
                                  引用 {arg.evidenceIds.length} 条证据
                                </span>
                              )}
                            </div>
                            <p className="text-foreground/90">{arg.argument}</p>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  </div>

                  {/* Critic section */}
                  {criticRecords.length > 0 && (
                    <Card className="border-amber-500/30 bg-amber-500/[0.03]">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-2">
                          <AlertCircle size={16} />
                          Critic 质疑
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {criticRecords.map((record: DebateRecord) => (
                          <div
                            key={record.id}
                            className="rounded-md border border-amber-500/20 bg-white dark:bg-slate-900 p-3 text-sm"
                          >
                            <div className="text-xs font-medium text-amber-600 dark:text-amber-400 mb-1.5">
                              第 {record.round} 轮
                            </div>
                            <p className="text-foreground/90 whitespace-pre-wrap">
                              {record.content}
                            </p>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  )}
                </TabsContent>

                {/* Risk Tab */}
                <TabsContent value="risk" className="mt-0">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base font-semibold flex items-center gap-2">
                        <ShieldAlert size={16} />
                        风控检查结果
                        {run.riskGate.length > 0 && (
                          <RiskAlertBadge results={run.riskGate} />
                        )}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0">
                      {run.riskGate.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground text-sm">
                          暂无风控数据
                        </div>
                      ) : (
                        <div className="rounded-md border overflow-hidden">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="w-[180px]">
                                  规则名称
                                </TableHead>
                                <TableHead className="w-[80px]">
                                  类型
                                </TableHead>
                                <TableHead className="w-[100px]">
                                  当前值
                                </TableHead>
                                <TableHead className="w-[100px]">
                                  阈值
                                </TableHead>
                                <TableHead className="w-[80px]">
                                  状态
                                </TableHead>
                                <TableHead>建议操作</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {run.riskGate.map(
                                (result: RiskGateResult) => (
                                  <TableRow key={result.id}>
                                    <TableCell className="font-medium text-sm">
                                      {result.ruleName}
                                    </TableCell>
                                    <TableCell>
                                      <Badge
                                        variant="outline"
                                        className={
                                          result.ruleType === 'hard'
                                            ? 'border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs'
                                            : 'border-amber-500/30 text-amber-600 dark:text-amber-400 text-xs'
                                        }
                                      >
                                        {result.ruleType === 'hard'
                                          ? '硬规则'
                                          : '软规则'}
                                      </Badge>
                                    </TableCell>
                                    <TableCell className="text-sm">
                                      {result.currentValue ?? '-'}
                                    </TableCell>
                                    <TableCell className="text-sm">
                                      {result.thresholdValue ?? '-'}
                                    </TableCell>
                                    <TableCell>
                                      {result.passed ? (
                                        <Badge
                                          variant="outline"
                                          className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 gap-1 text-xs"
                                        >
                                          <CheckCircle2 size={12} />
                                          通过
                                        </Badge>
                                      ) : (
                                        <Badge
                                          variant="outline"
                                          className="border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400 gap-1 text-xs"
                                        >
                                          <XCircle size={12} />
                                          未通过
                                        </Badge>
                                      )}
                                    </TableCell>
                                    <TableCell className="text-sm text-muted-foreground">
                                      {result.suggestedAction ?? '-'}
                                    </TableCell>
                                  </TableRow>
                                ),
                              )}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Rating Tab */}
                <TabsContent value="rating" className="mt-0 space-y-4">
                  {run.rating ? (
                    <>
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-base font-semibold">
                            评级结果
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <div className="flex flex-wrap items-center gap-3">
                            <RatingBadge rating={run.rating.rating} />
                            <ConfidenceBadge
                              confidence={run.rating.confidence}
                            />
                            <Badge variant="secondary">
                              操作：{run.rating.action}
                            </Badge>
                            {run.rating.targetPrice && (
                              <Badge variant="outline">
                                目标价 ${run.rating.targetPrice}
                              </Badge>
                            )}
                          </div>

                          {run.rating.aggregationLogic && (
                            <div className="space-y-1">
                              <div className="text-sm font-medium">
                                聚合逻辑说明
                              </div>
                              <p className="text-sm text-muted-foreground">
                                {run.rating.aggregationLogic}
                              </p>
                            </div>
                          )}

                          {run.rating.keyUncertainty && (
                            <div className="space-y-1">
                              <div className="text-sm font-medium flex items-center gap-1.5">
                                <AlertTriangle
                                  size={14}
                                  className="text-amber-500"
                                />
                                主要不确定性
                              </div>
                              <p className="text-sm text-muted-foreground">
                                {run.rating.keyUncertainty}
                              </p>
                            </div>
                          )}
                        </CardContent>
                      </Card>

                      {run.rating.catalysts && (
                        <Card className="border-emerald-500/30">
                          <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-2">
                              <Zap size={16} />
                              催化剂
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <p className="text-sm whitespace-pre-wrap">
                              {run.rating.catalysts}
                            </p>
                          </CardContent>
                        </Card>
                      )}

                      {run.rating.risks && (
                        <Card className="border-rose-500/30">
                          <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-semibold text-rose-700 dark:text-rose-400 flex items-center gap-2">
                              <AlertTriangle size={16} />
                              风险
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <p className="text-sm whitespace-pre-wrap">
                              {run.rating.risks}
                            </p>
                          </CardContent>
                        </Card>
                      )}
                    </>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      暂无评级结果
                    </div>
                  )}
                </TabsContent>
              </div>
            </Tabs>
          )}
        </div>

        {/* HITL action bar */}
        {run && run.status === 'awaiting_human' && (
          <div className="border-t bg-amber-500/5 px-6 py-4">
            {decisionMode === 'none' && (
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-2 text-sm">
                  <Clock size={16} className="text-amber-500" />
                  <span className="font-medium text-amber-700 dark:text-amber-400">
                    等待人工决策
                  </span>
                  <span className="text-muted-foreground">
                    请审核 AI 给出的评级结果并做出决策
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="border-rose-500/40 text-rose-600 hover:bg-rose-500/10 hover:text-rose-600 dark:text-rose-400 dark:hover:text-rose-400"
                    onClick={() => handleSubmitDecision('rejected')}
                    disabled={submitting}
                  >
                    <XCircle className="mr-1.5 h-4 w-4" />
                    拒绝
                  </Button>
                  <Button
                    variant="outline"
                    className="border-amber-500/40 text-amber-600 hover:bg-amber-500/10 hover:text-amber-600 dark:text-amber-400 dark:hover:text-amber-400"
                    onClick={() => setDecisionMode('modify')}
                    disabled={submitting}
                  >
                    <AlertTriangle className="mr-1.5 h-4 w-4" />
                    修改
                  </Button>
                  <Button
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                    onClick={() => handleSubmitDecision('approved')}
                    disabled={submitting}
                  >
                    <CheckCircle2 className="mr-1.5 h-4 w-4" />
                    采纳
                  </Button>
                </div>
              </div>
            )}

            {decisionMode === 'modify' && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm">
                  <AlertTriangle
                    size={16}
                    className="text-amber-500"
                  />
                  <span className="font-medium text-amber-700 dark:text-amber-400">
                    修改评级
                  </span>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>评级</Label>
                    <Select
                      value={modifyRating}
                      onValueChange={(v) =>
                        setModifyRating(v as AgentRating)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Strong Buy">
                          Strong Buy
                        </SelectItem>
                        <SelectItem value="Buy">Buy</SelectItem>
                        <SelectItem value="Hold">Hold</SelectItem>
                        <SelectItem value="Sell">Sell</SelectItem>
                        <SelectItem value="Strong Sell">
                          Strong Sell
                        </SelectItem>
                        <SelectItem value="Watch">Watch</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>置信度</Label>
                    <Select
                      value={modifyConfidence}
                      onValueChange={(v) =>
                        setModifyConfidence(v as AgentConfidence)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="high">高</SelectItem>
                        <SelectItem value="medium">中</SelectItem>
                        <SelectItem value="low">低</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>目标价</Label>
                    <Input
                      type="number"
                      value={modifyTargetPrice}
                      onChange={(e) => setModifyTargetPrice(e.target.value)}
                      placeholder="例如: 150.00"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>操作建议</Label>
                    <Input
                      value={modifyAction}
                      onChange={(e) => setModifyAction(e.target.value)}
                      placeholder="例如: 买入 / 持有 / 卖出"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>备注</Label>
                  <Textarea
                    value={modifyNote}
                    onChange={(e) => setModifyNote(e.target.value)}
                    placeholder="请输入修改原因或备注..."
                    rows={3}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setDecisionMode('none')}
                    disabled={submitting}
                  >
                    取消
                  </Button>
                  <Button
                    onClick={() => handleSubmitDecision('modified')}
                    disabled={submitting}
                  >
                    {submitting && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    提交修改
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DetailSkeleton() {
  return (
    <div className="p-6 space-y-6">
      <div className="flex gap-3">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-6 w-20" />
        <Skeleton className="h-6 w-16" />
      </div>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-24" />
        </CardHeader>
        <CardContent className="space-y-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex gap-4">
              <Skeleton className="h-8 w-8 rounded-full" />
              <div className="space-y-2 flex-1">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-3 w-16" />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

export default AgentRunDetailModal;
