/** Read-only unified diff with preserved source text and local scrolling. */
import { FileCode2 } from 'lucide-react';
import { parseDiffLines, type DiffLine, type DiffLineKind } from './dev-ui';

interface DiffViewerProps {
  patchId: string;
  targetFiles: string[];
  hypothesis: string;
  diff: string;
}

const LINE_CLASS: Record<DiffLineKind, string> = {
  add: 'bg-success/10 text-success',
  del: 'bg-destructive/10 text-destructive',
  hunk: 'bg-primary/10 text-primary',
  meta: 'bg-muted text-muted-foreground',
  ctx: 'text-foreground',
};

export function DiffViewer({ patchId, targetFiles, hypothesis, diff }: DiffViewerProps) {
  const lines: DiffLine[] = parseDiffLines(diff);

  return (
    <div className="min-w-0 space-y-4 text-foreground">
      <div className="min-w-0">
        <p className="break-words text-sm font-medium [overflow-wrap:anywhere]">
          补丁 <code className="font-mono">{patchId}</code>
        </p>
        {targetFiles.length > 0 ? (
          <ul aria-label="补丁目标文件" className="mt-2 min-w-0 space-y-1.5">
            {targetFiles.map((file: string, index: number) => (
              <li key={`${file}-${index}`} className="flex min-w-0 gap-2 text-xs text-muted-foreground">
                <FileCode2 aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <code className="min-w-0 break-all font-mono leading-5">{file}</code>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">未记录目标文件。</p>
        )}
      </div>
      <p className="rounded-lg bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">
        <span className="font-medium text-foreground">改动假设：</span>
        {hypothesis || '未记录'}
      </p>
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground" aria-label="差异图例">
        <span className="font-mono text-success">+ 新增</span>
        <span className="font-mono text-destructive">− 删除</span>
        <span>补丁内容仅供审阅，验收结果见验证记录。</span>
      </div>
      {diff ? (
        <div
          role="region"
          aria-label="补丁差异"
          tabIndex={0}
          className="max-h-96 min-w-0 max-w-full overflow-auto rounded-lg border border-border bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <pre className="m-0 min-w-full w-max py-3 text-xs leading-5">
            <code className="font-mono">
              {lines.map((line: DiffLine, index: number) => (
                <span key={index} className={`px-3 ${LINE_CLASS[line.kind]}`}>
                  {line.text}{index < lines.length - 1 ? '\n' : ''}
                </span>
              ))}
            </code>
          </pre>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
          此补丁没有可显示的差异内容。
        </p>
      )}
    </div>
  );
}
