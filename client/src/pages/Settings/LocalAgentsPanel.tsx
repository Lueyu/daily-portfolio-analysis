import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Bot, CheckCircle2, Copy, Loader2, RefreshCw } from 'lucide-react';
import { fetchLocalAgents, testLocalAgent } from '@/api/local-agents';
import { fetchMyProfile } from '@/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { errorMessage } from '@/pages/AgentBuilder/errorMessage';

export default function LocalAgentsPanel() {
  const { t } = useTranslation();
  const agents = useQuery({ queryKey: ['settings', 'local-agents'], queryFn: fetchLocalAgents });
  const profile = useQuery({ queryKey: ['auth', 'me'], queryFn: fetchMyProfile, staleTime: 5 * 60 * 1000 });
  const [copied, setCopied] = useState(false);
  const [results, setResults] = useState<Record<string, { ok: boolean; message: string }>>({});
  const probe = useMutation({ mutationFn: testLocalAgent,
    onSuccess: (result, id: string) => setResults(current => ({ ...current,
      [id]: { ok: result.ok, message: t(result.ok ? 'council.localAgents.testSuccess' : 'council.localAgents.testFailed') } })),
    onError: (error: unknown, id: string) => setResults(current => ({ ...current,
      [id]: { ok: false, message: errorMessage(error, t('council.localAgents.testFailed')) } })),
  });
  return <Card id="local-agents" className="min-w-0 scroll-mt-6">
    <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
      <div className="max-w-2xl space-y-2">
        <CardTitle className="flex items-center gap-2"><Bot className="size-5 text-primary" />{t('council.localAgents.title')}</CardTitle>
        <CardDescription>{t('council.localAgents.intro')}</CardDescription>
      </div>
      <Button variant="outline" size="sm" disabled={agents.isFetching} onClick={() => void agents.refetch()}>
        <RefreshCw className={agents.isFetching ? 'animate-spin' : ''} />{t('council.localAgents.refresh')}
      </Button>
    </CardHeader>
    <CardContent className="space-y-4">
      {agents.isPending && <p role="status" className="text-sm text-muted-foreground">{t('council.loading')}</p>}
      {agents.isError && <p role="alert" className="text-sm text-destructive">{t('council.localAgents.loadFailed')}</p>}
      {agents.isSuccess && agents.data.length === 0 && <p className="rounded-xl bg-muted/40 p-4 text-sm leading-6 text-muted-foreground">{t('council.localAgents.empty')}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {agents.data?.map(agent => <div key={agent.id} className="min-w-0 rounded-xl border border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0"><p className="break-words font-semibold">{agent.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">A2A · {t('council.localAgents.externalRuntime')}</p></div>
            <Button size="sm" variant="outline" disabled={probe.isPending || !agent.available} onClick={() => probe.mutate(agent.id)}>
              {probe.isPending && probe.variables === agent.id ? <Loader2 className="size-3 animate-spin" /> : <CheckCircle2 className="size-3" />}
              {t('council.localAgents.test')}
            </Button>
          </div>
          {results[agent.id] && <p role="status" className={`mt-3 break-words text-xs leading-5 ${results[agent.id].ok ? 'text-success' : 'text-destructive'}`}>{results[agent.id].message}</p>}
        </div>)}
      </div>
      <div className="space-y-2 rounded-xl bg-muted/30 p-4 text-xs leading-5 text-muted-foreground">
        <p>{t('council.localAgents.setup')}</p>
        {profile.data?.id && <div className="flex flex-wrap items-center gap-2">
          <span>{t('council.localAgents.accountId')}</span>
          <code className="min-w-0 select-all break-all rounded border border-border bg-background px-2 py-1">{profile.data.id}</code>
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => {
            if (profile.data?.id && navigator.clipboard) void navigator.clipboard.writeText(profile.data.id).then(() => setCopied(true)).catch(() => setCopied(false));
          }}><Copy className="size-3" />{t(copied ? 'council.localAgents.copied' : 'council.localAgents.copyId')}</Button>
        </div>}
        <a href="https://github.com/Lueyu/squabble/blob/main/docs/local-agents.md" target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-1 font-medium text-primary hover:underline">{t('council.localAgents.guide')}<ArrowUpRight className="size-3" /></a>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">{t('council.localAgents.budgetHint')}{' '}
        <Link to="/settings#research-budget" className="font-medium text-primary hover:underline">{t('council.budget.open')}</Link>
      </p>
    </CardContent>
  </Card>;
}
