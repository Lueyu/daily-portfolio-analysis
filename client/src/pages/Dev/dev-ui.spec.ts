import { describe, expect, it } from 'vitest';
import {
  actionLabel, candidatePatchLabel, executionLabel, getErrorMessage,
  matchesTask, phaseLabel, redEvidenceLabel, shouldCollapseObservation, verifyStateLabel,
  taskCardStatusLabel,
} from './dev-ui';
import type { DevTaskSummary } from './types';

describe('Coding Agent workbench presentation', () => {
  it('keeps missing historical gate fields unknown', () => {
    expect(redEvidenceLabel(undefined)).toBe('未记录');
    expect(candidatePatchLabel(undefined, undefined, 'awaiting_approval')).toBe('未记录');
    expect(verifyStateLabel(undefined)).toBe('未记录');
  });
  it('does not present verified or rejected candidates as awaiting approval', () => {
    expect(candidatePatchLabel(true, 'passed', 'awaiting_approval')).toBe('验收通过，待人工审批');
    expect(candidatePatchLabel(true, 'passed', 'verified')).toBe('已应用到主工作区');
    expect(candidatePatchLabel(true, 'passed', 'blocked')).toBe('任务已停止，保留补丁供查看');
    expect(candidatePatchLabel(false, 'none', 'diagnosed')).toBe('无当前候选补丁');
    expect(candidatePatchLabel(true, 'running', 'verifying')).toBe('候选验收中');
  });
  it('uses observed execution instead of guessing that every active milestone is running', () => {
    expect(executionLabel('new', { state: 'running', command: 'run', error: null })).toBe('Agent 正在执行');
    expect(executionLabel('diagnosed', { state: 'idle', command: null, error: null })).toBe('当前服务未在执行');
    expect(executionLabel('new', { state: 'failed', command: 'run', error: 'failed' })).toBe('执行异常');
    expect(executionLabel('reproduced', undefined)).toBe('执行状态未记录');
  });
  it('prioritizes live task-card execution without erasing saved outcomes', () => {
    const running = { state: 'running' as const, command: 'run' as const, error: null };
    expect(taskCardStatusLabel('new', running)).toBe('执行中');
    expect(taskCardStatusLabel('awaiting_approval', { ...running, command: 'approve' })).toBe('执行中');
    expect(taskCardStatusLabel('new', { ...running, state: 'stopped' })).toBe('已停止');
    expect(taskCardStatusLabel('new', { ...running, state: 'failed' })).toBe('执行失败');
    expect(taskCardStatusLabel('diagnosed', { ...running, state: 'failed' })).toBe('已诊断 · 执行失败');
    expect(taskCardStatusLabel('awaiting_approval', { ...running, state: 'stopped' })).toBe('待审批');
    expect(taskCardStatusLabel('awaiting_approval', { ...running, state: 'failed' })).toBe('待审批');
    expect(taskCardStatusLabel('verified', { ...running, state: 'failed' })).toBe('已验证');
    expect(taskCardStatusLabel('blocked', { ...running, state: 'stopped' })).toBe('已阻断');
    expect(taskCardStatusLabel('new')).toBe('待开始');
  });
  it('translates known actions and retains unfamiliar values', () => {
    expect(phaseLabel('react')).toBe('ReAct 探查');
    expect(actionLabel('apply_patch')).toBe('提交候选补丁');
    expect(phaseLabel('future_phase')).toBe('future_phase');
    expect(actionLabel('future_tool')).toBe('future_tool');
    expect(verifyStateLabel('future_state')).toBe('future_state');
    expect(actionLabel('TerminalPoll')).toBe('读取终端输出');
    expect(actionLabel('Browser')).toBe('浏览器操作');
    expect(actionLabel('model')).toBe('规划下一步');
  });
  it('folds only long saved observations', () => {
    expect(shouldCollapseObservation('x'.repeat(320))).toBe(false);
    expect(shouldCollapseObservation('x'.repeat(321))).toBe(true);
  });
  it('shows actionable backend errors rather than Axios generic status text', () => {
    expect(getErrorMessage({ response: { data: { error: { message: 'task is already running' } } } })).toBe('task is already running');
    expect(getErrorMessage({ response: { data: { error: { fieldErrors: { title: ['标题不能为空'] } } } } })).toBe('标题不能为空');
    expect(getErrorMessage(new Error('连接失败'))).toBe('连接失败');
    expect(getErrorMessage(null)).toBe('请求失败，请重试。');
  });
  it('combines title/id search with exact task status filtering', () => {
    const task: DevTaskSummary = { id: 'dev_example', title: 'Fix Contrast', status: 'blocked', redSeen: false, iterationCount: 8, updatedAt: '' };
    expect(matchesTask(task, ' contrast ', 'all')).toBe(true);
    expect(matchesTask(task, 'example', 'blocked')).toBe(true);
    expect(matchesTask(task, '', 'verified')).toBe(false);
    expect(matchesTask(task, 'missing', 'all')).toBe(false);
  });
});
