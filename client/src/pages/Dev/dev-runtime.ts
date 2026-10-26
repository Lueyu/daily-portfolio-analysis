import type { DevAgentChange, DevAgentRuntimeSnapshot, DevAgentToolEvent } from '@shared/api.interface';

export interface RuntimeActionState {
  ready: boolean;
  running: boolean;
  loading: boolean;
  busy: boolean;
  error: string | null;
  snapshot: DevAgentRuntimeSnapshot | null;
  expectedRevision?: string;
}

export function mergeRuntimeEvents(
  previous: DevAgentToolEvent[], incoming: DevAgentToolEvent[], limit = 200,
): DevAgentToolEvent[] {
  const records: Map<number, DevAgentToolEvent> = new Map();
  for (const event of [...previous, ...incoming]) records.set(event.index, event);
  return [...records.values()]
    .sort((left: DevAgentToolEvent, right: DevAgentToolEvent) => left.index - right.index)
    .slice(-limit);
}

const ACTION_LABELS: Record<string, string> = {
  terminalstart: '运行终端命令', terminalpoll: '读取终端输出', terminalwrite: '发送终端输入',
  terminalcancel: '停止终端命令', servicestart: '启动预览服务', servicestop: '停止预览服务', servicepoll: '查看预览日志',
  browser: '浏览器操作', verify: '运行验证', writefile: '写入文件', editfile: '编辑文件',
  applypatch: '应用补丁', undochange: '撤销修改',
  restorecheckpoint: '恢复版本', changes: '检查修改记录', model: '规划下一步',
  readfile: '读取文件', listfiles: '查看文件列表', listdir: '查看目录', glob: '查找文件', grep: '搜索代码', searchcode: '搜索代码',
  finish: '完成任务验证', blocked: '任务已暂停', paused: '任务已停止', recover: '恢复中断记录',
  mcp: '调用 MCP 工具', mcpcall: '调用 MCP 工具', mcptools: '查看 MCP 工具',
  inspectimage: '观察页面截图', updateplan: '更新计划', spawnworker: '启动并行任务',
  waitworkers: '等待并行任务', mergeworker: '合并并行改动',
  inspectlocalapp: '观察本机主项目 · 仅诊断，不算候选验收', capabilities: '检查可用能力', skillslist: '查看技能列表', skillread: '阅读技能',
  remember: '保存任务笔记', agentspawn: '启动并行任务', agentlist: '查看并行任务', agentpoll: '查看并行进展',
  agentcancel: '停止并行任务', agentdiff: '审阅并行改动', agentmerge: '合并并行改动',
  approvalrequested: '等待操作审批', approvalresolved: '审批已处理',
};
const RESULT_LABELS: Record<string, string> = {
  running: '运行中', completed: '已完成', failed: '失败', timed_out: '已超时',
  cancelled: '已停止', recovered: '中断后恢复', failed_rolled_back: '失败并已回滚',
};

export function runtimeToolLabel(action: string): string | undefined {
  return ACTION_LABELS[action.toLowerCase().replace(/_/g, '')];
}

function inputRecord(event: DevAgentToolEvent): Record<string, unknown> {
  const inputs: unknown = event.payload.inputs;
  return inputs && typeof inputs === 'object' && !Array.isArray(inputs)
    ? inputs as Record<string, unknown> : {};
}

