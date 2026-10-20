/**
 * @file DevIterationTimeline.tsx
 * @description Renders the append-only iterations.jsonl log as a vertical
 * timeline. Every iteration is one observe -> think -> act step, so the list
 * reads top-to-bottom as the full story of how the agent reached its result.
 */
import { BrainCircuit, Terminal, Eye, Flag } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatTime } from './dev-ui';
import type { DevIteration } from './types';

interface Props {
  iterations: DevIteration[];
}

export function DevIterationTimeline({ iterations }: Props) {
  if (iterations.length === 0) {
    return <p className="text-sm text-slate-400">还没有迭代记录，启动任务后会在这里逐步追加。</p>;
  }

  return (
    <ol className="space-y-4 border-l border-slate-200 pl-5">
      {iterations.map((it) => (
        <li key={it.index} className="relative">
          <span className="absolute -left-[26px] top-1 flex h-5 w-5 items-center justify-center rounded-full bg-sky-100 text-[10px] font-medium text-sky-700">
            {it.index}
          </span>
          <div className="space-y-1.5 rounded-md border border-slate-200 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="text-xs">
                {it.phase}
              </Badge>
              <span className="text-[11px] text-slate-400">{formatTime(it.created_at)}</span>
              <span className="text-[11px] text-slate-400">模型调用 {it.model_calls} 次</span>
            </div>
            {it.hypothesis && (
              <p className="flex gap-1.5 text-xs text-slate-700">
                <BrainCircuit className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-500" />
                <span>
                  <span className="font-medium">假设：</span>
                  {it.hypothesis}
                </span>
              </p>
            )}
            {it.action && (
              <p className="flex gap-1.5 text-xs text-slate-700">
                <Terminal className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
                <span className="font-mono break-all">{it.action}</span>
              </p>
            )}
            {it.observations.length > 0 && (
              <div className="flex gap-1.5 text-xs text-slate-600">
                <Eye className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                <ul className="space-y-0.5">
                  {it.observations.map((obs, i) => (
                    <li key={i} className="font-mono break-all whitespace-pre-wrap">
                      {obs}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {it.decision && (
              <p className="flex gap-1.5 text-xs font-medium text-slate-800">
                <Flag className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                <span>{it.decision}</span>
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
