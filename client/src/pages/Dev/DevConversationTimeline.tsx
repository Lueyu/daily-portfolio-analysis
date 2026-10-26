/** One ordered conversation: public progress, real actions, and user steering. */
import type { FC } from 'react';
import { ChevronRight } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { DevAgentRuntimeSnapshot } from '@shared/api.interface';
import { runtimeCommentary } from './dev-runtime';
import { DevRuntimeEvent } from './DevRuntimeEvent';
import { conversationEntries, explorationSummary, type ConversationEntry } from './dev-timeline';

export const DevConversationTimeline: FC<{ taskId: string; snapshot: DevAgentRuntimeSnapshot | null }> = ({ taskId, snapshot }) => {
  if (!snapshot) return null;
  const entries: ConversationEntry[] = conversationEntries(snapshot);
  return <section aria-label="任务对话与操作" className="min-w-0 space-y-2">
    {snapshot.cursor > snapshot.events.length && <p className="text-xs text-muted-foreground">显示最近的执行进展，完整记录保存在任务目录。</p>}
    {entries.map((entry: ConversationEntry) => {
      if (entry.kind === 'user') return <div key={entry.key} className="ml-auto my-5 w-fit max-w-[92%] rounded-2xl rounded-tr-sm bg-muted px-4 py-3">
        <p className="whitespace-pre-wrap break-words text-sm leading-7 [overflow-wrap:anywhere]">{entry.message.text}</p>
      </div>;
      if (entry.kind === 'exploration') return <details key={entry.key} className="group/exploration min-w-0 rounded-lg border border-transparent open:border-border/70">
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-2 text-sm text-muted-foreground hover:bg-muted/50 [&::-webkit-details-marker]:hidden">
          <ChevronRight className="size-4 shrink-0 transition-transform group-open/exploration:rotate-90" />
          <span className="min-w-0 break-words">{explorationSummary(entry.events)}</span>
        </summary>
        <div className="space-y-1 border-t border-border/50 p-2">
          {entry.events.map((event) => <DevRuntimeEvent key={event.index} taskId={taskId} event={event} />)}
        </div>
      </details>;
      const commentary: string | null = runtimeCommentary(entry.event);
      if (!commentary) return <DevRuntimeEvent key={entry.key} taskId={taskId} event={entry.event} />;
      return <div key={entry.key} className="prose prose-sm max-w-none break-words py-3 text-foreground dark:prose-invert [overflow-wrap:anywhere] prose-p:leading-7 prose-pre:overflow-auto">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{commentary}</ReactMarkdown>
      </div>;
    })}
  </section>;
};
