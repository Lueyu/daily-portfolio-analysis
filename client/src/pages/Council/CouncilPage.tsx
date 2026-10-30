import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, CirclePause, Loader2, MessageCircle, Play, Plus, Send, Users } from 'lucide-react';
import type { BuilderProfile } from '@shared/api.interface';
import type { CouncilMessage, CouncilSession } from '@shared/council.interface';
import { fetchBuilderProfiles } from '@/api/builder';
import { fetchIntegrationSettings } from '@/api/settings';
import { useCouncilActions, useCouncilSession, useCouncilSessions } from '@/hooks/use-council';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage } from '@/pages/AgentBuilder/errorMessage';
import { COUNCIL_ICONS } from '@/pages/AgentBuilder/CouncilConfigEditor';
import CouncilReportCard from './CouncilReportCard';

export default function CouncilPage() {
  const { t, i18n } = useTranslation();
  const [params, setParams] = useSearchParams();
  const [newOpen, setNewOpen] = useState(params.has('profileId') || params.has('ticker'));
  const [profileId, setProfileId] = useState(params.get('profileId') ?? '');
  const [ticker, setTicker] = useState(params.get('ticker') ?? '');
  const [formError, setFormError] = useState<string | null>(null);
  const [initialSessionId, setInitialSessionId] = useState<string | null>(null);
  const profilesQuery = useQuery({ queryKey: ['builder', 'profiles'], queryFn: fetchBuilderProfiles });
  const integrations = useQuery({ queryKey: ['settings', 'integrations'], queryFn: fetchIntegrationSettings });
  const sessionsQuery = useCouncilSessions();
  const selectedId = params.get('session') ?? initialSessionId;
  const sessionQuery = useCouncilSession(selectedId);
  const actions = useCouncilActions();
  const session = sessionQuery.data;
  const profiles = profilesQuery.data ?? [];
  const selectedProfile = profiles.find((item: BuilderProfile) => item.id === session?.profileId);
  const noModel = integrations.data && (!integrations.data.llm.available || integrations.data.llm.engine === 'basic');
  useEffect(() => {
    const firstId = sessionsQuery.data?.[0]?.id;
    if (!initialSessionId && firstId) setInitialSessionId(firstId);
  }, [initialSessionId, sessionsQuery.data]);
  const showError = (cause: unknown) => toast.error(errorMessage(cause, t('council.actionFailed')));
  const create = async () => {
    const owner = profileId || profiles[0]?.id;
    const symbol = ticker.trim().toUpperCase();
    if (!owner || !/^[A-Z0-9.^-]{1,20}$/u.test(symbol)) {
      setFormError(t('council.newInvalid')); return;
    }
    setFormError(null);
    try {
      const created = await actions.create.mutateAsync({ profileId: owner, ticker: symbol,
        language: i18n.language.startsWith('zh') ? 'zh-CN' : 'en' });
      setParams({ session: created.id });
      setNewOpen(false);
      await actions.run.mutateAsync(created.id);
    } catch (cause) { showError(cause); }
  };
  return <div className="mx-auto min-w-0 max-w-7xl space-y-6 pb-12">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="max-w-2xl">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
          <Users className="size-4" />{t('council.eyebrow')}</p>
        <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight">{t('council.title')}</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{t('council.intro')}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm"><Link to="/agent-builder"><ArrowLeft />{t('council.builder')}</Link></Button>
        <Button type="button" size="sm" onClick={() => setNewOpen(!newOpen)} aria-expanded={newOpen}>
          <Plus />{t('council.newSession')}</Button>
      </div>
    </header>
    {noModel && <div className="rounded-xl border border-border bg-muted/40 p-4 text-sm leading-6">
      {t('council.noModel')} <Link to="/settings" className="font-medium text-primary hover:underline">{t('council.apiSettings')}</Link>
    </div>}
    {(newOpen || (sessionsQuery.isSuccess && sessionsQuery.data.length === 0)) &&
      <Card className="border-primary/30"><CardContent className="space-y-4 pt-5">
        <h2 className="font-serif text-xl font-semibold">{t('council.newTitle')}</h2>
        {profilesQuery.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(profilesQuery.error, t('council.loadFailed'))}</p>}
        {profilesQuery.isLoading ? <p className="text-sm text-muted-foreground">{t('council.loading')}</p>
          : profiles.length === 0 ? <div className="space-y-3"><p className="text-sm text-muted-foreground">{t('council.noProfiles')}</p>
            <Button asChild size="sm"><Link to="/agent-builder">{t('council.createTeam')}</Link></Button></div>
            : <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void create(); }}>
              <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                <div className="space-y-2"><Label htmlFor="council-profile">{t('council.profile')}</Label>
                  <select id="council-profile" value={profileId || profiles[0]?.id}
                    onChange={(event) => setProfileId(event.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                    {profiles.map((profile: BuilderProfile) => <option key={profile.id} value={profile.id}>{profile.config.name} · v{profile.version}</option>)}
                  </select></div>
                <div className="space-y-2"><Label htmlFor="council-ticker">{t('council.ticker')}</Label>
                  <Input id="council-ticker" value={ticker} maxLength={20} placeholder="AAPL / 0700.HK / 600519.SS"
                    onChange={(event) => setTicker(event.target.value)} /></div>
                <Button type="submit" disabled={actions.create.isPending || actions.run.isPending}>
                  {actions.create.isPending ? <Loader2 className="animate-spin" /> : <Play />}{t('council.start')}</Button>
              </div>
              <p className="text-xs leading-5 text-muted-foreground">{t('council.newHint')}</p>
              {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
            </form>}
      </CardContent></Card>}
    <div className="grid min-w-0 gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="min-w-0 space-y-3" aria-label={t('council.sessions')}>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{t('council.sessions')}</h2>
        {sessionsQuery.isLoading && <p className="text-sm text-muted-foreground">{t('council.loading')}</p>}
        {sessionsQuery.isError && <div role="alert" className="space-y-2 text-sm text-destructive">
          <p>{errorMessage(sessionsQuery.error, t('council.loadFailed'))}</p>
          <Button variant="outline" size="sm" onClick={() => void sessionsQuery.refetch()}>{t('council.retry')}</Button>
        </div>}
        <div className="flex gap-2 overflow-x-auto pb-2 lg:max-h-[65vh] lg:flex-col lg:overflow-y-auto lg:overflow-x-hidden">
          {(sessionsQuery.data ?? []).map((savedItem: CouncilSession) => {
            const item = savedItem.id === session?.id ? session : savedItem;
            return <button key={item.id} type="button"
            aria-pressed={selectedId === item.id} onClick={() => setParams({ session: item.id })}
            className={`min-w-44 rounded-xl border p-3 text-left transition-colors lg:min-w-0 ${selectedId === item.id
              ? 'border-primary/40 bg-primary/5' : 'border-border bg-card hover:bg-muted/50'}`}>
            <span className="flex items-center justify-between gap-2"><span className="font-mono text-base font-semibold">{item.ticker}</span>
              {item.status === 'running' && <Loader2 className="size-3.5 animate-spin text-primary" />}</span>
            <span className="mt-1 block truncate text-xs text-muted-foreground">
              {profiles.find((profile: BuilderProfile) => profile.id === item.profileId)?.config.name ?? t('council.profile')}
            </span>
            <span className="mt-3 flex flex-wrap gap-2 text-xs"><span>{t(`council.status.${item.status}`)}</span>
              <span className="text-muted-foreground">{new Date(item.updatedAt).toLocaleDateString(i18n.language)}</span></span>
          </button>; })}
        </div>
        <Link to="/agent-builder?tab=budget" className="inline-flex text-xs font-medium text-primary hover:underline">{t('council.budget.open')}</Link>
      </aside>
      <section className="min-w-0 space-y-5" aria-label={t('council.conversation')}>
        {sessionQuery.isLoading && <p className="text-sm text-muted-foreground">{t('council.loading')}</p>}
        {sessionQuery.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(sessionQuery.error, t('council.loadFailed'))}</p>}
        {session && <>
          <Card><CardContent className="space-y-4 pt-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2">
                <h2 className="font-mono text-2xl font-semibold">{session.ticker}</h2>
                <Badge variant={session.status === 'failed' ? 'destructive' : 'secondary'}>{t(`council.status.${session.status}`)}</Badge>
              </div><p className="mt-2 break-words text-xs text-muted-foreground">
                {selectedProfile?.config.name ?? t('council.profile')} · {t('council.profileVersion', { version: session.profileVersion })}
                {' · '}{t('council.revision', { revision: session.revision })}
              </p></div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" disabled={actions.pause.isPending || session.status !== 'running'}
                  onClick={() => actions.pause.mutate(session.id, { onError: showError })}><CirclePause />{t('council.pause')}</Button>
                <Button type="button" size="sm" disabled={actions.run.isPending || session.status === 'running'}
                  onClick={() => actions.run.mutate(session.id, { onError: showError })}>
                  {actions.run.isPending ? <Loader2 className="animate-spin" /> : <Play />}
                  {t(session.status === 'idle' && session.reports.length === 0 && session.messages.length === 0
                    ? 'council.start' : 'council.continue')}</Button>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {(selectedProfile?.version === session.profileVersion ? selectedProfile.config.council?.members : [])?.map((member) => {
                const Icon = COUNCIL_ICONS[member.role];
                return <div key={member.id} className="flex min-w-0 items-center gap-2 rounded-lg bg-muted/40 p-3">
                  <Icon className="size-4 shrink-0 text-primary" /><div className="min-w-0">
                    <p className="truncate text-sm font-medium">{member.name}</p>
                    <p className="text-xs text-muted-foreground">{t(`council.roles.${member.role}`)}</p>
                  </div></div>;
              })}
            </div>
            {session.error && <p role="alert" className="break-words rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm leading-6">{session.error}</p>}
            {selectedProfile && selectedProfile.version !== session.profileVersion && <p className="text-xs text-muted-foreground">{t('council.profileChanged')}</p>}
            <p className="text-xs leading-5 text-muted-foreground">{t('council.discussionHint')}</p>
          </CardContent></Card>
          <SessionConversation key={session.id} session={session} />
          {session.reports.length > 0 && <section className="space-y-4" aria-label={t('council.report.history')}>
            {[...session.reports].sort((left, right) => right.version - left.version).map((report) =>
              <CouncilReportCard key={report.id} report={report} session={session} profileVersion={selectedProfile?.version} />)}
          </section>}
        </>}
      </section>
    </div>
  </div>;
}

