/** Human actions for a task, kept separate from its saved gate signals. */
import { useId, useRef, useState, type ChangeEvent, type MouseEvent } from 'react';
import { CheckCircle2, Loader2, Play, Square, XCircle } from 'lucide-react';
import { approveDevTask, rejectDevTask, runDevTask, stopDevTask } from '@/api';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { getErrorMessage } from './dev-ui';
import type { DevTaskDetail } from './types';

interface DevTaskActionsProps {
  task: DevTaskDetail;
  ready: boolean;
  onChanged: () => void;
}

type TaskAction = 'run' | 'approve' | 'reject' | 'stop';

export function DevTaskActions(props: DevTaskActionsProps) {
  if ((props.task.status === 'blocked' && !props.task.canResume && props.task.execution?.state !== 'running') || props.task.status === 'verified') return null;
  return <TaskActions key={props.task.id} {...props} />;
}

function TaskActions({ task, ready, onChanged }: DevTaskActionsProps) {
  const [acting, setActing] = useState<TaskAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [approveOpen, setApproveOpen] = useState<boolean>(false);
  const [rejectOpen, setRejectOpen] = useState<boolean>(false);
  const [rejectReason, setRejectReason] = useState<string>('');
  const requestInFlight = useRef<boolean>(false);
  const reasonId: string = useId();
  const disabled: boolean = !ready || acting !== null || task.execution?.state === 'running';
  const isAwaiting: boolean = task.status === 'awaiting_approval';
  const latestPatchId: string = task.latestPatch?.patchId ?? String(task.patchCount).padStart(4, '0');

  const runAction = async (action: TaskAction): Promise<void> => {
    if (requestInFlight.current || !ready || acting !== null || (action !== 'stop' && disabled)) return;
    const reason: string = rejectReason.trim();
    if (action === 'reject' && !reason) return;
    requestInFlight.current = true;
    setActing(action);
    setActionError(null);
    try {
      if (action === 'run') await runDevTask(task.id);
      else if (action === 'approve') await approveDevTask(task.id);
      else if (action === 'stop') await stopDevTask(task.id);
      else await rejectDevTask(task.id, reason);
      setApproveOpen(false);
      setRejectOpen(false);
      setRejectReason('');
      onChanged();
    } catch (error: unknown) {
      setActionError(getErrorMessage(error));
    } finally {
      requestInFlight.current = false;
      setActing(null);
    }
  };

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center gap-2" data-ai-section-type="button">
        {task.execution?.state === 'running' ? (
          task.execution.command === 'run' ? <Button size="sm" variant="outline" disabled={!ready || acting !== null} onClick={() => void runAction('stop')}>
            {acting === 'stop' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}停止运行
          </Button> : <span className="text-xs text-muted-foreground">正在应用补丁并检查结果…</span>
        ) : isAwaiting ? (
          <>
            <Button
              size="sm"
              disabled={disabled}
              onClick={() => { setActionError(null); setApproveOpen(true); }}
            >
              <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
              批准并应用
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => { setActionError(null); setRejectOpen(true); }}
            >
              <XCircle aria-hidden="true" className="h-4 w-4" />
              拒绝补丁
            </Button>
          </>
        ) : (
          <Button size="sm" disabled={disabled} onClick={() => void runAction('run')}>
            {acting === 'run' ? (
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
            ) : (
              <Play aria-hidden="true" className="h-4 w-4" />
            )}
            {task.status === 'new' && task.iterations.length === 0 ? '开始运行' : '继续运行'}
          </Button>
        )}
      </div>
      {actionError && !approveOpen && !rejectOpen && (
        <p role="alert" className="break-words text-sm text-destructive">{actionError}</p>
      )}

      <AlertDialog open={approveOpen} onOpenChange={(open: boolean) => { if (!acting) setApproveOpen(open); }}>
        <AlertDialogContent className="max-h-[85dvh] overflow-y-auto border-border bg-card text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>批准并应用最新补丁？</AlertDialogTitle>
            <AlertDialogDescription className="break-words leading-6">
              本次审批针对最新补丁 <code className="font-mono">{latestPatchId}</code>。
              {task.runtime_version === 2
                ? '会先在隔离副本中合并并验证，验证通过后再应用到主工作区；验证失败时保留记录供继续处理。'
                : '默认沙箱模式会将该补丁应用到主工作区，然后重新运行单元测试。如果验证失败，任务会回到已诊断状态，需要手动点击“继续运行”后再处理。'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {actionError && <p role="alert" className="break-words text-sm text-destructive">{actionError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={acting !== null}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={disabled || !isAwaiting}
              onClick={(event: MouseEvent<HTMLButtonElement>) => {
                event.preventDefault();
                void runAction('approve');
              }}
            >
              {acting === 'approve' && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
              确认批准
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={rejectOpen} onOpenChange={(open: boolean) => { if (!acting) setRejectOpen(open); }}>
        <DialogContent
          showCloseButton={acting === null}
          className="max-h-[85dvh] overflow-y-auto border-border bg-card text-foreground"
        >
          <DialogHeader>
            <DialogTitle>拒绝补丁</DialogTitle>
            <DialogDescription className="break-words leading-6">
              拒绝最新补丁 <code className="font-mono">{latestPatchId}</code> 后，任务将停止。
              {task.runtime_version === 2
                ? '拒绝原因会交给 Agent，旧验证将失效；你可以继续运行，让它根据反馈修改并重新验证。'
                : '拒绝原因与历史记录会保留，明确后续改动后可新建任务。'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={reasonId}>拒绝原因</Label>
            <Textarea
              id={reasonId}
              rows={4}
              placeholder="例如：这个改动绕过了原有校验，或缺少边界条件处理。"
              value={rejectReason}
              disabled={acting !== null}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setRejectReason(event.target.value)}
            />
          </div>
          {actionError && <p role="alert" className="break-words text-sm text-destructive">{actionError}</p>}
          <DialogFooter>
            <Button variant="outline" disabled={acting !== null} onClick={() => setRejectOpen(false)}>取消</Button>
            <Button
              variant="destructive"
              disabled={disabled || !isAwaiting || rejectReason.trim().length === 0}
              onClick={() => void runAction('reject')}
            >
              {acting === 'reject' && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
              确认拒绝
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
