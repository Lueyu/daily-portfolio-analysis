/**
 * @file DevTasksPage.tsx
 * @description Local Coding-Agent console page.
 *
 * Shows the feature health state, the task list (polled while the list is
 * visible) and the "new task" form. Selecting a task swaps in the detail view;
 * the list is unmounted while a detail is open so only one view polls.
 */
import { useEffect, useState } from 'react';
import { Plus, Wrench, Loader2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { getDevHealth, listDevTasks } from '@/api';
import { DevTaskCard } from './DevTaskCard';
import { NewDevTaskModal } from './NewDevTaskModal';
import { DevTaskDetail } from './DevTaskDetail';
import { LIST_POLL_MS } from './dev-ui';
import type { DevHealth, DevTaskDetail as DevTask, DevTaskSummary } from './types';

export default function DevTasksPage() {
  const [health, setHealth] = useState<DevHealth | null>(null);
  const [tasks, setTasks] = useState<DevTaskSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Health is read once: it only reflects local config, not task state.
  useEffect(() => {
    getDevHealth()
      .then(setHealth)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  // Poll the list only while it is on screen.
  useEffect(() => {
    if (selectedId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const list = await listDevTasks();
        if (!cancelled) {
          setTasks(list);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    const timer = window.setInterval(load, LIST_POLL_MS);
    return () => window.clearInterval(timer);
  }, [selectedId]);

  if (selectedId) {
    return <DevTaskDetail taskId={selectedId} onBack={() => setSelectedId(null)} />;
  }

  const disabled = health && !health.enabled;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
            <Wrench className="h-5 w-5 text-slate-500" />
            开发控制台
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            本地 Agent 自动复现、修复并等待你审批补丁。仅在本地开发环境可用。
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)} disabled={!!disabled}>
          <Plus className="mr-1 h-4 w-4" />
          新建开发任务
        </Button>
      </div>

      {disabled && (
        <Alert variant="default">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>开发控制台未启用</AlertTitle>
          <AlertDescription>
            该功能只在本地开发环境运行（云端不启动）。请在本地
            <code className="mx-1 rounded bg-slate-100 px-1 py-0.5 font-mono text-xs">.env.local</code>
            中设置
            <code className="mx-1 rounded bg-slate-100 px-1 py-0.5 font-mono text-xs">
              AGENT_DEV_ENABLED=true
            </code>
            后重启本地服务。
          </AlertDescription>
        </Alert>
      )}

      {health && health.enabled && (!health.binExists || !health.tasksDirExists) && (
        <Alert variant="default">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          <AlertTitle>本地 Agent 未就绪</AlertTitle>
          <AlertDescription>
            {!health.binExists && (
              <span>
                未找到 Agent 可执行文件：<code className="font-mono text-xs">{health.binPath}</code>
                。请先完成 Python Agent 环境初始化。
              </span>
            )}
          </AlertDescription>
        </Alert>
      )}

      {error && <p className="text-sm text-rose-600">加载失败：{error}</p>}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          加载任务列表…
        </div>
      ) : tasks.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-sm text-slate-500">还没有开发任务。描述一个要修复的问题，开始第一轮自动修复。</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {tasks.map((t) => (
            <DevTaskCard key={t.id} task={t} onClick={() => setSelectedId(t.id)} />
          ))}
        </div>
      )}

      <NewDevTaskModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(task: DevTask) => {
          setTasks((prev) =>
            [
              {
                id: task.id,
                title: task.title,
                status: task.status,
                redSeen: task.red_seen,
                iterationCount: task.iterations.length,
                updatedAt: task.updated_at,
              },
              ...prev,
            ].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
          );
          setSelectedId(task.id);
        }}
      />
    </div>
  );
}
