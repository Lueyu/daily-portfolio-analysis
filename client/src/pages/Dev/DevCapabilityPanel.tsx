/** Effective configuration, loaded only when the user opens the details. */
import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { getDevCapabilities } from '@/api';
import { Button } from '@/components/ui/button';
import { useDevResource } from './useDevResource';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

export function DevCapabilityPanel({ ready }: { ready: boolean }) {
  const [open, setOpen] = useState(false);
  const resource = useDevResource(getDevCapabilities, 0, ready && open);
  const data = resource.data ?? {};
  const models = record(data.models);
  const primary = record(models.primary);
  const vision = record(models.vision);
  const network = record(data.network);
  const integrations = record(data.integrations);
  const servers = Array.isArray(integrations.mcpServers) ? integrations.mcpServers : [];
  const hosts = Array.isArray(network.allowed_hosts) ? network.allowed_hosts : [];
  return <details className="group/capabilities mx-auto w-full max-w-3xl text-sm"
    onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="flex cursor-pointer list-none items-center gap-2 py-3 text-muted-foreground">
      <ChevronRight className="h-4 w-4 transition-transform group-open/capabilities:rotate-90" />模型与可用能力
    </summary>
    {resource.loading && !resource.data && <p role="status" className="py-3">正在读取配置…</p>}
    {resource.error && <div role="alert" className="space-y-2 py-3 text-destructive">
      <p>{resource.error}</p><Button size="sm" variant="outline" onClick={resource.refresh}>重新读取配置</Button>
    </div>}
    {resource.data && <div className="space-y-3 rounded-xl bg-muted/40 p-4 text-sm leading-6">
      <p>编程模型：<span className="break-all font-medium">{String(primary.model ?? '未配置')}</span>
        {' · '}{primary.configured ? '已配置凭证' : '缺少凭证'}</p>
      <p>图片理解：{vision.configured && vision.supportsImages ? String(vision.model ?? '已配置') : '未配置可用视觉模型'}
        {!vision.configured && '，仍可使用页面结构、样式和浏览器错误取证。'}</p>
      <p>网络：{network.mode === 'allowlist' ? `允许 ${hosts.length} 个域名规则，终端与浏览器共用出口策略` : '离线'}</p>
      <p>并行任务：最多 {String(data.maxWorkers ?? 0)} 个独立源码副本；合并经过冲突检查，保留修改历史。</p>
      <p>MCP：{servers.length ? servers.map(String).join('、') : '未配置服务器'}
        {' · '}项目技能：{String(integrations.skillCount ?? 0)} 个</p>
      {integrations.mcpError && <p role="alert" className="break-words text-destructive">{String(integrations.mcpError)}</p>}
      <p className="text-xs text-muted-foreground">这里显示实际配置；模型效果和外部服务连通性以任务执行结果为准。</p>
      <Button variant="ghost" size="sm" onClick={resource.refresh}>刷新能力状态</Button>
    </div>}
  </details>;
}
