/**
 * @file DevStateStepper.tsx
 * @description Linear, read-only indicator of the eight task states.
 * Completed steps are filled, the active step is highlighted, and a blocked
 * task renders an explicit red banner instead of pretending it is on the rail.
 */
import { Check } from 'lucide-react';
import { STEP_LABELS, STEP_STATUSES, stepIndex } from './dev-ui';
import type { DevStatus } from './types';

interface Props {
  status: DevStatus;
}

export function DevStateStepper({ status }: Props) {
  if (status === 'blocked') {
    return (
      <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
        任务已阻断：循环停止，等待人工调整。可查看迭代记录后在命令行继续或关闭该任务。
      </div>
    );
  }

  const current = stepIndex(status);

  return (
    <ol className="flex items-center gap-1 overflow-x-auto pb-1">
      {STEP_LABELS.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={STEP_STATUSES[i]} className="flex shrink-0 items-center">
            <div className="flex flex-col items-center gap-1">
              <div
                className={[
                  'flex h-7 w-7 items-center justify-center rounded-full border text-xs font-medium',
                  done
                    ? 'border-emerald-500 bg-emerald-500 text-white'
                    : active
                      ? 'border-sky-500 bg-sky-500 text-white'
                      : 'border-slate-300 bg-white text-slate-400',
                ].join(' ')}
              >
                {done ? <Check className="h-4 w-4" /> : i + 1}
              </div>
              <span
                className={[
                  'whitespace-nowrap text-[11px]',
                  active ? 'font-medium text-sky-700' : done ? 'text-slate-600' : 'text-slate-400',
                ].join(' ')}
              >
                {label}
              </span>
            </div>
            {i < STEP_LABELS.length - 1 && (
              <div className={`mx-1 h-px w-5 ${i < current ? 'bg-emerald-400' : 'bg-slate-200'}`} />
            )}
          </li>
        );
      })}
    </ol>
  );
}
