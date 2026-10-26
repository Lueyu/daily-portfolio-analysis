/** A task is a conversation; tool internals stay collapsed until requested. */
import { ChevronRight, Check } from 'lucide-react';
import { actionLabel, formatTime, phaseLabel } from './dev-ui';
import { toolSummary } from './dev-conversation';
import type { DevIteration } from './types';

export function DevIterationTimeline({ iterations }: { iterations: DevIteration[] }) {
  if (iterations.length === 0) return <p className="text-sm text-muted-foreground">还没有执行记录。</p>;
  return (
    <ol className="min-w-0 space-y-1">
      {iterations.map((iteration: DevIteration, position: number) => (
        <li key={position} className="min-w-0">
          <details className="group/step min-w-0 rounded-lg">
            <summary className="flex cursor-pointer list-none items-start gap-2 rounded-lg px-2 py-2.5 text-xs text-muted-foreground hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
              <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 transition-transform group-open/step:rotate-90" />
              <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">{toolSummary(iteration)}</span>
              <Check className="mt-0.5 h-3 w-3 shrink-0" aria-label="已记录" />
            </summary>
            <div className="mb-3 ml-3 min-w-0 space-y-3 border-l border-border py-2 pl-4 text-xs leading-6">
              <p className="break-words text-muted-foreground">
                {phaseLabel(iteration.phase)} <code>{iteration.phase}</code> · {actionLabel(iteration.action)} <code>{iteration.action}</code>
              </p>
              <p className="text-muted-foreground">{formatTime(iteration.created_at)} · 本进程累计模型调用 {iteration.model_calls}</p>
              {iteration.hypothesis && <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{iteration.hypothesis}</p>}
              {iteration.observations.map((observation: string, index: number) => (
                <pre key={index} className="max-h-80 overflow-auto rounded-lg bg-muted/50 p-3 font-mono whitespace-pre-wrap break-words text-xs [overflow-wrap:anywhere]">{observation}</pre>
              ))}
              {iteration.decision && <p className="whitespace-pre-wrap break-words text-muted-foreground [overflow-wrap:anywhere]">{iteration.decision}</p>}
            </div>
          </details>
        </li>
      ))}
    </ol>
  );
}
