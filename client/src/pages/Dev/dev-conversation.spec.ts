import { describe, expect, it } from 'vitest';
import { taskProgress, toolSummary } from './dev-conversation';
import type { DevIteration } from './types';

const record: DevIteration = { index: 1, phase: 'react', action: 'read_file', hypothesis: '',
  observations: ['client/src/app.tsx: ok'], decision: '', model_calls: 1, created_at: '' };

describe('conversation progress from saved evidence', () => {
  it('keeps transient execution separate from saved milestones', () => {
    expect(taskProgress({ status: 'diagnosed', iterations: [], patchCount: 0 })).not.toContain('正在');
    expect(taskProgress({ status: 'new', iterations: [record], patchCount: 0,
      execution: { state: 'running', command: 'run', error: null } })).toContain('正在处理');
  });
  it('shows a pending model request only while the task is running', () => {
    const task = { status: 'new' as const, iterations: [record], patchCount: 0,
      execution: { state: 'running' as const, command: 'run' as const, error: null } };
    const activity = { status: 'running' as const, startedAt: '2026-10-26T01:00:00Z' };
    expect(taskProgress(task, activity)).toContain('正在等待模型响应');
    expect(taskProgress({ ...task, execution: { ...task.execution, state: 'stopped' } }, activity)).not.toContain('等待模型');
    expect(taskProgress({ ...task, execution: { ...task.execution, command: 'approve' } }, activity)).toContain('批准');
  });
  it('explains model timeouts without exposing a traceback in the progress text', () => {
    const task = { status: 'new' as const, iterations: [record], patchCount: 0,
      execution: { state: 'failed' as const, command: 'run' as const, error: 'Traceback: private detail\nopenai.APITimeoutError: Request timed out.' } };
    expect(taskProgress(task)).toBe('模型请求超时，修改和记录已保留，可以继续任务。');
    expect(taskProgress({ ...task, execution: { ...task.execution, error: null } }, {
      status: 'failed', startedAt: '2026-10-26T01:00:00Z', error: '模型连接失败，请检查设置。',
    })).toBe('模型连接失败，请检查设置。');
  });
  it('explains recoverable budget stops without suggesting the task is complete', () => {
    expect(taskProgress({ status: 'blocked', canResume: true, iterations: [], patchCount: 0 })).toContain('继续运行');
    expect(taskProgress({ status: 'blocked', iterations: [], patchCount: 0 })).not.toContain('继续运行');
  });
  it('keeps the human decision and completion distinct', () => {
    expect(taskProgress({ status: 'awaiting_approval', iterations: [], patchCount: 1 })).toContain('审阅');
    expect(taskProgress({ status: 'verified', iterations: [], patchCount: 1 })).toContain('已应用');
    expect(taskProgress({ status: 'verified', iterations: [], patchCount: 1 })).not.toContain('等待');
  });
  it('does not promise a retry for terminal saved outcomes after process cleanup', () => {
    const stopped = taskProgress({ status: 'blocked', iterations: [], patchCount: 0,
      execution: { state: 'stopped', command: 'run', error: null } });
    expect(stopped).toContain('阻断原因');
    expect(stopped).not.toContain('可以继续');
    const landed = taskProgress({ status: 'verified', iterations: [], patchCount: 1,
      execution: { state: 'failed', command: 'approve', error: 'cleanup failed' } });
    expect(landed).toContain('已应用');
    expect(landed).not.toContain('重新尝试');
    expect(taskProgress({ status: 'awaiting_approval', iterations: [], patchCount: 1,
      execution: { state: 'stopped', command: 'run', error: null } })).toContain('审阅');
  });
  it('explains provider quota exhaustion and preserves progress after a service restart', () => {
    expect(taskProgress({ status: 'new', iterations: [record], patchCount: 0,
      execution: { state: 'failed', command: 'run', error: 'RateLimitError: 429 SetLimitExceeded' } })).toContain('使用额度');
    expect(taskProgress({ status: 'new', iterations: [record], patchCount: 0 })).toContain('已有进展');
  });
  it('uses concise actions and does not expose an entire tool output in the summary', () => {
    expect(toolSummary(record)).toContain('读取文件');
    expect(toolSummary({ ...record, observations: ['x'.repeat(5000)] }).length).toBeLessThan(150);
    expect(toolSummary({ ...record, action: 'future_tool', phase: 'future_phase' })).toBe('执行操作');
  });
  it('describes v2 resumable blocks without inventing a budget interruption', () => {
    const progress: string = taskProgress({ status: 'blocked', canResume: true, runtime_version: 2,
      iterations: [], patchCount: 0 });
    expect(progress).toContain('继续运行');
    expect(progress).toContain('运行记录已保留');
    expect(progress).not.toMatch(/次数|时间限制|旧的/);
  });
  it('describes v2 approval and completion as validation in an isolated merged copy', () => {
    const approving: string = taskProgress({ status: 'awaiting_approval', runtime_version: 2,
      iterations: [], patchCount: 1, execution: { state: 'running', command: 'approve', error: null } });
    expect(approving).toContain('隔离副本');
    expect(approving).not.toContain('运行主工作区检查');
    const verified: string = taskProgress({ status: 'verified', runtime_version: 2, iterations: [], patchCount: 1 });
    expect(verified).toContain('已应用到主工作区');
    expect(verified).toContain('隔离副本');
  });
  it.each([
    ['TerminalStart', '运行终端命令'], ['TerminalPoll', '读取终端输出'], ['Browser', '浏览器操作'],
    ['WriteFile', '写入文件'], ['EditFile', '编辑文件'], ['Verify', '运行验证'],
    ['ServiceStart', '启动预览服务'], ['UndoChange', '撤销修改'], ['RestoreCheckpoint', '恢复版本'],
    ['model', '规划下一步'],
  ])('labels general-runtime action %s without exposing tool payload', (action: string, expected: string) => {
    expect(toolSummary({ ...record, action, observations: ['SECRET_TOOL_PAYLOAD'] })).toBe(expected);
  });
});
