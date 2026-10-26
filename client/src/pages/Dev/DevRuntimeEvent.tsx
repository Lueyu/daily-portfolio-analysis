/** Tool actions stay readable; output and browser artifacts load on expansion. */
import { useEffect, useState, type FC, type SyntheticEvent } from 'react';
import { ChevronRight } from 'lucide-react';
import { getDevArtifact } from '@/api';
import { Button } from '@/components/ui/button';
import { Image } from '@/components/ui/image';
import type { DevAgentToolEvent } from '@shared/api.interface';
import { formatTime, getErrorMessage } from './dev-ui';
import { runtimeEventReason, runtimeEventSummary, runtimeScreenshotId } from './dev-runtime';

const outputClass = 'max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/50 p-3 font-mono text-xs leading-6 [overflow-wrap:anywhere]';

const RuntimeScreenshot: FC<{ taskId: string; artifactId: string }> = ({ taskId, artifactId }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<number>(0);
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setUrl(null); setError(null);
    void getDevArtifact(taskId, artifactId).then((blob: Blob): void => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
    }).catch((cause: unknown): void => { if (!cancelled) setError(getErrorMessage(cause)); });
    return (): void => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [taskId, artifactId, attempt]);
  if (error) return <div className="space-y-2">
    <p role="alert" className="text-xs text-destructive">截图加载失败：{error}</p>
    <Button size="sm" variant="outline" onClick={() => setAttempt((value: number) => value + 1)}>重试截图</Button>
  </div>;
  if (!url) return <p role="status" className="text-xs text-muted-foreground">加载截图中…</p>;
  return <Image src={url} sizes="(max-width: 768px) 90vw, 720px" alt="该次浏览器操作保存的页面截图"
    className="w-full rounded-md border border-border" onError={() => setError('图片无法显示')} />;
};

export const DevRuntimeEvent: FC<{ taskId: string; event: DevAgentToolEvent }> = ({ taskId, event }) => {
  const [open, setOpen] = useState<boolean>(false);
  const screenshotId: string | null = runtimeScreenshotId(event);
  const reason: string | null = runtimeEventReason(event);
  const output: unknown = event.payload.output ?? event.payload.stdout;
  return <details className="group/event min-w-0" onToggle={(toggle: SyntheticEvent<HTMLDetailsElement>) => {
    setOpen(toggle.currentTarget.open);
  }}>
    <summary className="flex cursor-pointer list-none items-start gap-2 rounded-lg py-2 text-sm leading-6 text-muted-foreground hover:text-foreground">
      <ChevronRight className="mt-1 h-3.5 w-3.5 shrink-0 transition-transform group-open/event:rotate-90" />
      <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">{runtimeEventSummary(event)}</span>
    </summary>
    {open && <div className="min-w-0 space-y-3 border-l border-border pb-3 pl-5">
      <p className="text-xs text-muted-foreground">{formatTime(event.createdAt)}</p>
      {reason && <p className="whitespace-pre-wrap break-words text-sm leading-7">{reason}</p>}
      {typeof output === 'string' && <pre aria-label="终端或工具输出" className={outputClass}>
        {output || '该次操作没有文本输出。'}
      </pre>}
      {typeof event.payload.error === 'string' && <p role="alert" className="break-words text-sm text-destructive">{event.payload.error}</p>}
      {event.payload.output_truncated === true && <p className="text-xs text-muted-foreground">后续输出可在下一条终端记录中查看。</p>}
      {screenshotId && <RuntimeScreenshot taskId={taskId} artifactId={screenshotId} />}
      <details>
        <summary className="cursor-pointer text-xs text-muted-foreground">查看工具数据</summary>
        <pre className={`${outputClass} mt-2`}>{JSON.stringify({ summary: event.summary, ...event.payload }, null, 2)}</pre>
      </details>
    </div>}
  </details>;
};
