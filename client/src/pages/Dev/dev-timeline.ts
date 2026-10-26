import type { DevAgentRuntimeSnapshot, DevAgentToolEvent, DevAgentUserMessage } from '@shared/api.interface';
import { visibleRuntimeEvent } from './dev-runtime';

export type ConversationEntry = { key: string; createdAt: string } & (
  { kind: 'event'; event: DevAgentToolEvent }
  | { kind: 'user'; message: DevAgentUserMessage }
  | { kind: 'exploration'; events: DevAgentToolEvent[] }
);

function actionName(event: DevAgentToolEvent): string {
  return event.action.toLowerCase().replace(/_/g, '');
}

function isExploration(entry: ConversationEntry): entry is ConversationEntry & { kind: 'event' } {
  return entry.kind === 'event' && ['readfile', 'listdir', 'listfiles', 'glob', 'grep', 'searchcode'].includes(actionName(entry.event))
    && !entry.event.payload.error && entry.event.payload.ok !== false && !entry.event.summary.startsWith('工具失败');
}

/** Keep progress and user steering visible while folding consecutive repository exploration. */
export function conversationEntries(snapshot: DevAgentRuntimeSnapshot): ConversationEntry[] {
  const ordered: ConversationEntry[] = [
    ...snapshot.events.filter(visibleRuntimeEvent).map((event: DevAgentToolEvent): ConversationEntry => ({
      key: `event-${event.index}`, createdAt: event.createdAt, kind: 'event', event,
    })),
    ...(snapshot.messages ?? []).map((message: DevAgentUserMessage): ConversationEntry => ({
      key: `user-${message.id}`, createdAt: message.createdAt, kind: 'user', message,
    })),
  ].sort((left: ConversationEntry, right: ConversationEntry) => left.createdAt.localeCompare(right.createdAt));
  const entries: ConversationEntry[] = [];
  let pending: (ConversationEntry & { kind: 'event' })[] = [];
  const flush = (): void => {
    if (pending.length >= 3) {
      entries.push({ kind: 'exploration', key: `exploration-${pending[0].event.index}`, createdAt: pending[0].createdAt,
        events: pending.map((entry) => entry.event) });
    } else entries.push(...pending);
    pending = [];
  };
  for (const entry of ordered) {
    if (isExploration(entry)) pending.push(entry);
    else { flush(); entries.push(entry); }
  }
  flush();
  return entries;
}

export function explorationSummary(events: DevAgentToolEvent[]): string {
  const files: Set<string> = new Set();
  const directories: Set<string> = new Set();
  let searches = 0;
  for (const event of events) {
    const action: string = actionName(event);
    const inputs = event.payload.inputs as Record<string, unknown> | undefined;
    const path: string = typeof inputs?.path === 'string' ? inputs.path : `event-${event.index}`;
    if (action === 'readfile') files.add(path);
    else if (action === 'listdir' || action === 'listfiles') directories.add(path);
    else searches += 1;
  }
  return [files.size && `查看 ${files.size} 个文件`, directories.size && `浏览 ${directories.size} 个目录`, searches && `搜索 ${searches} 次`]
    .filter(Boolean).join(' · ');
}
