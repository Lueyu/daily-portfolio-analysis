import { Check, X } from 'lucide-react';
import type { AgentRunStatus } from '@shared/api.interface';

interface RunProgressBarProps {
  status: AgentRunStatus;
}

interface StepDef {
  key: string;
  label: string;
  statusKey: AgentRunStatus;
}

const steps: StepDef[] = [
  { key: 'fetching', label: '取证', statusKey: 'fetching' },
  { key: 'debating', label: '辩论', statusKey: 'debating' },
  { key: 'critiquing', label: 'Critic', statusKey: 'critiquing' },
  { key: 'risk_check', label: '风控', statusKey: 'risk_check' },
  { key: 'completed', label: '评级', statusKey: 'completed' },
];

const statusOrder: AgentRunStatus[] = [
  'pending',
  'fetching',
  'debating',
  'critiquing',
  'risk_check',
  'awaiting_human',
  'completed',
];

function getStepState(
  stepIndex: number,
  status: AgentRunStatus,
): 'done' | 'active' | 'pending' | 'failed' | 'awaiting' {
  const currentIdx = statusOrder.indexOf(status);
  const stepStatusIdx = statusOrder.indexOf(steps[stepIndex].statusKey);

  if (status === 'failed' || status === 'cancelled') {
    // all steps up to current are done-ish, the failing step shows failed
    // find which step was running when it failed — approximate: use prior step index
    const stepKeys: AgentRunStatus[] = ['fetching', 'debating', 'critiquing', 'risk_check', 'completed'];
    // Without a failed-step field, show first step as failed approximation
    if (stepIndex === 0) return 'failed';
    return 'pending';
  }

  if (status === 'pending') return 'pending';

  if (stepStatusIdx < currentIdx) return 'done';
  if (stepStatusIdx === currentIdx) return 'active';

  // awaiting_human: all 5 steps done, but awaiting human decision
  if (status === 'awaiting_human' && stepIndex === steps.length - 1) {
    return 'awaiting';
  }

  return 'pending';
}

function RunProgressBar({ status }: RunProgressBarProps) {
  return (
    <div className="w-full">
      <div className="flex items-center justify-between">
        {steps.map((step, idx) => {
          const state = getStepState(idx, status);
          return (
            <div key={step.key} className="flex flex-1 flex-col items-center last:flex-none">
              <div
                className={[
                  'relative z-10 flex h-6 w-6 items-center justify-center rounded-full border-2 text-[10px] font-semibold transition-colors',
                  state === 'done'
                    ? 'border-emerald-500 bg-emerald-500 text-white'
                    : state === 'active'
                      ? 'border-primary bg-primary text-primary-foreground animate-pulse'
                      : state === 'failed'
                        ? 'border-rose-500 bg-rose-500 text-white'
                        : state === 'awaiting'
                          ? 'border-amber-500 bg-amber-500 text-white'
                          : 'border-slate-300 bg-white text-slate-400 dark:border-slate-600 dark:bg-slate-800',
                ].join(' ')}
              >
                {state === 'done' ? (
                  <Check size={12} strokeWidth={3} />
                ) : state === 'failed' ? (
                  <X size={12} strokeWidth={3} />
                ) : state === 'awaiting' ? (
                  <span className="text-[9px]">待</span>
                ) : (
                  <span>{idx + 1}</span>
                )}
              </div>
              <span
                className={[
                  'mt-1 text-[10px] font-medium',
                  state === 'done'
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : state === 'active'
                      ? 'text-primary'
                      : state === 'failed'
                        ? 'text-rose-600 dark:text-rose-400'
                        : state === 'awaiting'
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-slate-400',
                ].join(' ')}
              >
                {step.label}
              </span>
              {idx < steps.length - 1 && (
                <div className="absolute top-3 left-full h-0.5 w-full -translate-y-1/2">
                  {/* connector handled by parent flex */}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="-mt-9 flex">
        {steps.slice(0, -1).map((_step, idx) => {
          const state = getStepState(idx, status);
          const nextState = getStepState(idx + 1, status);
          const done = state === 'done' && (nextState === 'done' || nextState === 'active' || nextState === 'awaiting');
          return (
            <div
              key={`line-${idx}`}
              className={[
                'mt-0 flex-1 border-t-2',
                done
                  ? 'border-emerald-500'
                  : 'border-slate-200 dark:border-slate-700',
              ].join(' ')}
              style={{ marginLeft: '1.25rem', marginRight: '1.25rem' }}
            />
          );
        })}
      </div>
    </div>
  );
}

export default RunProgressBar;
