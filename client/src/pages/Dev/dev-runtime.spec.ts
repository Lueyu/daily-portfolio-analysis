import { describe, expect, it } from 'vitest';
import type { DevAgentChange, DevAgentRuntimeSnapshot, DevAgentToolEvent } from '@shared/api.interface';
import {
  mergeRuntimeEvents, runtimeActionBlock, runtimeEventSummary, runtimeScreenshotId,
  sourceChanges, visibleRuntimeEvent, runtimeCommentary, type RuntimeActionState,
} from './dev-runtime';

const event = (index: number, payload: Record<string, unknown> = {}): DevAgentToolEvent => ({
  index, action: 'TerminalPoll', summary: 'raw tool result', createdAt: '', payload,
});
const change: DevAgentChange = {
  id: 'change-1', before: 'old', after: 'new', status: 'completed',
  reason: '修复保存', tool: 'EditFile', files: ['client/save.ts'],
};
const snapshot: DevAgentRuntimeSnapshot = {
  version: 1, revision: 'new', changes: [change], events: [], cursor: 0,
  pending: null, verification: [],
};
const state: RuntimeActionState = {
  ready: true, running: false, loading: false, busy: false, error: null,
  snapshot, expectedRevision: 'new',
};

describe('runtime event history', () => {
  it('appends cursor pages, deduplicates overlap, and keeps the newest bounded records in order', () => {
    const result: DevAgentToolEvent[] = mergeRuntimeEvents(
      [event(0), event(1), event(2)], [event(2, { output: 'updated' }), event(4), event(3)], 3,
    );
    expect(result.map((row: DevAgentToolEvent) => row.index)).toEqual([2, 3, 4]);
    expect(result[0].payload.output).toBe('updated');
  });

  it('retains previous events when the next poll contains no new rows', () => {
    expect(mergeRuntimeEvents([event(1)], [])).toEqual([event(1)]);
  });

  it('keeps terminal and screenshot payloads out of collapsed summaries', () => {
    expect(runtimeEventSummary(event(1, { output: 'SECRET_OUTPUT', status: 'completed', exit_code: 0 })))
      .toBe('读取终端输出 · 已完成 · 退出码 0');
    expect(runtimeEventSummary({ ...event(2), action: 'Browser', payload: { artifact_id: 'a'.repeat(32) } }))
      .toBe('浏览器操作 · 截图已保存');
    expect(runtimeEventSummary({ ...event(3), action: 'unknown', summary: 'x'.repeat(1000) }).length)
      .toBeLessThanOrEqual(120);
  });

  it('accepts only opaque artifact identifiers, leaving extension resolution to the server', () => {
    expect(runtimeScreenshotId(event(1, { artifact_id: 'a'.repeat(32) })))
      .toBe('a'.repeat(32));
    expect(runtimeScreenshotId(event(1, { artifact_id: 'a'.repeat(32) + '.png' }))).toBeNull();
    expect(runtimeScreenshotId(event(2, { artifact_id: '../../secret.png' }))).toBeNull();
    expect(runtimeScreenshotId(event(3, { artifact_id: 'https://example.test/a.png' }))).toBeNull();
  });

  it('shows the actual command, page URL, and edited file in action summaries', () => {
    expect(runtimeEventSummary({ ...event(1), action: 'TerminalStart',
      payload: { inputs: { command: 'npm run dev:local', reason: '复现数据库加载失败' } } }))
      .toContain('npm run dev:local');
    expect(runtimeEventSummary({ ...event(2), action: 'Browser',
      payload: { inputs: { action: 'navigate', url: 'http://preview:8080/holdings' } } }))
      .toContain('http://preview:8080/holdings');
    expect(runtimeEventSummary({ ...event(3), action: 'EditFile',
      payload: { inputs: { path: 'scripts/dev-local.js', old_text: 'SECRET_OLD_SOURCE' } } }))
      .toContain('scripts/dev-local.js');
    expect(runtimeEventSummary({ ...event(3), action: 'EditFile',
      payload: { inputs: { path: 'scripts/dev-local.js', old_text: 'SECRET_OLD_SOURCE' } } }))
      .not.toContain('SECRET_OLD_SOURCE');
    expect(runtimeEventSummary({ ...event(4), action: 'grep',
      payload: { inputs: { path: '.', pattern: 'DATABASE_URL' } } }))
      .toBe('搜索代码 · DATABASE_URL · .');
    expect(runtimeEventSummary({ ...event(5), action: 'list_dir', payload: { inputs: { path: 'scripts' } } }))
      .toBe('查看目录 · scripts');
    expect(runtimeEventSummary({ ...event(6), action: 'InspectLocalApp', payload: {} }))
      .toBe('观察本机主项目 · 仅诊断，不算候选验收');
  });

  it('keeps public progress and meaningful tool results while suppressing empty planning and polling', () => {
    expect(visibleRuntimeEvent({ ...event(1), action: 'model', summary: '模型返回工具决策' })).toBe(false);
    expect(visibleRuntimeEvent({ ...event(2), action: 'model', summary: '{"action":"read_file","path":"x"}' })).toBe(false);
    expect(visibleRuntimeEvent(event(3, { status: 'running', output: '' }))).toBe(false);
    expect(visibleRuntimeEvent(event(4, { status: 'running', output: 'server ready' }))).toBe(true);
    expect(visibleRuntimeEvent(event(5, { status: 'completed', exit_code: 0 }))).toBe(true);
    const progress: DevAgentToolEvent = { ...event(6), action: 'model', summary: '已找到环境变量加载顺序问题。' };
    expect(visibleRuntimeEvent(progress)).toBe(true);
    expect(runtimeCommentary(progress)).toBe('已找到环境变量加载顺序问题。');
    expect(runtimeCommentary({ ...progress, payload: { content: '完整的公开进展', reasoning_content: 'PRIVATE_REASONING' } }))
      .toBe('完整的公开进展');
  });
});

describe('revision actions', () => {
  it('shows real source changes, including failed operations with partial edits, but excludes no-ops', () => {
    expect(sourceChanges([
      change, { ...change, id: 'no-files', files: [] },
      { ...change, id: 'same', after: change.before },
      { ...change, id: 'partial', status: 'failed' },
    ]).map((row: DevAgentChange) => row.id)).toEqual(['change-1', 'partial']);
  });

  it('allows a settled current snapshot', () => {
    expect(runtimeActionBlock(state)).toBeNull();
  });

  it.each<Partial<RuntimeActionState>>([
    { ready: false }, { running: true }, { loading: true }, { busy: true },
    { error: 'offline' }, { snapshot: null },
    { snapshot: { ...snapshot, revision: null } },
    { snapshot: { ...snapshot, pending: { operation_id: 'active' } } },
  ])('blocks source writes while state is unavailable or busy: %j', (overrides) => {
    expect(runtimeActionBlock({ ...state, ...overrides })).toBeTruthy();
  });

  it('requires reopening confirmation when a newer revision arrived', () => {
    expect(runtimeActionBlock({ ...state, expectedRevision: 'old' })).toContain('版本已更新');
  });
});
