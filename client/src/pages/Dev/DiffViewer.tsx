/**
 * @file DiffViewer.tsx
 * @description Read-only, colour-coded unified-diff view with the patch's
 * target files and the hypothesis that justified the change.
 */
import { FileCode2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { parseDiffLines } from './dev-ui';

interface Props {
  patchId: string;
  targetFiles: string[];
  hypothesis: string;
  diff: string;
}

const LINE_CLASS: Record<string, string> = {
  add: 'bg-emerald-50 text-emerald-800',
  del: 'bg-rose-50 text-rose-800',
  hunk: 'bg-sky-50 text-sky-800',
  meta: 'bg-slate-100 text-slate-500',
  ctx: 'text-slate-700',
};

export function DiffViewer({ patchId, targetFiles, hypothesis, diff }: Props) {
  const lines = parseDiffLines(diff);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-slate-700">补丁 {patchId}</span>
        {targetFiles.map((f) => (
          <Badge key={f} variant="outline" className="font-mono text-xs">
            <FileCode2 className="mr-1 h-3 w-3" />
            {f}
          </Badge>
        ))}
      </div>
      {hypothesis && (
        <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <span className="font-medium">改动假设：</span>
          {hypothesis}
        </p>
      )}
      <ScrollArea className="h-96 rounded-md border border-slate-200">
        <pre className="min-w-full text-xs leading-5">
          <code className="font-mono">
            {lines.map((line, i) => (
              <div key={i} className={`whitespace-pre px-3 ${LINE_CLASS[line.kind]}`}>
                {line.text || ' '}
              </div>
            ))}
          </code>
        </pre>
      </ScrollArea>
    </div>
  );
}
