/** Conversation-first local Coding Agent. */
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronRight, Plus, Search, Settings2, TerminalSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getDevHealth, listDevTasks } from '@/api';
import { DevTaskCard } from './DevTaskCard';
import { DevTaskComposer } from './DevTaskComposer';
import { DevTaskDetail } from './DevTaskDetail';
import { DevSettingsDialog } from './DevSettingsDialog';
import { LIST_POLL_MS, matchesTask, STATUS_LABEL } from './dev-ui';
import { STATUS_ORDER } from './types';
import { useDevResource } from './useDevResource';

const filterItemClass = 'focus:bg-muted focus:text-foreground data-[highlighted]:bg-muted data-[highlighted]:text-foreground data-[state=checked]:text-foreground data-[state=checked]:[&_svg:not([class*="text-"])]:text-foreground';

export default function DevTasksPage() {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('task');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [kickoffError, setKickoffError] = useState<{ id: string; message: string } | null>(null);
  const health = useDevResource(getDevHealth);
  const list = useDevResource(listDevTasks, LIST_POLL_MS, health.data?.enabled === true);
  const ready = !!health.data?.enabled && health.data.binExists && !health.error;
  const tasks = list.data ?? [];
  const visibleTasks = tasks.filter((task) => matchesTask(task, search, filter));
  const selectTask = (id: string | null) => {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (id) next.set('task', id); else next.delete('task');
      return next;
    });
  };

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1440px] text-foreground">
      <header className="mb-6 flex items-center justify-between gap-3 border-b border-border pb-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <TerminalSquare aria-hidden="true" className="h-5 w-5 shrink-0" />
          <h1 className="text-lg font-semibold tracking-tight">Coding Agent</h1>
          <span className="hidden text-xs text-muted-foreground sm:inline">本地工作区</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="icon" variant="ghost" aria-label="打开 Agent 设置" onClick={() => setSettingsOpen(true)}><Settings2 className="h-4 w-4" /></Button>
          <Button size="sm" variant="outline" disabled={creating} onClick={() => { setKickoffError(null); selectTask(null); }}>
            <Plus className="h-4 w-4" />新建任务
          </Button>
        </div>
      </header>
      <DevSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} ready={ready} />
      {(health.error || (health.data && !ready)) && (
        <div role="alert" className="mb-5 space-y-2 rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm">
          <p>{health.error || '本地执行器未就绪，请检查本地配置。'}</p>
          {health.data && !health.data.enabled && <p>在 .env.local 设置 AGENT_DEV_ENABLED=true，然后重启后端。</p>}
          {health.data?.enabled && !health.data.binExists && <p className="break-all">未找到执行器：{health.data.binPath}</p>}
          <Button variant="outline" size="sm" onClick={health.refresh}>重试检查配置</Button>
        </div>
      )}
      <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[230px_minmax(0,1fr)] xl:gap-10">
        <section aria-label="开发任务列表" className={'min-w-0 space-y-3 xl:sticky xl:top-0 ' + (selectedId ? 'hidden xl:block' : 'order-2 xl:order-none')}>
          <div className="flex items-center justify-between px-2 text-xs text-muted-foreground"><h2>最近任务</h2><span>{tasks.length}</span></div>
          <div className="relative">
            <Search aria-hidden="true" className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="h-9 border-transparent bg-muted/40 pl-9 text-sm" aria-label="搜索任务" placeholder="搜索任务" value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
          <details className="group/filter px-1">
            <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 py-1 text-xs text-muted-foreground hover:text-foreground">
              <ChevronRight className="h-3.5 w-3.5 transition-transform group-open/filter:rotate-90" />筛选任务{filter !== 'all' && ' · 已筛选'}
            </summary>
            <div className="py-2">
              <Select value={filter} onValueChange={setFilter}>
                <SelectTrigger aria-label="筛选任务状态"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem className={filterItemClass} value="all">全部状态</SelectItem>
                  {STATUS_ORDER.map((status) => <SelectItem className={filterItemClass} key={status} value={status}>{STATUS_LABEL[status]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </details>
          {list.error && <div role="alert" className="space-y-2 px-2 text-sm text-destructive">
            <p className="break-words">{list.error}</p><Button size="sm" variant="outline" onClick={list.refresh}>重试加载列表</Button>
          </div>}
          {list.loading && !list.data && <p role="status" className="p-2 text-xs text-muted-foreground">加载任务列表…</p>}
          {!list.loading && !list.error && visibleTasks.length === 0 && <p className="px-2 py-5 text-xs leading-6 text-muted-foreground">{tasks.length ? '没有匹配的任务。' : '新任务会出现在这里。'}</p>}
          <div className="space-y-1 xl:max-h-[calc(100dvh-290px)] xl:overflow-y-auto">
            {visibleTasks.map((task) => <DevTaskCard key={task.id} task={task} selected={task.id === selectedId} disabled={creating} onClick={() => selectTask(task.id)} />)}
          </div>
        </section>
        {selectedId ? (
          <DevTaskDetail key={selectedId} taskId={selectedId} onBack={() => selectTask(null)} ready={ready}
            kickoffError={kickoffError?.id === selectedId ? kickoffError.message : undefined}
            onChanged={() => { setKickoffError(null); list.refresh(); }} />
        ) : (
          <section className="mx-auto flex min-h-[52dvh] w-full min-w-0 max-w-3xl flex-col justify-center gap-7 pb-8 xl:min-h-[70dvh]">
            <div className="space-y-3 text-center">
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">今天想改什么？</h2>
              <p className="text-sm leading-6 text-muted-foreground">描述任务，我会查看代码、尝试修复，并把改动交给你审阅。</p>
            </div>
            <DevTaskComposer ready={ready} onCreatingChange={setCreating} onCreated={(task, error) => {
              setKickoffError(error ? { id: task.id, message: error } : null);
              list.refresh(); selectTask(task.id);
            }} />
          </section>
        )}
      </div>
    </div>
  );
}
