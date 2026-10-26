import { useEffect, useRef, useState, type FC, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getDevSettings, saveDevSettings, testDevSettings } from '@/api';
import type { DevAgentSettingsTestInput, DevAgentSettingsTestResult } from '@shared/api.interface';
import { DevCapabilityPanel } from './DevCapabilityPanel';
import { DevModelSettings } from './DevModelSettings';
import { DevMcpSettings } from './DevMcpSettings';
import { createSettingsDraft, buildSettingsUpdate, type SettingsDraft, type ModelDraft, type McpDraft } from './dev-settings';
import { getErrorMessage } from './dev-ui';
import { useDevResource } from './useDevResource';

interface Props { open: boolean; onOpenChange: (open: boolean) => void; ready: boolean }
type SettingsTab = 'models' | 'mcp' | 'capabilities';

export const DevSettingsDialog: FC<Props> = ({ open, onOpenChange, ready }) => <Dialog open={open} onOpenChange={onOpenChange}>
  <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto border-border bg-background text-foreground">
    <DialogHeader><DialogTitle>Agent 设置</DialogTitle>
      <DialogDescription>管理模型、MCP 和运行能力。保存后在下一次开始或继续运行时生效。</DialogDescription>
    </DialogHeader>
    {open && <SettingsEditor ready={ready} />}
  </DialogContent>
</Dialog>;

const SettingsEditor: FC<{ ready: boolean }> = ({ ready }) => {
  const resource = useDevResource(getDevSettings, 0, ready);
  const [tab, setTab] = useState<SettingsTab>('models');
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [dirty, setDirty] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<DevAgentSettingsTestResult | null>(null);
  const inFlight = useRef<boolean>(false);
  useEffect(() => { if (resource.data) setDraft(createSettingsDraft(resource.data)); }, [resource.data]);
  const change = (next: SettingsDraft): void => { setDraft(next); setDirty(true); setNotice(null); setError(null); setTestResult(null); };
  const save = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!draft || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null); setTestResult(null); setNotice(null);
    try {
      const saved = await saveDevSettings(buildSettingsUpdate(draft));
      setDraft(createSettingsDraft(saved)); setDirty(false);
      setNotice('设置已保存。新的执行会使用这些配置；正在运行的任务继续使用原配置。');
    } catch (cause: unknown) { setError(getErrorMessage(cause)); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const test = async (input: DevAgentSettingsTestInput): Promise<void> => {
    if (dirty || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null); setTestResult(null); setNotice(null);
    try { setTestResult(await testDevSettings(input)); }
    catch (cause: unknown) { setError(getErrorMessage(cause)); }
    finally { inFlight.current = false; setBusy(false); }
  };
  return <div className="min-w-0 space-y-4">
    <div role="tablist" aria-label="设置分类" className="flex flex-wrap gap-2 border-b border-border pb-3">
      {([['models', '模型'], ['mcp', 'MCP 服务'], ['capabilities', '运行能力']] as const).map(([key, label]) => <Button
        key={key} type="button" role="tab" aria-selected={tab === key} size="sm" variant={tab === key ? 'secondary' : 'ghost'}
        onClick={() => { setTab(key); setTestResult(null); }}>{label}</Button>)}
    </div>
    {!ready && <p role="alert" className="text-sm text-destructive">本地执行器尚未就绪，请先检查启动配置。</p>}
    {resource.loading && !draft && <p role="status" className="text-sm text-muted-foreground">正在读取设置…</p>}
    {resource.error && <div role="alert" className="space-y-2 text-sm text-destructive"><p>{resource.error}</p>
      <Button size="sm" variant="outline" onClick={resource.refresh}>重试读取设置</Button></div>}
    {tab === 'capabilities' ? <DevCapabilityPanel ready={ready} /> : draft && <form onSubmit={(event) => void save(event)} className="min-w-0 space-y-5">
      {tab === 'models' && <div className="space-y-5">{(['primary', 'vision'] as const).map((role) => <DevModelSettings
        key={role} role={role} value={draft.models[role]} disabled={busy} canTest={!dirty}
        onChange={(value: ModelDraft) => change({ ...draft, models: { ...draft.models, [role]: value } })}
        onTest={() => void test({ target: role })} />)}</div>}
      {tab === 'mcp' && <DevMcpSettings servers={draft.servers} disabled={busy} canTest={!dirty}
        onChange={(servers: McpDraft[]) => change({ ...draft, servers })}
        onTest={(server: string) => void test({ target: 'mcp', server })} />}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-background py-3">
        <p className="text-xs leading-6 text-muted-foreground">{dirty ? '有未保存的修改。保存后可测试连接。' : '密钥只保存在本机，读取设置时不会回传。'}</p>
        <Button type="submit" disabled={busy || !dirty}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}保存设置</Button>
      </div>
    </form>}
    {busy && <p role="status" className="text-sm text-muted-foreground">正在处理…</p>}
    {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="text-sm leading-7">{notice}</p>}
    {testResult && <div role={testResult.ok ? 'status' : 'alert'} className="space-y-3 rounded-lg bg-muted/40 p-4 text-sm">
      <p className={testResult.ok ? 'leading-7' : 'leading-7 text-destructive'}>{testResult.message}</p>
      {!!testResult.tools?.length && <details open><summary className="cursor-pointer text-sm">可用工具（{testResult.tools.length}）</summary>
        <ul className="mt-3 max-h-64 space-y-3 overflow-auto">{testResult.tools.map((tool) => <li key={tool.name}>
          <code className="break-all text-xs">{tool.name}</code><p className="mt-1 text-xs leading-6 text-muted-foreground">{tool.description}</p>
        </li>)}</ul>
      </details>}
    </div>}
    {resource.data && <details><summary className="cursor-pointer text-xs text-muted-foreground">配置保存位置</summary>
      <p className="mt-2 break-all text-xs leading-6 text-muted-foreground">{resource.data.settingsPath}</p>
      <p className="break-all text-xs leading-6 text-muted-foreground">{resource.data.mcp.configPath}</p>
    </details>}
  </div>;
};
