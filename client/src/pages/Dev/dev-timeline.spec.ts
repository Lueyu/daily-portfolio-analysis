import { describe, expect, it } from 'vitest';
import type { DevAgentRuntimeSnapshot, DevAgentToolEvent } from '@shared/api.interface';
import { conversationEntries, explorationSummary } from './dev-timeline';

const event = (index: number, action: string, payload: Record<string, unknown> = {}): DevAgentToolEvent => ({
  index, action, payload, summary: '', createdAt: `2026-10-26T00:00:0${index}Z`,
});
const snapshot = (events: DevAgentToolEvent[]): DevAgentRuntimeSnapshot => ({
  version: 2, revision: 'rev', changes: [], events, cursor: events.length, pending: null, verification: [],
});

describe('conversation exploration groups', () => {
  it('folds long exploration sequences but leaves public progress, commands, and errors in order', () => {
    const events = [event(0, 'read_file', { inputs: { path: 'a.ts' } }),
      event(1, 'read_file', { inputs: { path: 'a.ts' } }), event(2, 'grep', { inputs: { pattern: 'db' } }),
      event(3, 'model', { content: '已确认原因，开始修复。' }), event(4, 'TerminalStart', { inputs: { command: 'npm test' } }),
      event(5, 'read_file', { error: 'not found' })];
    const rows = conversationEntries(snapshot(events));
    expect(rows.map((row) => row.kind)).toEqual(['exploration', 'event', 'event', 'event']);
    expect(rows[0].kind === 'exploration' && rows[0].events.map((row) => row.index)).toEqual([0, 1, 2]);
    expect(explorationSummary(events.slice(0, 3))).toBe('查看 1 个文件 · 搜索 1 次');
  });

  it('keeps user steering visible once and does not group operations across it', () => {
    const state = snapshot([event(0, 'read_file'), event(2, 'read_file'), event(3, 'user_message'), event(4, 'grep')]);
    state.messages = [{ id: 'message', text: '先验证页面', createdAt: '2026-10-26T00:00:01Z' }];
    expect(conversationEntries(state).map((row) => row.kind)).toEqual(['event', 'user', 'event', 'event']);
  });
});