/** Only the assistant's public message is a conversation entry. */
export function runtimeCommentary(event: DevAgentToolEvent): string | null {
  if (!['model', 'commentary'].includes(event.action.toLowerCase())) return null;
  const content: string = (typeof event.payload.content === 'string' ? event.payload.content : event.summary).trim();
  if (!content || content === '模型返回工具决策') return null;
  // The legacy JSON-action protocol is a tool request, not a user-facing message.
  if (/^\s*(?:```(?:json)?\s*)?\{/.test(content)) return null;
  return content;
}

export function visibleRuntimeEvent(event: DevAgentToolEvent): boolean {
  const action: string = event.action.toLowerCase().replace(/_/g, '');
  if (action === 'usermessage') return false;
  if (action === 'model' || action === 'commentary') return runtimeCommentary(event) !== null;
  if (['terminalpoll', 'servicepoll'].includes(action)) {
    const output: unknown = event.payload.output ?? event.payload.stdout;
    const error: unknown = event.payload.error;
    return Boolean((typeof output === 'string' && output.trim()) || error
      || (event.payload.status && event.payload.status !== 'running')
      || event.payload.exit_code !== undefined || event.summary.startsWith('工具失败'));
  }
  return true;
}

export function runtimeEventSummary(event: DevAgentToolEvent): string {
  const commentary: string | null = runtimeCommentary(event);
  if (commentary) return commentary.slice(0, 180);
  const inputs: Record<string, unknown> = inputRecord(event);
  const action: string = event.action.toLowerCase().replace(/_/g, '');
  const browserLabels: Record<string, string> = {
    navigate: '打开网页', snapshot: '查看页面结构', screenshot: '保存页面截图',
    click: '点击页面元素', fill: '填写页面', errors: '检查浏览器错误', styles: '检查页面样式',
    press: '发送按键', select: '选择选项', scroll: '滚动页面', close: '关闭网页',
  };
  const label: string = action === 'browser' && typeof inputs.action === 'string'
    ? browserLabels[inputs.action] ?? '浏览器操作' : runtimeToolLabel(event.action) ?? '执行操作';
  const status: unknown = event.payload.status;
  const parts: string[] = [label];
  const isSearch: boolean = ['grep', 'glob', 'searchcode'].includes(action);
  const target: unknown = (isSearch ? inputs.pattern : undefined) ?? inputs.command ?? inputs.url ?? inputs.path ?? inputs.pattern
    ?? (typeof inputs.server === 'string' ? [inputs.server, inputs.tool].filter(Boolean).join(' / ') : undefined);
  if (typeof target === 'string' && target.trim()) parts.push(target.slice(0, 180));
  if (isSearch && typeof inputs.path === 'string' && inputs.path !== target) parts.push(inputs.path.slice(0, 120));
  if (event.summary.startsWith('工具失败') || event.payload.error || event.payload.ok === false) parts.push('操作失败');
  if (typeof status === 'string' && RESULT_LABELS[status]) parts.push(RESULT_LABELS[status]);
  if (typeof event.payload.exit_code === 'number') parts.push(`退出码 ${event.payload.exit_code}`);
  if (runtimeScreenshotId(event)) parts.push('截图已保存');
  return parts.join(' · ');
}

export function runtimeEventReason(event: DevAgentToolEvent): string | null {
  const reason: unknown = inputRecord(event).reason;
  return typeof reason === 'string' && reason.trim() ? reason : null;
}

export function runtimeScreenshotId(event: DevAgentToolEvent): string | null {
  const artifact: unknown = event.payload.artifact_id;
  return typeof artifact === 'string' && /^[a-f0-9]{32}$/.test(artifact) ? artifact : null;
}

export function sourceChanges(changes: DevAgentChange[]): DevAgentChange[] {
  return changes.filter((change: DevAgentChange) => change.files.length > 0 && change.before !== change.after);
}

export function runtimeActionBlock(state: RuntimeActionState): string | null {
  if (state.running) return '任务正在运行，停止后才能撤销修改。';
  if (state.busy) return '正在处理修改，请稍候。';
  if (state.loading) return '正在更新运行记录，请稍候。';
  if (!state.ready || state.error) return '请先刷新记录，确认当前状态后再操作。';
  if (!state.snapshot?.revision) return '暂无可操作的源码版本。';
  if (state.snapshot.pending) return '仍有命令尚未结束，请等待或先停止运行。';
  if (state.expectedRevision && state.expectedRevision !== state.snapshot.revision) {
    return '版本已更新，请关闭弹窗并重新选择修改。';
  }
  return null;
}
