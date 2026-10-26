/**
 * @file dev-ui.ts
 * @description Pure presentation helpers for the Coding-Agent console.
 *
 * No React, no network here: status labels, badge colours, gate summaries
 * and diff line classification. Keeping these as plain functions makes
 * them easy to reason about and to exercise in the browser end-to-end test.
 */
import type { DevAgentExecution } from '@shared/api.interface';
import type { CheckKind, DevStatus, DevTaskSummary } from './types';
import { runtimeToolLabel } from './dev-runtime';

/** Chinese labels for each task status. */
export const STATUS_LABEL: Record<DevStatus, string> = {
  new: '待开始',
  reproduced: '已复现',
  diagnosed: '已诊断',
  patched: '候选已生成',
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
  new: 'bg-muted text-muted-foreground border-border',
  reproduced: 'bg-primary/10 text-primary border-primary/25',
  diagnosed: 'bg-primary/10 text-primary border-primary/25',
  patched: 'bg-warning/10 text-warning border-warning/25',
  verifying: 'bg-primary/10 text-primary border-primary/25',
  awaiting_approval: 'bg-warning/10 text-warning border-warning/30',
  verified: 'bg-success/10 text-success border-success/25',
  blocked: 'bg-destructive/10 text-destructive border-destructive/25',
};

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

const PHASE_LABEL: Record<string, string> = {
  react: 'ReAct 探查', verify: '候选验收', landing: '应用到主工作区',
  approval: '人工审批', block: '任务阻断', reproduce: '复现问题',
  diagnose: '诊断根因', patch: '生成补丁', reject: '拒绝补丁',
};
const ACTION_LABEL: Record<string, string> = {
  read_file: '读取文件', list_dir: '浏览目录', glob: '查找文件', grep: '搜索代码',
  probe_env: '检查环境', run_check: '运行检查', apply_patch: '提交候选补丁',
  finish: '请求人工审批', blocked: '报告阻断', reject: '拒绝补丁',
};

export function phaseLabel(value: string): string { return PHASE_LABEL[value] ?? value; }
export function actionLabel(value: string): string { return ACTION_LABEL[value] ?? runtimeToolLabel(value) ?? value; }
export function redEvidenceLabel(value: boolean | null | undefined): string {
  return value === true ? '已复现失败' : value === false ? '未复现' : '未记录';
}
export function verifyStateLabel(value: string | null | undefined): string {
  if (value == null) return '未记录';
  const labels: Record<string, string> = { none: '尚未开始', running: '验证中', failed: '验证失败', passed: '已通过' };
  return labels[value] ?? value;
}
export function candidatePatchLabel(
  candidate: boolean | null | undefined, verification: string | null | undefined, status: DevStatus,
): string {
  if (candidate == null) return '未记录';
  if (status === 'verified') return '已应用到主工作区';
  if (!candidate) return '无当前候选补丁';
  if (status === 'blocked') return '任务已停止，保留补丁供查看';
  if (verification === 'passed') return status === 'awaiting_approval' ? '验收通过，待人工审批' : '候选验收已通过';
  if (verification === 'running') return '候选验收中';
  if (verification === 'failed') return '候选验收失败';
  return verification === 'none' ? '候选待验收' : '候选状态未记录';
}
export function executionLabel(status: DevStatus, execution?: DevAgentExecution): string {
  if (execution?.state === 'stopped') return '已停止运行，记录已保留';
  if (execution?.state === 'running') return execution.command === 'approve' ? '正在应用补丁' : 'Agent 正在执行';
  if (execution?.state === 'failed') return '执行异常';
  if (status === 'blocked') return '任务已停止';
  if (status === 'verified') return '任务已结束';
  if (status === 'awaiting_approval') return '等待人工审批';
  if (!execution) return '执行状态未记录';
  return status === 'new' ? '等待启动' : '当前服务未在执行';
}
export function taskCardStatusLabel(status: DevStatus, execution?: DevAgentExecution): string {
  if (execution?.state === 'running') return '执行中';
  if (['awaiting_approval', 'verified', 'blocked'].includes(status)) return STATUS_LABEL[status];
  const interruption: string | undefined = execution?.state === 'stopped' ? '已停止'
    : execution?.state === 'failed' ? '执行失败' : undefined;
  if (interruption) return status === 'new' ? interruption : `${STATUS_LABEL[status]} · ${interruption}`;
  return STATUS_LABEL[status];
}
export function shouldCollapseObservation(text: string): boolean { return text.length > 320; }
export function matchesTask(task: DevTaskSummary, search: string, status: string): boolean {
  const query: string = search.trim().toLocaleLowerCase();
  return (status === 'all' || task.status === status)
    && `${task.title} ${task.id}`.toLocaleLowerCase().includes(query);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
export function getErrorMessage(error: unknown): string {
  if (isRecord(error) && isRecord(error.response) && isRecord(error.response.data)) {
    const detail: unknown = error.response.data.error;
    if (isRecord(detail)) {
      if (typeof detail.message === 'string' && detail.message) return detail.message;
      if (isRecord(detail.fieldErrors)) {
        for (const value of Object.values(detail.fieldErrors)) {
          if (typeof value === 'string' && value) return value;
          if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
        }
      }
    }
  }
  return error instanceof Error ? error.message : '请求失败，请重试。';
}
