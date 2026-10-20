/**
 * @file NewDevTaskModal.tsx
 * @description Form for creating a Coding-Agent task.
 *
 * Captures the problem and at least one measurable acceptance criterion. Each
 * criterion is a check kind, a description of what "done" means, and an
 * optional target (a test file for unit/e2e, blank for typecheck/lint).
 */
import { useState } from 'react';
import { Plus, Trash2, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { createDevTask } from '@/api';
import { CHECK_LABEL } from './dev-ui';
import type { CheckKind, CreateDevTaskPayload, DevTaskDetail } from './types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (task: DevTaskDetail) => void;
}

interface Row {
  check: CheckKind;
  description: string;
  target: string;
}

const CHECK_KINDS: CheckKind[] = ['unit', 'e2e', 'typecheck', 'lint'];

const EMPTY_ROW: Row = { check: 'unit', description: '', target: '' };

export function NewDevTaskModal({ open, onOpenChange, onCreated }: Props) {
  const [title, setTitle] = useState('');
  const [problem, setProblem] = useState('');
  const [rows, setRows] = useState<Row[]>([{ ...EMPTY_ROW }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setTitle('');
    setProblem('');
    setRows([{ ...EMPTY_ROW }]);
    setError(null);
  };

  const updateRow = (i: number, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };

  const addRow = () => setRows((prev) => [...prev, { ...EMPTY_ROW }]);

  const removeRow = (i: number) => setRows((prev) => prev.filter((_, idx) => idx !== i));

  const validRows = rows.filter((r) => r.description.trim().length > 0);
  const canSubmit = title.trim().length > 0 && problem.trim().length > 0 && validRows.length > 0;

  const submit = async () => {
    if (!canSubmit) {
      setError('请填写标题、问题，并至少给出一条验收标准。');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const payload: CreateDevTaskPayload = {
        title: title.trim(),
        problem: problem.trim(),
        acceptance: validRows.map((r, i) => ({
          id: `ac${i + 1}`,
          check: r.check,
          description: r.description.trim(),
          target: r.target.trim() ? r.target.trim() : null,
        })),
        workdir: null,
      };
      const task = await createDevTask(payload);
      reset();
      onOpenChange(false);
      onCreated(task);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>新建开发任务</DialogTitle>
          <DialogDescription>
            描述一个要修复的问题，并给出可自动验证的验收标准。Agent 会先复现、再修复，改完后请你人工审批。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="dev-title">标题</Label>
            <Input
              id="dev-title"
              placeholder="例如：评级与操作建议不一致"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dev-problem">问题描述</Label>
            <Textarea
              id="dev-problem"
              rows={4}
              placeholder="说明现象、触发条件、期望结果，以及你已经看到的报错或日志。"
              value={problem}
              onChange={(e) => setProblem(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>验收标准（至少一条）</Label>
              <Button type="button" variant="ghost" size="sm" onClick={addRow}>
                <Plus className="mr-1 h-4 w-4" />
                添加
              </Button>
            </div>
            {rows.map((row, i) => (
              <div key={i} className="space-y-2 rounded-md border border-slate-200 p-3">
                <div className="flex items-center gap-2">
                  <Select
                    value={row.check}
                    onValueChange={(v) => updateRow(i, { check: v as CheckKind })}
                  >
                    <SelectTrigger className="w-32" aria-label="检查类型">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CHECK_KINDS.map((k) => (
                        <SelectItem key={k} value={k}>
                          {CHECK_LABEL[k]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {rows.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeRow(i)}
                      aria-label="删除该验收标准"
                    >
                      <Trash2 className="h-4 w-4 text-rose-500" />
                    </Button>
                  )}
                </div>
                <Input
                  placeholder="怎样算通过？例如：评级为 Hold 时，操作建议不能是买入"
                  value={row.description}
                  onChange={(e) => updateRow(i, { description: e.target.value })}
                />
                {(row.check === 'unit' || row.check === 'e2e') && (
                  <Input
                    placeholder={
                      row.check === 'e2e'
                        ? '可选：验证目标，例如页面 URL /tests/xxx 或 e2e 测试文件'
                        : '可选：相关测试文件路径，例如 server/modules/xx/xx.spec.ts'
                    }
                    value={row.target}
                    onChange={(e) => updateRow(i, { target: e.target.value })}
                  />
                )}
              </div>
            ))}
          </div>

          {error && <p className="text-sm text-rose-600">{error}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="button" onClick={submit} disabled={submitting || !canSubmit}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            创建任务
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
