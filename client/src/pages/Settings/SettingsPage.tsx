import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { isAxiosError } from 'axios';
import { toast } from 'sonner';
import {
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  RotateCw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  fetchIntegrationSettings,
  removeFinancialIntegration,
  removeLlmIntegration,
  saveFinancialIntegration,
  saveLlmIntegration,
  testFinancialIntegration,
  testLlmIntegration,
  type IntegrationSettings,
  type IntegrationTestResult,
  type UpdateLlmIntegrationRequest,
} from '@/api/settings';
import SettingsGuide from './SettingsGuide';

interface LlmDraft {
  baseUrl: string;
  fastModel: string;
  slowModel: string;
  apiKey: string;
}

const EMPTY_LLM: LlmDraft = {
  baseUrl: '',
  fastModel: '',
  slowModel: '',
  apiKey: '',
};

function getErrorMessage(error: unknown, fallback: string): string {
  if (isAxiosError(error)) {
    const payload: unknown = error.response?.data;
    if (typeof payload === 'object' && payload !== null && 'message' in payload) {
      const message: unknown = payload.message;
      if (typeof message === 'string' && message.trim()) return message;
    }
    if (typeof payload === 'object' && payload !== null && 'error' in payload) {
      const nested: unknown = payload.error;
      if (typeof nested === 'object' && nested !== null && 'message' in nested) {
        const message: unknown = nested.message;
        if (typeof message === 'string' && message.trim()) return message;
      }
    }
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function SettingsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [llmDraft, setLlmDraft] = useState<LlmDraft>(EMPTY_LLM);
  const [llmDirty, setLlmDirty] = useState(false);
  const [financialKey, setFinancialKey] = useState('');
  const [financialDirty, setFinancialDirty] = useState(false);
  const [showLlmKey, setShowLlmKey] = useState(false);
  const [showFinancialKey, setShowFinancialKey] = useState(false);
  const [llmError, setLlmError] = useState<string | null>(null);
  const [financialError, setFinancialError] = useState<string | null>(null);
  const [llmTestResult, setLlmTestResult] = useState<IntegrationTestResult | null>(null);
  const [financialTestResult, setFinancialTestResult] = useState<IntegrationTestResult | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<'llm' | 'financial' | null>(null);

  const settingsQuery = useQuery<IntegrationSettings>({
    queryKey: ['settings', 'integrations'],
    queryFn: fetchIntegrationSettings,
    retry: false,
  });

  useEffect(() => {
    if (!settingsQuery.data) return;
    if (!llmDirty) {
      setLlmDraft({
        baseUrl: settingsQuery.data.llm.baseUrl ?? '',
        fastModel: settingsQuery.data.llm.fastModel ?? '',
        slowModel: settingsQuery.data.llm.slowModel ?? '',
        apiKey: '',
      });
    }
    if (!financialDirty) setFinancialKey('');
  }, [settingsQuery.data, llmDirty, financialDirty]);

  function syncSettings(saved: IntegrationSettings): void {
    queryClient.setQueryData(['settings', 'integrations'], saved);
    void queryClient.invalidateQueries({ queryKey: ['settings', 'integrations'] });
  }

  const saveLlm = useMutation<IntegrationSettings, Error, UpdateLlmIntegrationRequest>({
    mutationFn: saveLlmIntegration,
    retry: false,
    onSuccess: (saved: IntegrationSettings) => {
      syncSettings(saved);
      setLlmDirty(false);
      setLlmDraft({
        baseUrl: saved.llm.baseUrl,
        fastModel: saved.llm.fastModel,
        slowModel: saved.llm.slowModel,
        apiKey: '',
      });
      setShowLlmKey(false);
      setLlmError(null);
      setLlmTestResult(null);
      toast.success(t('ui.settings.saved'));
    },
    onError: (error: Error) => {
      const message = getErrorMessage(error, t('ui.settings.saveFailed'));
      setLlmError(message.startsWith('API base URL must use HTTPS')
        ? t('ui.settings.llm.invalidUrl') : message);
    },
  });
  const saveFinancial = useMutation<IntegrationSettings, Error, { provider: 'finnhub'; apiKey?: string }>({
    mutationFn: saveFinancialIntegration,
    retry: false,
    onSuccess: (saved: IntegrationSettings) => {
      syncSettings(saved);
      setFinancialKey('');
      setFinancialDirty(false);
      setShowFinancialKey(false);
      setFinancialError(null);
      setFinancialTestResult(null);
      toast.success(t('ui.settings.saved'));
    },
    onError: (error: Error) => setFinancialError(getErrorMessage(error, t('ui.settings.saveFailed'))),
  });
  const testLlm = useMutation<IntegrationTestResult, Error, void>({
    mutationFn: testLlmIntegration,
    retry: false,
    onSuccess: setLlmTestResult,
    onError: (error: Error) => setLlmTestResult({
      ok: false,
      message: getErrorMessage(error, t('ui.settings.testFailed')),
    }),
  });
  const testFinancial = useMutation<IntegrationTestResult, Error, void>({
    mutationFn: testFinancialIntegration,
    retry: false,
    onSuccess: setFinancialTestResult,
    onError: (error: Error) => setFinancialTestResult({
      ok: false,
      message: getErrorMessage(error, t('ui.settings.testFailed')),
    }),
  });
  const deleteLlm = useMutation<IntegrationSettings, Error, void>({
    mutationFn: removeLlmIntegration,
    retry: false,
    onSuccess: (saved: IntegrationSettings) => {
      syncSettings(saved);
      setLlmDirty(false);
      setLlmDraft({
        baseUrl: saved.llm.baseUrl,
        fastModel: saved.llm.fastModel,
        slowModel: saved.llm.slowModel,
        apiKey: '',
      });
      setShowLlmKey(false);
      setLlmTestResult(null);
      setDeleteTarget(null);
      toast.success(t('ui.settings.removed'));
    },
    onError: (error: Error) => {
      setDeleteTarget(null);
      setLlmError(getErrorMessage(error, t('ui.settings.removeFailed')));
    },
  });
  const deleteFinancial = useMutation<IntegrationSettings, Error, void>({
    mutationFn: removeFinancialIntegration,
    retry: false,
    onSuccess: (saved: IntegrationSettings) => {
      syncSettings(saved);
      setFinancialDirty(false);
      setFinancialKey('');
      setShowFinancialKey(false);
      setFinancialTestResult(null);
      setDeleteTarget(null);
      toast.success(t('ui.settings.removed'));
    },
    onError: (error: Error) => {
      setDeleteTarget(null);
      setFinancialError(getErrorMessage(error, t('ui.settings.removeFailed')));
    },
  });

  const llm = settingsQuery.data?.llm;
  const financial = settingsQuery.data?.financial;

  function updateLlm(field: keyof LlmDraft, value: string): void {
    setLlmDraft((current: LlmDraft) => ({ ...current, [field]: value }));
    setLlmDirty(true);
    setLlmError(null);
    setLlmTestResult(null);
  }

  function handleSaveLlm(): void {
    const baseUrl = llmDraft.baseUrl.trim();
    const fastModel = llmDraft.fastModel.trim();
    const slowModel = llmDraft.slowModel.trim();
    const apiKey = llmDraft.apiKey.trim();
    if (!baseUrl || !fastModel || !slowModel) {
      setLlmError(t('ui.settings.llm.completeFields'));
      return;
    }
    if (!apiKey && (llm?.source !== 'user' || llm.needsReentry)) {
      setLlmError(t(llm?.needsReentry
        ? 'ui.settings.reentryRequired' : 'ui.settings.llm.keyRequired'));
      return;
    }
    const request: UpdateLlmIntegrationRequest = {
      baseUrl,
      fastModel,
      slowModel,
      ...(apiKey ? { apiKey } : {}),
    };
    saveLlm.mutate(request);
  }

  function handleSaveFinancial(): void {
    const apiKey = financialKey.trim();
    if (!apiKey && (financial?.source !== 'user' || financial.needsReentry)) {
      setFinancialError(t(financial?.needsReentry
        ? 'ui.settings.reentryRequired' : 'ui.settings.financial.keyRequired'));
      return;
    }
    saveFinancial.mutate({ provider: 'finnhub', ...(apiKey ? { apiKey } : {}) });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            {t('ui.settings.eyebrow')}
          </p>
          <h1 className="font-serif text-3xl font-semibold tracking-tight">
            {t('ui.settings.title')}
          </h1>
          <p className="text-sm leading-6 text-muted-foreground">
            {t('ui.settings.intro')}
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
          <LockKeyhole size={15} aria-hidden="true" />
          {t('ui.settings.secretBadge')}
        </div>
      </div>

      {settingsQuery.isLoading ? (
        <div className="flex min-h-56 items-center justify-center gap-2 text-muted-foreground" role="status">
          <LoaderCircle className="size-4 animate-spin" /> {t('ui.settings.loading')}
        </div>
      ) : settingsQuery.isError || !settingsQuery.data ? (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
            <p className="text-sm text-destructive">{t('ui.settings.loadFailed')}</p>
            <Button variant="outline" onClick={() => void settingsQuery.refetch()}>
              <RotateCw /> {t('ui.settings.retry')}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid items-start gap-5 xl:grid-cols-2">
          <Card className="min-w-0">
            <CardHeader className="gap-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-primary/10 p-2 text-primary"><Sparkles size={19} /></div>
                  <div>
                    <CardTitle className="text-lg leading-snug">{t('ui.settings.llm.title')}</CardTitle>
                    <CardDescription className="mt-1">{t('ui.settings.llm.subtitle')}</CardDescription>
                  </div>
                </div>
                <Badge variant={llm?.hasApiKey ? 'secondary' : 'outline'}>
                  {t(llm?.needsReentry
                    ? 'ui.settings.source.needsReentry'
                    : `ui.settings.source.${llm?.source ?? 'none'}`)}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <p className="text-sm leading-6 text-muted-foreground">
                {t('ui.settings.llm.scope')}
              </p>
              {llm?.needsReentry && (
                <p role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm leading-6 text-foreground">
                  {t('ui.settings.reentryWarning')}
                </p>
              )}
              <div className="space-y-2">
                <Label htmlFor="llm-base-url">{t('ui.settings.llm.baseUrl')}</Label>
                <Input id="llm-base-url" type="url" value={llmDraft.baseUrl}
                  onChange={(event) => updateLlm('baseUrl', event.target.value)}
                  placeholder="https://api.openai.com/v1" autoComplete="url" />
                <p className="text-xs leading-5 text-muted-foreground">
                  {t('ui.settings.llm.baseHint')}
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button size="sm" variant="outline" type="button"
                    onClick={() => updateLlm('baseUrl', 'https://api.openai.com/v1')}>
                    OpenAI
                  </Button>
                  <Button size="sm" variant="outline" type="button"
                    onClick={() => updateLlm('baseUrl', 'https://api.deepseek.com')}>
                    DeepSeek
                  </Button>
                  <Button size="sm" variant="outline" type="button"
                    onClick={() => updateLlm('baseUrl', 'https://ark.cn-beijing.volces.com/api/v3')}>
                    {t('ui.settings.llm.doubao')}
                  </Button>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="llm-fast-model">{t('ui.settings.llm.fastModel')}</Label>
                  <Input id="llm-fast-model" value={llmDraft.fastModel}
                    onChange={(event) => updateLlm('fastModel', event.target.value)}
                    placeholder={t('ui.settings.llm.modelPlaceholder')} autoComplete="off" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="llm-slow-model">{t('ui.settings.llm.slowModel')}</Label>
                  <Input id="llm-slow-model" value={llmDraft.slowModel}
                    onChange={(event) => updateLlm('slowModel', event.target.value)}
                    placeholder={t('ui.settings.llm.modelPlaceholder')} autoComplete="off" />
                </div>
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                {t('ui.settings.llm.modelHint')}
              </p>
              <div className="space-y-2">
                <Label htmlFor="llm-api-key">{t('ui.settings.apiKey')}</Label>
                <div className="flex gap-2">
                  <Input id="llm-api-key" type={showLlmKey ? 'text' : 'password'}
                    value={llmDraft.apiKey}
                    onChange={(event) => updateLlm('apiKey', event.target.value)}
                    placeholder={llm?.hasApiKey ? t('ui.settings.keepExisting') : t('ui.settings.enterKey')}
                    autoComplete="new-password" spellCheck={false} />
                  <Button type="button" variant="outline" size="icon"
                    aria-label={t(showLlmKey ? 'ui.settings.hideKey' : 'ui.settings.showKey')}
                    onClick={() => setShowLlmKey((current: boolean) => !current)}>
                    {showLlmKey ? <EyeOff /> : <Eye />}
                  </Button>
                </div>
                {llm?.hasApiKey && (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <CheckCircle2 className="size-3.5 text-success" />
                    {t('ui.settings.savedKey')}{llm.maskedApiKey ? ` · ${llm.maskedApiKey}` : ''}
                  </p>
                )}
                <p className="text-xs leading-5 text-muted-foreground">
                  {t(llm?.needsReentry
                    ? 'ui.settings.reentryRequired' : 'ui.settings.keyHint')}
                </p>
              </div>
              {llmError && <p className="text-sm text-destructive" role="alert">{llmError}</p>}
              {llmTestResult && <TestResult result={llmTestResult} />}
              {llmDirty && (
                <p className="text-xs text-muted-foreground">{t('ui.settings.saveBeforeTest')}</p>
              )}
              <div className="flex flex-wrap items-center gap-2 border-t border-border pt-5">
                <Button type="button" onClick={handleSaveLlm} disabled={saveLlm.isPending}>
                  {saveLlm.isPending && <LoaderCircle className="animate-spin" />}
                  {t('ui.settings.save')}
                </Button>
                <Button type="button" variant="outline" onClick={() => testLlm.mutate()}
                  disabled={!llm?.hasApiKey || llmDirty || testLlm.isPending}>
                  {testLlm.isPending ? <LoaderCircle className="animate-spin" /> : <RotateCw />}
                  {t('ui.settings.test')}
                </Button>
                {llm?.source === 'user' && (
                  <Button type="button" variant="ghost" className="text-destructive"
                    onClick={() => setDeleteTarget('llm')}>
                    <Trash2 /> {t('ui.settings.remove')}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="min-w-0">
            <CardHeader className="gap-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-primary/10 p-2 text-primary"><KeyRound size={19} /></div>
                  <div>
                    <CardTitle className="text-lg leading-snug">{t('ui.settings.financial.title')}</CardTitle>
                    <CardDescription className="mt-1">Finnhub</CardDescription>
                  </div>
                </div>
                <Badge variant={financial?.hasApiKey ? 'secondary' : 'outline'}>
                  {t(financial?.needsReentry
                    ? 'ui.settings.source.needsReentry'
                    : `ui.settings.source.${financial?.source ?? 'none'}`)}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <p className="text-sm leading-6 text-muted-foreground">
                {t('ui.settings.financial.scope')}
              </p>
              {financial?.needsReentry && (
                <p role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm leading-6 text-foreground">
                  {t('ui.settings.reentryWarning')}
                </p>
              )}
              <div className="rounded-lg border border-border bg-secondary/40 p-4 text-sm leading-6">
                <p className="font-medium">{t('ui.settings.financial.currentCoverage')}</p>
                <p className="mt-1 text-muted-foreground">
                  {t('ui.settings.financial.coverageDetail')}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="financial-api-key">{t('ui.settings.apiKey')}</Label>
                <div className="flex gap-2">
                  <Input id="financial-api-key" type={showFinancialKey ? 'text' : 'password'}
                    value={financialKey}
                    onChange={(event) => {
                      setFinancialKey(event.target.value);
                      setFinancialDirty(true);
                      setFinancialError(null);
                      setFinancialTestResult(null);
                    }}
                    placeholder={financial?.hasApiKey
                      ? t('ui.settings.keepExisting') : t('ui.settings.enterKey')}
                    autoComplete="new-password" spellCheck={false} />
                  <Button type="button" variant="outline" size="icon"
                    aria-label={t(showFinancialKey ? 'ui.settings.hideKey' : 'ui.settings.showKey')}
                    onClick={() => setShowFinancialKey((current: boolean) => !current)}>
                    {showFinancialKey ? <EyeOff /> : <Eye />}
                  </Button>
                </div>
                {financial?.hasApiKey && (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <CheckCircle2 className="size-3.5 text-success" />
                    {t('ui.settings.savedKey')}
                    {financial.maskedApiKey ? ` · ${financial.maskedApiKey}` : ''}
                  </p>
                )}
                <p className="text-xs leading-5 text-muted-foreground">
                  {t(financial?.needsReentry
                    ? 'ui.settings.reentryRequired' : 'ui.settings.keyHint')}
                </p>
              </div>
              {financialError && (
                <p className="text-sm text-destructive" role="alert">{financialError}</p>
              )}
              {financialTestResult && <TestResult result={financialTestResult} />}
              {financialDirty && (
                <p className="text-xs text-muted-foreground">{t('ui.settings.saveBeforeTest')}</p>
              )}
              <div className="flex flex-wrap items-center gap-2 border-t border-border pt-5">
                <Button type="button" onClick={handleSaveFinancial} disabled={saveFinancial.isPending}>
                  {saveFinancial.isPending && <LoaderCircle className="animate-spin" />}
                  {t('ui.settings.save')}
                </Button>
                <Button type="button" variant="outline" onClick={() => testFinancial.mutate()}
                  disabled={!financial?.hasApiKey || financialDirty || testFinancial.isPending}>
                  {testFinancial.isPending
                    ? <LoaderCircle className="animate-spin" /> : <RotateCw />}
                  {t('ui.settings.test')}
                </Button>
                {financial?.source === 'user' && (
                  <Button type="button" variant="ghost" className="text-destructive"
                    onClick={() => setDeleteTarget('financial')}>
                    <Trash2 /> {t('ui.settings.remove')}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <SettingsGuide />

      <div className="flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-4 text-xs leading-6 text-muted-foreground">
        <LockKeyhole className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
        <p>{t('ui.settings.privacyNote')}</p>
      </div>

      <AlertDialog open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('ui.settings.removeTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(deleteTarget === 'llm'
                ? 'ui.settings.llm.removeDescription'
                : 'ui.settings.financial.removeDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('ui.settings.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => {
                if (deleteTarget === 'llm') deleteLlm.mutate();
                if (deleteTarget === 'financial') deleteFinancial.mutate();
              }}
            >
              {t('ui.settings.remove')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function TestResult({ result }: { result: IntegrationTestResult }) {
  const { t } = useTranslation();
  return (
    <div role="status" className={`rounded-lg border px-3 py-2 text-sm leading-6 ${
      result.ok
        ? 'border-success/30 bg-success/10 text-success'
        : 'border-destructive/30 bg-destructive/5 text-destructive'
    }`}>
      <span className="font-medium">{t(result.ok
        ? 'ui.settings.testSucceeded' : 'ui.settings.testFailed')}</span>
      {result.message ? ` · ${result.message}` : ''}
    </div>
  );
}
