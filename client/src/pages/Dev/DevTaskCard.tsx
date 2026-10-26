/** Quiet conversation navigation, without a second dashboard in the sidebar. */
import { Loader2, MessageSquare, Circle } from 'lucide-react';
import { taskCardStatusLabel, formatTime } from './dev-ui';
import type { DevTaskSummary } from './types';

interface Props { task: DevTaskSummary; onClick: () => void; selected?: boolean; disabled?: boolean; }
export function DevTaskCard({ task, onClick, selected = false, disabled = false }: Props) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} aria-label={'打开任务：' + task.title} aria-pressed={selected}
      className={'group flex w-full min-w-0 gap-2.5 rounded-lg px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 ' + (selected ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground')}>
      {task.execution?.state === 'running'
        ? <Loader2 className="mt-1 h-3.5 w-3.5 shrink-0 animate-spin" aria-label="正在执行" />
        : <MessageSquare className="mt-1 h-3.5 w-3.5 shrink-0" />}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{task.title}</p>
        <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {task.status === 'awaiting_approval' && task.execution?.state !== 'running' && <Circle className="h-1.5 w-1.5 fill-primary text-primary" />}
          {taskCardStatusLabel(task.status, task.execution)}<span className="ml-auto">{formatTime(task.updatedAt)}</span>
        </p>
      </div>
    </button>
  );
}
