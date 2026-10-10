import { useEffect, useState, useMemo, useCallback } from 'react';
import { Edit3, Save, X } from 'lucide-react';
import { toast } from 'sonner';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { fetchJournal, fetchSnapshots, logger } from '@/api';
import type { JournalEntry, Snapshot } from '@shared/api.interface';
import { formatDate, cn, toDate } from '@/utils/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { DateNavigator } from './DateNavigator';
import { JournalChart } from './JournalChart';
import { sections, JournalSectionCard } from './JournalSectionCard';

function formatDateInput(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function safeDateStr(value: string | null | undefined): string {
  const d = toDate(value);
  return d ? formatDateInput(d) : '';
}

export default function JournalPage() {
  const [currentDate, setCurrentDate] = useState<Date>(() => new Date());
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [journal, setJournal] = useState<JournalEntry | null>(null);
  const [journalList, setJournalList] = useState<JournalEntry[]>([]);
  const [loadingSnap, setLoadingSnap] = useState(true);
  const [loadingJournal, setLoadingJournal] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const dateStr = formatDateInput(currentDate);

  const loadJournal = useCallback(async (date: string) => {
    setLoadingJournal(true);
    try {
      const items: JournalEntry[] = await fetchJournal(date);
      setJournalList(items || []);
      setJournal(items && items.length > 0 ? items[0] : null);
    } catch (error) {
      logger.error('加载日志失败', error);
      toast.error('加载日志失败');
    } finally {
      setLoadingJournal(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const data: Snapshot[] = await fetchSnapshots(30);
        if (mounted) {
          setSnapshots(data || []);
          if (data && data.length > 0) {
            const latest = toDate(data[0].snapshotDate);
            if (latest) {
              setCurrentDate(latest);
            }
          }
        }
      } catch (error) {
        logger.error('加载快照失败', error);
        toast.error('加载快照失败');
      } finally {
        if (mounted) setLoadingSnap(false);
      }
    };
    load();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    loadJournal(dateStr);
  }, [dateStr, loadJournal]);

  const currentSnapshot = useMemo(() => {
    return snapshots.find(
      (s) => safeDateStr(s.snapshotDate) === dateStr
    );
  }, [snapshots, dateStr]);

  const handlePrevDay = () => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() - 1);
    setCurrentDate(d);
  };

  const handleNextDay = () => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() + 1);
    setCurrentDate(d);
  };

  const handleDateChange = (d: Date) => {
    setCurrentDate(d);
  };

  const handleSelectHistory = (date: string) => {
    const d = toDate(date);
    if (d) setCurrentDate(d);
  };

  const startEdit = () => {
    setEditValues({
      marketSummary: journal?.marketSummary || '',
      portfolioSummary: journal?.portfolioSummary || '',
      actions: journal?.actions || '',
      plan: journal?.plan || '',
      lessons: journal?.lessons || '',
    });
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setEditValues({});
  };

  const saveJournal = async () => {
    setSaving(true);
    try {
      const payload = {
        journalDate: dateStr,
        marketSummary: editValues.marketSummary || undefined,
        portfolioSummary: editValues.portfolioSummary || undefined,
        actions: editValues.actions || undefined,
        plan: editValues.plan || undefined,
        lessons: editValues.lessons || undefined,
      };
      const response = await axiosForBackend({
        url: '/api/portfolio/journal',
        method: 'POST',
        data: payload,
      });
      setJournal(response.data);
      setEditing(false);
      toast.success('日志已保存');
      loadJournal(dateStr);
    } catch (error) {
      logger.error('保存日志失败', error);
      toast.error('保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const historyDates = useMemo(() => {
    const dates = new Set<string>();
    journalList.forEach((j) => dates.add(j.journalDate));
    snapshots.forEach((s) => s.snapshotDate && dates.add(s.snapshotDate));
    return Array.from(dates)
      .filter((d) => toDate(d))
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())
      .slice(0, 30);
  }, [journalList, snapshots]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-serif text-3xl font-semibold tracking-tight text-foreground">
            投资日志
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            每日复盘、操作记录与投资心得
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!editing ? (
            <Button onClick={startEdit} size="sm" className="gap-1.5">
              <Edit3 size={14} />
              编辑日志
            </Button>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={cancelEdit} className="gap-1.5">
                <X size={14} />
                取消
              </Button>
              <Button size="sm" onClick={saveJournal} disabled={saving} className="gap-1.5">
                <Save size={14} />
                {saving ? '保存中...' : '保存'}
              </Button>
            </>
          )}
        </div>
      </div>

      <DateNavigator
        currentDate={currentDate}
        snapshot={currentSnapshot}
        loading={loadingSnap}
        onPrev={handlePrevDay}
        onNext={handleNextDay}
        onDateChange={handleDateChange}
      />

      <JournalChart snapshots={snapshots} loading={loadingSnap} />

      <div className="grid gap-6 lg:grid-cols-[1fr_240px]">
        <div>
          <h2 className="mb-3 font-serif text-xl font-semibold">每日投资总结</h2>
          {loadingJournal ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Card key={i}>
                  <CardContent className="p-4">
                    <Skeleton className="mb-3 h-4 w-24" />
                    <Skeleton className="h-20 w-full" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {sections.map((s) => (
                <JournalSectionCard
                  key={s.key}
                  section={s}
                  content={journal?.[s.key]}
                  editing={editing}
                  editValue={editValues[s.key] || ''}
                  onEditChange={(val) =>
                    setEditValues((prev) => ({ ...prev, [s.key]: val }))
                  }
                />
              ))}
            </div>
          )}
        </div>

        <div>
          <h2 className="mb-3 font-serif text-xl font-semibold">历史日志</h2>
          <Card>
            <CardContent className="p-2">
              {historyDates.length === 0 ? (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  暂无历史记录
                </div>
              ) : (
                <div className="max-h-[500px] space-y-0.5 overflow-y-auto">
                  {historyDates.map((date) => {
                    const isActive =
                      safeDateStr(date) === dateStr;
                    return (
                      <button
                        key={date}
                        onClick={() => handleSelectHistory(date)}
                        className={cn(
                          'w-full rounded-md px-3 py-2 text-left text-sm transition-colors',
                          isActive
                            ? 'bg-primary/10 font-medium text-primary'
                            : 'hover:bg-muted text-foreground/80 hover:text-foreground'
                        )}
                      >
                        <div className="font-mono tabular-nums">{formatDate(date)}</div>
                      </button>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
