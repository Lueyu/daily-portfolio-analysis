/** Read-only acceptance signals from the task's saved artifacts. */
import { useId } from 'react';
import { candidatePatchLabel, redEvidenceLabel, verifyStateLabel } from './dev-ui';
import type { DevTaskDetail } from './types';

interface GateStatusSummaryProps {
  task: DevTaskDetail;
}

export function GateStatusSummary({ task }: GateStatusSummaryProps) {
  const headingId: string = useId();
  const generalRuntime: boolean = task.runtime_version === 2;

  return (
    <section
      aria-labelledby={headingId}
      className="min-w-0 rounded-xl border border-border bg-card p-4 text-foreground sm:p-5"
    >
      <h3 id={headingId} className="text-sm font-semibold">验收门状态</h3>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        以下状态来自已保存的任务工件；验证结果仅按记录显示。
      </p>
      <dl className={`mt-4 grid min-w-0 gap-4 ${generalRuntime ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`} data-ai-section-type="card-stat">
        {!generalRuntime && <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">失败复现证据</dt>
          <dd className="mt-1.5 break-words text-sm font-medium">{redEvidenceLabel(task.red_seen)}</dd>
        </div>}
        <div className={`min-w-0 ${generalRuntime ? '' : 'sm:border-l sm:border-border sm:pl-4'}`}>
          <dt className="text-xs text-muted-foreground">{generalRuntime ? '候选修改' : '候选补丁'}</dt>
          <dd className="mt-1.5 break-words text-sm font-medium">
            {candidatePatchLabel(task.sandbox_dirty, task.verify_state, task.status)}
          </dd>
        </div>
        <div className="min-w-0 sm:border-l sm:border-border sm:pl-4">
          <dt className="text-xs text-muted-foreground">{generalRuntime ? '目标与回归验证' : '验证记录'}</dt>
          <dd className="mt-1.5 break-words text-sm font-medium">{verifyStateLabel(task.verify_state)}</dd>
        </div>
      </dl>
      <p className="mt-4 border-t border-border pt-3 text-xs leading-5 text-muted-foreground">
        {generalRuntime
          ? '当前源码版本的目标与回归验证通过后，才能提交审批；每次源码修改后需重新验证。'
          : '候选状态表示是否记录了候选补丁，不代表磁盘工作区是否有未提交修改。'}
        {task.status === 'verified' && (generalRuntime
          ? ' 合并结果已在隔离副本中通过验证，并应用到主工作区。'
          : ' 任务已完成主工作区验证。')}
        {task.status === 'blocked' && ' 任务已停止，历史证据和补丁仍保留供查看。'}
      </p>
    </section>
  );
}
