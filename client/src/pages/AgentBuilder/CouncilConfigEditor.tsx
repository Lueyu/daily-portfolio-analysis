import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CalendarClock, Lightbulb, Scale, ShieldCheck, Users } from 'lucide-react';
import type { CouncilConfig, CouncilMember, CouncilRole, TradingCadence } from '@shared/council.interface';
import { fetchIntegrationSettings } from '@/api/settings';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { DEFAULT_CADENCE } from '@/utils/council-state';

export function defaultCouncil(t: (key: string) => string): CouncilConfig {
  const roles: CouncilRole[] = ['researcher', 'challenger', 'manager'];
  return { enabled: true, members: roles.map((role: CouncilRole) => ({
    id: role, role, name: t(`council.team.names.${role}`), instructions: '',
    model: role === 'manager' ? 'slow' : 'fast',
  })) };
}

export const COUNCIL_ICONS = { researcher: Lightbulb, challenger: ShieldCheck, manager: Scale };

export default function CouncilConfigEditor({ council, cadence, onCouncilChange, onCadenceChange }: {
  council: CouncilConfig; cadence: TradingCadence;
  onCouncilChange: (value: CouncilConfig) => void;
  onCadenceChange: (value: TradingCadence) => void;
}) {
  const { t } = useTranslation();
  const integration = useQuery({ queryKey: ['settings', 'integrations'], queryFn: fetchIntegrationSettings });
  const noModel = integration.data && (!integration.data.llm.available || integration.data.llm.engine === 'basic');
  const updateMember = (id: string, update: Partial<CouncilMember>) => onCouncilChange({ ...council,
    members: council.members.map((member: CouncilMember) => member.id === id ? { ...member, ...update } : member),
  });
  return <div className="space-y-5">
    <section className="space-y-4 rounded-xl border border-primary/20 bg-primary/5 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Label htmlFor="council-enabled" className="flex items-center gap-2 text-base font-semibold">
            <Users className="size-5 text-primary" />{t('council.team.title')}
          </Label>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{t('council.team.intro')}</p>
        </div>
        <Switch id="council-enabled" checked={council.enabled}
          onCheckedChange={(enabled: boolean) => onCouncilChange({ ...council, enabled })} />
      </div>
      <p className="text-xs leading-5 text-muted-foreground">{t(council.enabled
        ? 'council.team.enabledHint' : 'council.team.rulesOnly')}</p>
      {council.enabled && noModel && <p className="rounded-lg border border-border bg-background p-3 text-sm leading-6">
        {t('council.noModel')} <Link to="/settings" className="text-primary hover:underline">{t('council.apiSettings')}</Link>
      </p>}
      {council.enabled && <div className="grid gap-3 xl:grid-cols-3">
        {council.members.map((member: CouncilMember) => {
          const Icon = COUNCIL_ICONS[member.role];
          return <div key={member.id} className="min-w-0 space-y-3 rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2"><Icon className="size-5 shrink-0 text-primary" />
              <p className="font-semibold">{t(`council.roles.${member.role}`)}</p></div>
            <p className="min-h-10 text-xs leading-5 text-muted-foreground">{t(`council.team.jobs.${member.role}`)}</p>
            <div className="space-y-2"><Label htmlFor={`member-${member.id}`}>{t('council.team.name')}</Label>
              <Input id={`member-${member.id}`} value={member.name} maxLength={40}
                onChange={(event) => updateMember(member.id, { name: event.target.value })} /></div>
            <div className="space-y-2"><Label htmlFor={`model-${member.id}`}>{t('council.model')}</Label>
              <select id={`model-${member.id}`} value={member.model}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                onChange={(event) => updateMember(member.id, { model: event.target.value === 'slow' ? 'slow' : 'fast' })}>
                <option value="fast">{t('council.team.fast')}</option><option value="slow">{t('council.team.slow')}</option>
              </select></div>
            <div className="space-y-2"><Label htmlFor={`instructions-${member.id}`}>{t('council.team.instructions')}</Label>
              <Textarea id={`instructions-${member.id}`} rows={3} maxLength={1000} value={member.instructions}
                placeholder={t(`council.team.prompts.${member.role}`)}
                onChange={(event) => updateMember(member.id, { instructions: event.target.value })} /></div>
          </div>;
        })}
      </div>}
    </section>
    <section className="space-y-4 rounded-xl border border-border p-4">
      <div><h4 className="flex items-center gap-2 font-semibold"><CalendarClock className="size-5 text-primary" />
        {t('council.cadence.title')}</h4><p className="mt-2 text-sm leading-6 text-muted-foreground">{t('council.cadence.intro')}</p></div>
      <div className="grid gap-4 sm:grid-cols-2">
        {(Object.keys(DEFAULT_CADENCE) as Array<keyof TradingCadence>).map((field) => <div key={field} className="space-y-2">
          <Label htmlFor={`cadence-${field}`}>{t(`council.cadence.${field}`)}</Label>
          <Input id={`cadence-${field}`} type="number" step={field === 'maxWeeklyTurnoverPct' ? 0.1 : 1}
            min={field === 'cooldownTradingDays' ? 0 : field === 'maxWeeklyTurnoverPct' ? 0.1 : 1}
            max={field === 'maxWeeklyTurnoverPct' ? 100 : field === 'maxOrdersPerWeek' ? 20 : 60}
            value={cadence[field]} onChange={(event) => onCadenceChange({ ...cadence, [field]: Number(event.target.value) })} />
        </div>)}
      </div>
      <p className="text-xs leading-5 text-muted-foreground">{t('council.cadence.calendarHint')}</p>
    </section>
  </div>;
}
