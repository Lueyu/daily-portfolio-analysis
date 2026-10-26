import type { FC } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { McpDraft, HeaderDraft } from './dev-settings';

export const DevMcpSettings: FC<{
  servers: McpDraft[]; disabled: boolean; canTest: boolean;
  onChange: (servers: McpDraft[]) => void; onTest: (name: string) => void;
}> = ({ servers, disabled, canTest, onChange, onTest }) => {
  const update = (index: number, value: McpDraft): void => onChange(servers.map((server: McpDraft, position: number) => position === index ? value : server));
  return <div className="min-w-0 space-y-4">
    <p className="text-sm leading-7 text-muted-foreground">通过 Streamable HTTP 接入工具服务。测试连接会读取工具清单；只有明确允许的工具才会提供给 Agent。</p>
    {!servers.length && <p className="rounded-lg bg-muted/40 p-4 text-sm">还没有配置 MCP 服务。</p>}
    {servers.map((server: McpDraft, index: number) => <fieldset key={index} disabled={disabled}
      className="min-w-0 space-y-4 rounded-xl border border-border p-4">
      <div className="flex items-center justify-between gap-3"><h3 className="truncate text-sm font-medium">{server.name || '新 MCP 服务'}</h3>
        <Button type="button" size="icon" variant="ghost" aria-label={`移除 MCP 服务 ${server.name || index + 1}`}
          onClick={() => onChange(servers.filter((_server: McpDraft, position: number) => position !== index))}><Trash2 className="h-4 w-4" /></Button></div>
      <div className="space-y-2"><Label htmlFor={`mcp-${index}-name`}>服务名称</Label>
        <Input id={`mcp-${index}-name`} required pattern="[A-Za-z0-9_-]{1,64}" value={server.name}
          onChange={(event) => update(index, { ...server, name: event.target.value })} /></div>
      <div className="space-y-2"><Label htmlFor={`mcp-${index}-url`}>HTTP 地址</Label>
        <Input id={`mcp-${index}-url`} required type="url" value={server.url} placeholder="https://mcp.example.com/mcp"
          onChange={(event) => update(index, { ...server, url: event.target.value })} /></div>
      <details className="space-y-3"><summary className="cursor-pointer text-sm">认证请求头（{server.headers.length}）</summary>
        <p className="text-xs leading-6 text-muted-foreground">值留空会保留原配置。Authorization 的值需要包含服务要求的 Bearer 前缀。</p>
        {server.headers.map((header: HeaderDraft, row: number) => {
          const setHeader = (value: HeaderDraft): void => update(index, { ...server,
            headers: server.headers.map((item: HeaderDraft, position: number) => position === row ? value : item) });
          return <div key={row} className="space-y-2 border-l border-border pl-3">
            <Input aria-label={`${server.name} 请求头 ${row + 1}`} value={header.header} placeholder="Authorization"
              onChange={(event) => setHeader({ ...header, header: event.target.value })} />
            <Input aria-label={`${server.name} 环境变量 ${row + 1}`} value={header.variable} placeholder="MY_MCP_AUTH"
              onChange={(event) => setHeader({ ...header, variable: event.target.value })} />
            <Input aria-label={`${server.name} 认证值 ${row + 1}`} type="password" autoComplete="new-password"
              value={header.value} placeholder={header.configured ? '已配置，留空保留' : '尚未配置，输入完整认证值'}
              onChange={(event) => setHeader({ ...header, value: event.target.value })} />
            <Button type="button" variant="ghost" size="sm" onClick={() => update(index, { ...server,
              headers: server.headers.filter((_item: HeaderDraft, position: number) => position !== row) })}>移除请求头</Button>
          </div>;
        })}
        <Button type="button" size="sm" variant="outline" onClick={() => update(index, { ...server,
          headers: [...server.headers, { header: '', variable: '', value: '', configured: false }] })}>添加请求头</Button>
      </details>
      <div className="space-y-2"><Label htmlFor={`mcp-${index}-allowed`}>允许调用的工具（逗号或换行分隔）</Label>
        <Textarea id={`mcp-${index}-allowed`} rows={2} disabled={disabled || server.allowedTools === null}
          value={server.allowedToolsText ?? server.allowedTools?.join(', ') ?? ''} placeholder="先保存并测试连接，查看可用工具名称"
          onChange={(event) => update(index, { ...server, allowedToolsText: event.target.value })} />
        <Label className="text-xs leading-6 text-muted-foreground"><Checkbox checked={server.allowedTools === null}
          onCheckedChange={(checked) => update(index, { ...server, allowedTools: checked === true ? null : [] })} />允许服务暴露的全部工具</Label>
      </div>
      <div className="space-y-2"><Label htmlFor={`mcp-${index}-readonly`}>无需审批的只读工具</Label>
        <Textarea id={`mcp-${index}-readonly`} rows={2} value={server.readOnlyToolsText ?? server.readOnlyTools.join(', ')} placeholder="例如 search_docs；留空表示每次调用都需要审批"
          onChange={(event) => update(index, { ...server, readOnlyToolsText: event.target.value })} />
        <p className="text-xs leading-6 text-muted-foreground">只填写你已确认不会修改外部数据的工具，其他工具逐次请求批准。</p>
      </div>
      <details><summary className="cursor-pointer text-xs text-muted-foreground">超时与结果大小</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="space-y-2"><Label htmlFor={`mcp-${index}-timeout`}>超时（秒）</Label>
            <Input id={`mcp-${index}-timeout`} type="number" min={1} max={120} value={server.timeoutSeconds}
              onChange={(event) => update(index, { ...server, timeoutSeconds: Number(event.target.value) })} /></div>
          <div className="space-y-2"><Label htmlFor={`mcp-${index}-limit`}>结果字符上限</Label>
            <Input id={`mcp-${index}-limit`} type="number" min={1000} max={100000} value={server.maxResultChars}
              onChange={(event) => update(index, { ...server, maxResultChars: Number(event.target.value) })} /></div>
        </div>
      </details>
      <Button type="button" size="sm" variant="outline" disabled={!canTest || disabled} onClick={() => onTest(server.name)}>测试连接 · {server.name || '新服务'}</Button>
    </fieldset>)}
    <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onChange([...servers, {
      name: '', url: '', headers: [], allowedTools: [], readOnlyTools: [], timeoutSeconds: 30, maxResultChars: 24000,
    }])}><Plus className="h-4 w-4" />添加 MCP 服务</Button>
  </div>;
};
