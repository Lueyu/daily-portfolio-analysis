/**
 * @file DevTaskDetail.tsx
 * @description Full-screen detail view for one Coding-Agent task.
 *
 * Polls the task while it is not in a terminal state, renders the state rail,
 * the problem/acceptance summary, the iteration timeline and the patch diff,
 * and hosts the human-in-the-loop actions (start, approve with confirmation,
 * reject with a reason).
 */
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Loader2, Play, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import {
  approveDevTask,
  getDevPatch,
  getDevTask,
  rejectDevTask,
  runDevTask,
} from '@/api';
import { DevStateStepper } from './DevStateStepper';
import { DevIterationTimeline } from './DevIterationTimeline';
import { DiffViewer } from './DiffViewer';
import { CHECK_LABEL, DETAIL_POLL_MS, STATUS_LABEL, STATUS_TONE, formatTime } from './dev-ui';
import { AWAITING_STATUS, TERMINAL_STATUSES } from './types';
import type { DevPatchDetail, DevTaskDetail as DevTask } from './types';

interface Props {
  taskId: string;
  onBack: () => void;
}

function pad4(n: number): string {
  return n.toString().padStart(4, '0');
}

export function DevTaskDetail({ taskId, onBack }: Props) {
  const [task, setTask] = useState<DevTask | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  // Patch viewer state.
  const [selectedPatch, setSelectedPatch] = useState<string | null>(null);
  const [patch, setPatch] = useState<DevPatchDetail | null>(null);
  const [patchLoading, setPatchLoading] = useState(false);

  const reload = useCallback(async () => {
    const t = await getDevTask(taskId);
    setTask(t);
    return t;
  }, [taskId]);

  // Poll until a terminal state; awaiting_approval keeps polling so the UI
  // refreshes immediately after an approve/reject.
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const load = async () => {
      try {
        const t = await getDevTask(taskId);
        if (cancelled) return;
        setTask(t);
        setLoadError(null);
        if (TERMINAL_STATUSES.includes(t.status) && timer !== undefined) {
          window.clearInterval(timer);
        }
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      }
    };
    void load();
    timer = window.setInterval(load, DETAIL_POLL_MS);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [taskId]);

  // Default to the newest patch whenever the patch list changes.
  useEffect(() => {
    if (task && task.patchCount > 0 && selectedPatch === null) {
      setSelectedPatch(task.latestPatch?.patchId ?? pad4(task.patchCount));
    }
  }, [task, selectedPatch]);

  // Load the selected patch.
  useEffect(() => {
    if (!selectedPatch) return;
    let cancelled = false;
    setPatchLoading(true);
    getDevPatch(taskId, selectedPatch)
      .then((p) => {
        if (!cancelled) setPatch(p);
      })
      .catch((e) => {
        if (!cancelled) setActionError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setPatchLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [taskId, selectedPatch]);

  if (!task) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        加载任务中…
      </div>
    );
  }

  const isTerminal = TERMINAL_STATUSES.includes(task.status);
  const isAwaiting = task.status === AWAITING_STATUS;

  const runAction = async (fn: () => Promise<unknown>) => {
    setActing(true);
    setActionError(null);
    try {
      await fn();
      setConfirmApprove(false);
      setRejectOpen(false);
      setRejectReason('');
      await reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setActing(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          返回
        </Button>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{task.title}</h2>
            <p className="mt-0.5 font-mono text-xs text-slate-400">{task.id}</p>
          </div>
          <Badge className={`ring-1 ${STATUS_TONE[task.status]}`} variant="outline">
            {STATUS_LABEL[task.status]}
          </Badge>
        </div>

        <div className="mt-4">
          <DevStateStepper status={task.status} />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {task.status === 'new' && (
            <Button size="sm" onClick={() => runAction(() => runDevTask(task.id))} disabled={acting}>
              <Play className="mr-1 h-4 w-4" />
              开始运行
            </Button>
          )}
          {isAwaiting && (
            <>
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700"
                onClick={() => setConfirmApprove(true)}
                disabled={acting}
              >
                <CheckCircle2 className="mr-1 h-4 w-4" />
                批准并继续验证
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-rose-600"
                onClick={() => setRejectOpen(true)}
                disabled={acting}
              >
                <XCircle className="mr-1 h-4 w-4" />
                拒绝补丁
              </Button>
            </>
          )}
          {!isTerminal && !isAwaiting && task.status !== 'new' && (
            <span className="inline-flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Agent 正在运行…
            </span>
          )}
          {isTerminal && (
            <span className="text-sm text-slate-500">
              任务已结束 · 更新于 {formatTime(task.updated_at)}
            </span>
          )}
        </div>

        {actionError && <p className="mt-2 text-sm text-rose-600">{actionError}</p>}
        {loadError && <p className="mt-2 text-sm text-rose-600">加载失败：{loadError}</p>}
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">概览</TabsTrigger>
          <TabsTrigger value="iterations">迭代（{task.iterations.length}）</TabsTrigger>
          <TabsTrigger value="patch">补丁（{task.patchCount}）</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-medium text-slate-800">问题描述</h3>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{task.problem}</p>
          </section>
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-medium text-slate-800">验收标准</h3>
            <ul className="mt-2 space-y-2">
              {task.acceptance.map((a) => (
                <li key={a.id} className="text-sm text-slate-600">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-[11px]">
                      {CHECK_LABEL[a.check]}
                    </Badge>
                    <span className="font-mono text-xs text-slate-400">{a.id}</span>
                  </div>
                  <p className="mt-1">{a.description}</p>
                  {a.target && <p className="mt-0.5 font-mono text-xs text-slate-400">{a.target}</p>}
                </li>
              ))}
            </ul>
          </section>
          <section className="rounded-lg border border-slate-200 bg-white p-4 text-xs text-slate-500">
            <p>
              工作目录：<span className="font-mono">{task.workdir}</span>
            </p>
            <p className="mt-1">
              分支：<span className="font-mono">{task.branch || '（工作区）'}</span> · 已见失败：
              {task.red_seen ? '是' : '否'} · 诊断反思：{task.diagnosis_rethink_count} 次
            </p>
          </section>
        </TabsContent>

        <TabsContent value="iterations">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <DevIterationTimeline iterations={task.iterations} />
          </div>
        </TabsContent>

        <TabsContent value="patch">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            {task.patchCount === 0 ? (
              <p className="text-sm text-slate-400">还没有补丁。Agent 修复时会生成补丁并停在这里等待审批。</p>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-600">查看补丁</span>
                  <Select value={selectedPatch ?? undefined} onValueChange={setSelectedPatch}>
                    <SelectTrigger className="w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: task.patchCount }, (_, i) => pad4(i + 1)).map((p) => (
                        <SelectItem key={p} value={p}>
                          {p}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {patchLoading && <p className="text-sm text-slate-400">加载补丁中…</p>}
                {patch && !patchLoading && (
                  <DiffViewer
                    patchId={patch.patchId}
                    targetFiles={patch.targetFiles}
                    hypothesis={patch.hypothesis}
                    diff={patch.diff}
                  />
                )}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Approve confirmation */}
      <AlertDialog open={confirmApprove} onOpenChange={setConfirmApprove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>批准这个补丁？</AlertDialogTitle>
            <AlertDialogDescription>
              补丁将应用到代码并重新运行全部验收检查。若检查通过，任务标记为已验证；若仍失败，Agent 会继续修复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={acting}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={acting}
              onClick={(e) => {
                e.preventDefault();
                void runAction(() => approveDevTask(task.id));
              }}
            >
              {acting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              确认批准
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reject reason */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>拒绝补丁</DialogTitle>
            <DialogDescription>
              说明拒绝原因，Agent 会记录这次反馈并进入阻断状态（不会应用该补丁）。
            </DialogDescription>
          </DialogHeader>
          <Textarea
            rows={4}
            placeholder="例如：这个改动绕过了原有校验，或缺少边界条件处理。"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)} disabled={acting}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={acting || rejectReason.trim().length === 0}
              onClick={() => void runAction(() => rejectDevTask(task.id, rejectReason.trim()))}
            >
              {acting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              确认拒绝
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
