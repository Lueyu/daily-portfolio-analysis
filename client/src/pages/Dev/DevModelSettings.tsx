import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ModelDraft } from './dev-settings';

export const DevModelSettings: FC<{
  role: 'primary' | 'vision'; value: ModelDraft; disabled: boolean; canTest: boolean;
  onChange: (model: ModelDraft) => void; onTest: () => void;
}> = ({ role, value, disabled, canTest, onChange, onTest }) => {
  const title: string = role === 'primary' ? '编程模型' : '图片理解模型';
  const prefix: string = `agent-${role}`;
  return <fieldset disabled={disabled} className="min-w-0 space-y-4 rounded-xl border border-border p-4">
    <legend className="px-1 text-sm font-medium">{title}</legend>
    <p className="text-xs leading-6 text-muted-foreground">{role === 'primary'
      ? '负责理解任务、决定工具调用、修改代码与验证结果。'
      : '负责观察浏览器截图。需要支持图片输入的对话模型；图像生成模型无法替代图片理解。'}</p>
    <div className="space-y-2"><Label htmlFor={`${prefix}-model`}>模型 ID</Label>
      <Input id={`${prefix}-model`} value={value.model} placeholder="服务商提供的模型 ID"
        onChange={(event) => onChange({ ...value, model: event.target.value })} /></div>
    <div className="space-y-2"><Label htmlFor={`${prefix}-url`}>API Base URL</Label>
      <Input id={`${prefix}-url`} type="url" value={value.baseUrl} placeholder="https://api.example.com/v1"
        onChange={(event) => onChange({ ...value, baseUrl: event.target.value })} /></div>
    <div className="space-y-2"><Label htmlFor={`${prefix}-key`}>API Key · {value.apiKeyConfigured ? '已配置' : '未配置'}</Label>
      <Input id={`${prefix}-key`} type="password" autoComplete="new-password" value={value.apiKey}
        disabled={disabled || value.clearApiKey} placeholder={value.apiKeyConfigured ? '留空保留现有密钥' : '输入服务商 API Key'}
        onChange={(event) => onChange({ ...value, apiKey: event.target.value })} />
      {value.apiKeyConfigured && <Label className="text-xs text-muted-foreground">
        <Checkbox checked={value.clearApiKey} onCheckedChange={(checked) => onChange({ ...value, clearApiKey: checked === true, apiKey: '' })} />清除现有密钥
      </Label>}
    </div>
    <Label className="leading-6"><Checkbox checked={value.supportsImages}
      onCheckedChange={(checked) => onChange({ ...value, supportsImages: checked === true })} />模型支持图片输入</Label>
    <details><summary className="cursor-pointer text-xs text-muted-foreground">上下文与输出限制</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="space-y-2"><Label htmlFor={`${prefix}-context`}>上下文窗口（token）</Label>
          <Input id={`${prefix}-context`} type="number" min={4096} step={1} value={value.contextWindow}
            onChange={(event) => onChange({ ...value, contextWindow: Number(event.target.value) })} /></div>
        <div className="space-y-2"><Label htmlFor={`${prefix}-output`}>最大输出（token）</Label>
          <Input id={`${prefix}-output`} type="number" min={256} max={65536} step={1} value={value.maxOutputTokens}
            onChange={(event) => onChange({ ...value, maxOutputTokens: Number(event.target.value) })} /></div>
      </div>
      <p className="mt-2 text-xs leading-6 text-muted-foreground">请按服务商文档填写。部分推理模型会另外计算推理 token，因此最大输出不一定等于整次请求的总 token 上限。</p>
    </details>
    <Button type="button" size="sm" variant="outline" disabled={!canTest || disabled} onClick={onTest}>测试{title}</Button>
  </fieldset>;
};
