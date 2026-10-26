import type { DevTaskDetail, DevIteration } from './types';
import type { DevAgentRuntimeSnapshot } from '@shared/api.interface';
import { runtimeToolLabel } from './dev-runtime';

type ProgressTask = Pick<DevTaskDetail, 'status' | 'iterations' | 'patchCount' | 'execution' | 'runtime_version'>
  & { canResume?: boolean };

/** Short, deterministic progress text; never invents a model response. */
export function taskProgress(task: ProgressTask, modelActivity?: DevAgentRuntimeSnapshot['modelActivity']): string {
  const generalRuntime: boolean = task.runtime_version === 2;
  if (task.status === 'verified') return generalRuntime
    ? '修改已应用到主工作区，合并结果已在隔离副本中通过验证。'
    : '修改已应用到主工作区，落地检查已通过。';
  if (task.status === 'blocked' && !task.canResume) return '任务已停止，需要处理阻断原因。详细记录已保留在下方。';
  if (task.execution?.state === 'running') {
    if (task.execution.command === 'approve') return generalRuntime
      ? '正在隔离副本中验证合并结果，通过后将应用到你的工作区。'
      : '正在应用你批准的补丁，并运行主工作区检查。';
    if (modelActivity?.status === 'running') return '正在等待模型响应。修改和运行记录已保存，你可以随时停止。';
    if (modelActivity?.status === 'failed') return modelFailureText(modelActivity.error);
    return '正在处理任务。新的进展会显示在这里，你可以随时停止。';
  }
  if (task.status === 'awaiting_approval') return '候选修改已准备好。请审阅改动，确认后再应用到你的工作区。';
  if (task.status === 'blocked') return generalRuntime
    ? '上次执行已暂停，已有源码修改和运行记录已保留。处理阻断原因后可以继续运行。'
    : '上次执行被旧的次数或时间限制中断。现在已取消默认限制，可以继续运行。';
  if (task.execution?.state === 'failed' && task.execution.error?.includes('SetLimitExceeded')) {
    return '模型服务已暂停：已达到供应商设置的使用额度。恢复额度后可以继续，任务记录已保留。';
  }
  if (task.execution?.state === 'failed' && /APITimeoutError|模型请求超时/.test(task.execution.error ?? '')) {
    return modelFailureText('APITimeoutError');
  }
  if (task.execution?.state === 'failed' && modelActivity?.status === 'failed') return modelFailureText(modelActivity.error);
  if (task.execution?.state === 'failed') return '执行遇到了错误。查看错误详情后，可以重新尝试。';
  if (task.execution?.state === 'stopped') return '已停止运行，已有记录已保留。准备好后可以继续。';
  if (task.status === 'new' && task.iterations.length === 0) return '任务已准备好。开始后会查看相关代码、运行检查，再尝试修复。';
  return '当前没有在执行。已有进展已保存，可以继续处理这个任务。';
}

function modelFailureText(error?: string): string {
  if (/APITimeoutError|模型请求超时/.test(error ?? '')) return '模型请求超时，修改和记录已保留，可以继续任务。';
  if (error && !error.includes('Traceback')) return error.slice(0, 240);
  return '模型请求失败，修改和记录已保留，可以继续任务。';
}

const TOOL_SUMMARY: Record<string, string> = {
  read_file: '读取文件', list_dir: '查看目录', glob: '查找文件', grep: '搜索代码',
  probe_env: '检查运行环境', run_check: '运行检查', apply_patch: '准备代码改动',
  finish: '完成本轮处理', blocked: '遇到阻断', reject: '记录拒绝原因',
};

export function toolSummary(iteration: DevIteration): string {
  if (iteration.action === 'model' && iteration.decision && iteration.decision !== '模型返回工具决策') {
    return iteration.decision.slice(0, 180);
  }
  const label: string | undefined = TOOL_SUMMARY[iteration.action] ?? runtimeToolLabel(iteration.action);
  if (!label) {
    if (iteration.phase === 'block') return '任务停止';
    if (iteration.phase === 'resume') return '恢复任务';
    if (iteration.phase === 'landing') return '应用并检查改动';
    return '执行操作';
  }
  const first: string = iteration.observations[0]?.split('\n')[0] ?? '';
  const target: string = first.replace(/: (?:ok|failed)$/, '');
  return target && ['read_file', 'list_dir', 'glob', 'grep'].includes(iteration.action)
    ? label + ' · ' + target.slice(0, 95) + (target.length > 95 ? '…' : '') : label;
}
