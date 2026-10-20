/**
 * @file dev-ui.ts
 * @description Pure presentation helpers for the Coding-Agent console.
 *
 * No React, no network here: status labels, badge colours, the linear step
 * model and diff line classification. Keeping these as plain functions makes
 * them easy to reason about and to exercise in the browser end-to-end test.
 */
import type { CheckKind, DevStatus } from './types';

/** Chinese labels for each task status. */
export const STATUS_LABEL: Record<DevStatus, string> = {
  new: '待开始',
  reproduced: '已复现',
  diagnosed: '已诊断',
  patched: '已改代码',
  verifying: '验证中',
  awaiting_approval: '待审批',
  verified: '已验证',
  blocked: '已阻断',
};

/** Chinese labels for the acceptance check kinds. */
export const CHECK_LABEL: Record<CheckKind, string> = {
  unit: '单元测试',
  e2e: '端到端测试',
  typecheck: '类型检查',
  lint: '代码规范',
};

/** Tailwind badge classes per status. Colour encodes outcome, not importance. */
export const STATUS_TONE: Record<DevStatus, string> = {
  new: 'bg-slate-100 text-slate-700 ring-slate-200',
  reproduced: 'bg-sky-50 text-sky-700 ring-sky-200',
  diagnosed: 'bg-sky-50 text-sky-700 ring-sky-200',
  patched: 'bg-amber-50 text-amber-700 ring-amber-200',
  verifying: 'bg-sky-50 text-sky-700 ring-sky-200',
  awaiting_approval: 'bg-amber-50 text-amber-800 ring-amber-300',
  verified: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  blocked: 'bg-rose-50 text-rose-700 ring-rose-200',
};

/**
 * The linear happy path. `blocked` is an exit, not a normal step, so it is not
 * drawn in the stepper; awaiting_approval sits between verification and done.
 */
export const STEP_STATUSES: DevStatus[] = [
  'new',
  'reproduced',
  'diagnosed',
  'patched',
  'verifying',
  'awaiting_approval',
  'verified',
];

export const STEP_LABELS: string[] = [
  '建立任务',
  '复现失败',
  '诊断根因',
  '修改代码',
  '自动验证',
  '人工审批',
  '完成',
];

/** Index of the current step, so the stepper can mark done/active steps. */
export function stepIndex(status: DevStatus): number {
  if (status === 'blocked') return -1;
  const i = STEP_STATUSES.indexOf(status);
  return i === -1 ? 0 : i;
}

export type DiffLineKind = 'add' | 'del' | 'hunk' | 'meta' | 'ctx';

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

/**
 * Classify each line of a unified diff for simple colour rendering.
 *  - `+++`/`---` file headers and `diff --git`/`index` are meta
 *  - `@@` hunk headers are hunk
 *  - `+`/`-` are additions / deletions; everything else is context
 */
export function parseDiffLines(diff: string): DiffLine[] {
  return diff
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      if (line.startsWith('+++') || line.startsWith('---')) {
        return { kind: 'meta' as const, text: line };
      }
      if (line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('new file')) {
        return { kind: 'meta' as const, text: line };
      }
      if (line.startsWith('@@')) return { kind: 'hunk' as const, text: line };
      if (line.startsWith('+')) return { kind: 'add' as const, text: line };
      if (line.startsWith('-')) return { kind: 'del' as const, text: line };
      return { kind: 'ctx' as const, text: line };
    });
}

/** Short, human-friendly file time, falling back to a raw string when absent. */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Polling intervals in milliseconds. */
export const LIST_POLL_MS = 3000;
export const DETAIL_POLL_MS = 1500;
