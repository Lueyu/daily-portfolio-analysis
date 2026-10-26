/** Historical patch selection with an isolated request for each version. */
import { useCallback, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { getDevPatch } from '@/api';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DiffViewer } from './DiffViewer';
import { useDevResource } from './useDevResource';
import type { DevPatchDetail } from './types';

interface DevPatchPanelProps {
  taskId: string;
  patchCount: number;
  latestPatchId?: string;
}

interface PatchSelection {
  taskId: string;
  latestPatchId: string;
  patchCount: number;
  patchId: string;
}

interface PatchVersionProps {
  taskId: string;
  patchId: string;
}

export function DevPatchPanel({ taskId, patchCount, latestPatchId }: DevPatchPanelProps) {
  const latest: string = latestPatchId ?? String(patchCount).padStart(4, '0');
  const [selection, setSelection] = useState<PatchSelection | null>(null);
  const selected: string = selection?.taskId === taskId
    && selection.latestPatchId === latest && selection.patchCount === patchCount
    ? selection.patchId : latest;
  const patchIds: string[] = Array.from({ length: patchCount }, (_value: unknown, index: number) => (
    String(index + 1).padStart(4, '0')
  ));

  if (patchCount === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-6">
        <p className="text-sm font-medium text-foreground">还没有候选补丁</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">任务保存候选补丁后，可在这里查看差异和历史版本。</p>
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <span className="text-sm text-muted-foreground">查看补丁</span>
        <Select
          value={selected}
          onValueChange={(patchId: string) => setSelection({ taskId, latestPatchId: latest, patchCount, patchId })}
        >
          <SelectTrigger aria-label="选择补丁" className="w-32 font-mono">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {patchIds.map((patchId: string) => <SelectItem key={patchId} value={patchId}>{patchId}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <p className="break-words rounded-md bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
        {selected === latest
          ? `当前查看最新版本 ${latest}。`
          : `当前查看历史版本 ${selected}。审批仍针对最新版本 ${latest}。`}
      </p>
      <PatchVersion key={`${taskId}:${selected}`} taskId={taskId} patchId={selected} />
    </div>
  );
}

function PatchVersion({ taskId, patchId }: PatchVersionProps) {
  const request = useCallback((): Promise<DevPatchDetail> => getDevPatch(taskId, patchId), [taskId, patchId]);
  const { data, error, loading, refresh } = useDevResource(request);

  if (loading) {
    return (
      <p role="status" className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
        加载补丁中…
      </p>
    );
  }
  if (error) {
    return (
      <div className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
        <p role="alert" className="break-words text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={refresh}>重试加载补丁</Button>
      </div>
    );
  }
  if (!data) return null;
  return <DiffViewer patchId={data.patchId} targetFiles={data.targetFiles} hypothesis={data.hypothesis} diff={data.diff} />;
}
