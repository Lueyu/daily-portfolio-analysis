import { useTranslation } from 'react-i18next';
import { CheckCircle2, ChevronDown, CircleAlert, Loader2, Search } from 'lucide-react';
import type { CouncilSession } from '@shared/council.interface';

export default function CouncilResearchProgress({ session }: { session: CouncilSession }) {
  const { t } = useTranslation();
  const events = session.messages.filter((message) => message.acquisition || message.phase === 'progress');
  const progress = session.progress;
  const activeMember = session.members?.find((member) => member.id === progress?.memberId);
  const latest = events.at(-1);
  if (!progress && events.length === 0) return null;
  const running = session.status === 'running';
  const phase = progress?.phase ?? 'progress';
  return <details className="shrink-0 border-b border-border bg-muted/20 text-xs">
    <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
      {running ? <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" /> : <Search className="size-3.5 shrink-0 text-muted-foreground" />}
      <span className="min-w-0 flex-1 truncate" role="status">
        {running ? activeMember ? `${activeMember.name} · ${t(`council.progress.phases.${phase}`)}`
          : t(`council.progress.phases.${phase}`) : t('council.progress.history')}
        {!progress && running && latest?.acquisition?.source && ` · ${latest.acquisition.source}`}
      </span>
      {running && progress && progress.totalTurns > 0 && <span className="shrink-0 tabular-nums text-muted-foreground">
        {t('council.progress.turn', { turn: Math.min(progress.turn, progress.totalTurns), total: progress.totalTurns })}</span>}
      <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
    </summary>
    <div className="max-h-40 space-y-2 overflow-y-auto border-t border-border px-4 py-3">
      {events.length === 0 && <p className="leading-5 text-muted-foreground">{t('council.progress.waiting')}</p>}
      {events.slice(-16).map((message) => {
        const acquisition = message.acquisition;
        const failed = acquisition?.status === 'failed' || acquisition?.status === 'partial';
        return <div key={message.id} className="flex items-start gap-2 leading-5">
          {failed ? <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            : acquisition?.status === 'started' ? <Search className="mt-0.5 size-3.5 shrink-0 text-primary" />
              : <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-primary" />}
          <p className="min-w-0 break-words"><span className="font-medium">{acquisition?.source ?? message.memberName}</span>
            {acquisition && <span className="ml-2 text-muted-foreground">{t(`council.progress.acquisition.${acquisition.status}`)}</span>}
            <span className="mt-0.5 block text-muted-foreground">{acquisition?.detail || message.content}</span></p>
        </div>;
      })}
    </div>
  </details>;
}