function SessionConversation({ session }: { session: CouncilSession }) {
  const { t, i18n } = useTranslation();
  const [content, setContent] = useState('');
  const actions = useCouncilActions();
  const messageLimitReached = session.messages.filter((message: CouncilMessage) => message.role === 'user').length >= 30;
  const submit = async () => {
    if (!content.trim()) return;
    const submitted = content.trim();
    try {
      await actions.send.mutateAsync({ id: session.id, content: submitted });
      setContent((current: string) => current.trim() === submitted ? '' : current);
      toast.success(t('council.messageAdded'));
    } catch (cause) { toast.error(errorMessage(cause, t('council.actionFailed'))); }
  };
  return <Card className="min-w-0"><CardContent className="space-y-4 pt-5">
    <h3 className="flex items-center gap-2 font-serif text-lg font-semibold"><MessageCircle className="size-5 text-primary" />{t('council.conversation')}</h3>
    <div className="max-h-[600px] space-y-4 overflow-y-auto pr-1" role="log" aria-label={t('council.conversation')}>
      {session.messages.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">
        {t(session.reports.some((report) => report.engine === 'basic') ? 'council.noMessagesBasic' : 'council.noMessages')}</p>}
      {session.messages.map((message: CouncilMessage) => <article key={message.id}
        className={`rounded-xl border p-4 ${message.role === 'user' ? 'border-primary/20 bg-primary/5' : 'border-border bg-muted/20'}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 break-words text-sm font-semibold">{message.role === 'user' ? t('council.you') : message.role === 'system'
            ? t('council.roles.system') : message.memberName}
            {message.role !== 'user' && message.role !== 'system' && <span className="ml-2 text-xs font-normal text-muted-foreground">{t(`council.roles.${message.role}`)}</span>}</p>
          <span className="text-xs text-muted-foreground">{new Date(message.createdAt).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7">{message.content}</p>
        {message.revision < session.revision && <p className="mt-2 text-xs text-muted-foreground">{t('council.earlierRevision', { revision: message.revision })}</p>}
      </article>)}
    </div>
    {session.status === 'running' && <p role="status" className="flex items-center gap-2 text-xs leading-5 text-muted-foreground">
      <Loader2 className="size-4 shrink-0 animate-spin text-primary" />{t('council.runningHint')}</p>}
    <form className="space-y-3 border-t border-border pt-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <Label htmlFor="council-message">{t('council.composerLabel')}</Label>
      <Textarea id="council-message" value={content} onChange={(event) => setContent(event.target.value)}
        rows={3} maxLength={2000} disabled={messageLimitReached} placeholder={t('council.composerPlaceholder')} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-lg text-xs leading-5 text-muted-foreground">{t(messageLimitReached ? 'council.messageLimit' : 'council.composerHint')}</p>
        <Button type="submit" size="sm" disabled={!content.trim() || actions.send.isPending || messageLimitReached}>
          {actions.send.isPending ? <Loader2 className="animate-spin" /> : <Send />}{t('council.send')}</Button>
      </div>
    </form>
  </CardContent></Card>;
}
