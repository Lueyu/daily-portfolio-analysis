/**
 * @file DevTaskCard.tsx
 * @description One row in the task list. Highlights tasks that are waiting for
 * human approval and surfaces the most useful progress numbers at a glance.
 */
import { Clock3, GitBranch, Repeat } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { STATUS_LABEL, STATUS_TONE, formatTime } from './dev-ui';
import type { DevTaskSummary } from './types';

interface Props {
  task: DevTaskSummary;
  onClick: () => void;
}

export function DevTaskCard({ task, onClick }: Props) {
  const awaiting = task.status === 'awaiting_approval';
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'w-full rounded-lg border bg-white p-4 text-left transition hover:border-sky-300 hover:shadow-sm',
        awaiting ? 'border-amber-300 ring-1 ring-amber-200' : 'border-slate-200',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-800">{task.title}</p>
          <p className="mt-0.5 font-mono text-xs text-slate-400">{task.id}</p>
        </div>
        <Badge className={`shrink-0 ring-1 ${STATUS_TONE[task.status]}`} variant="outline">
          {STATUS_LABEL[task.status]}
        </Badge>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1">
          <Repeat className="h-3 w-3" />
          {task.iterationCount} 次迭代
        </span>
        <span className="inline-flex items-center gap-1">
          <Clock3 className="h-3 w-3" />
          {formatTime(task.updatedAt)}
        </span>
        {awaiting && (
          <span className="inline-flex items-center gap-1 font-medium text-amber-700">
            <GitBranch className="h-3 w-3" />
            待你审批补丁
          </span>
        )}
      </div>
    </button>
  );
}
