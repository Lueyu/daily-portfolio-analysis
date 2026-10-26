/** Start a task from a message; keep check configuration out of the main flow. */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUp, ChevronRight, Loader2 } from 'lucide-react';
import { createDevTask, runDevTask } from '@/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { CHECK_LABEL, getErrorMessage } from './dev-ui';
import type { CheckKind, DevTaskDetail } from './types';

interface Props {
  ready: boolean;
  onCreatingChange: (creating: boolean) => void;
  onCreated: (task: DevTaskDetail, error?: string) => void;
}

export function DevTaskComposer({ ready, onCreatingChange, onCreated }: Props) {
  const [message, setMessage] = useState('');
  const [acceptance, setAcceptance] = useState('');
  const [check, setCheck] = useState<CheckKind>('unit');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      onCreatingChange(false);
    };
  }, [onCreatingChange]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const problem = message.trim();
    if (!ready || !problem || inFlight.current) return;
    inFlight.current = true;
    onCreatingChange(true);
    setSubmitting(true);
    setError(null);
    try {
      const criteria = acceptance.trim().split('\n').filter((line) => line.trim());
      const task = await createDevTask({
        title: problem.split('\n')[0].slice(0, 60),
        problem,
        acceptance: (criteria.length ? criteria : [`完成任务要求：${problem}`]).map((description, index) => ({
          id: `ac${index + 1}`, description: description.trim(), check, target: null,
        })),
        workdir: null,
      });
      let kickoffError: string | undefined;
      try { await runDevTask(task.id); }
      catch (failure: unknown) { kickoffError = getErrorMessage(failure); }
      if (mounted.current) onCreated(task, kickoffError);
    } catch (failure: unknown) {
      if (mounted.current) setError(getErrorMessage(failure));
    } finally {
      inFlight.current = false;
      if (mounted.current) {
        setSubmitting(false);
        onCreatingChange(false);
      }
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="w-full min-w-0 space-y-3">
      <div className="rounded-2xl border border-border bg-card p-3 shadow-sm focus-within:border-muted-foreground/50 sm:p-4">
        <Textarea aria-label="任务描述" rows={4} value={message} disabled={submitting}
          placeholder="描述想修复的问题，或想完成的改动…"
          className="min-h-28 resize-none border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
              event.preventDefault(); event.currentTarget.form?.requestSubmit();
            }
          }} />
        <details className="group/criteria mb-2 text-sm">
          <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-md py-2 text-xs text-muted-foreground hover:text-foreground">
            <ChevronRight className="h-3.5 w-3.5 transition-transform group-open/criteria:rotate-90" />验收要求
          </summary>
          <div className="space-y-3 border-t border-border py-3">
            <Textarea aria-label="验收标准" rows={3} disabled={submitting} value={acceptance}
              placeholder="可选，每行一条。例如：深色模式下，选中项的文字仍清晰可见。"
              onChange={(event) => setAcceptance(event.target.value)} />
            <label className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              检查方式
              <select aria-label="检查类型" disabled={submitting} value={check}
                onChange={(event) => setCheck(event.target.value as CheckKind)}
                className="rounded-md border border-input bg-background px-3 py-2 text-foreground">
                {(['unit', 'e2e', 'typecheck', 'lint'] as const).map((kind) => <option key={kind} value={kind}>{CHECK_LABEL[kind]}</option>)}
              </select>
            </label>
          </div>
        </details>
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">{submitting ? '正在创建并启动任务…' : '本地工作区 · 修改需要你审阅'}</span>
          <Button type="submit" size="icon" aria-label="发送任务" className="shrink-0 rounded-xl" disabled={!ready || !message.trim() || submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
          </Button>
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <p className="text-center text-xs text-muted-foreground">Ctrl / ⌘ + Enter 发送</p>
    </form>
  );
}
