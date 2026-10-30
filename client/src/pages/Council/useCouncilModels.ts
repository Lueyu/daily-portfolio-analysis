import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { CouncilMember } from '@shared/council.interface';
import { fetchIntegrationSettings } from '@/api/settings';
import { fetchModelConnections } from '@/api/model-connections';

export interface CouncilModelOption {
  value: string;
  label: string;
  model: CouncilMember['model'];
  connectionId?: string;
  disabled: boolean;
}

export function councilModelValue(member: Pick<CouncilMember, 'connectionId' | 'model'>): string {
  return `${member.connectionId || 'default'}:${member.model}`;
}

export function useCouncilModels() {
  const { t } = useTranslation();
  const integration = useQuery({ queryKey: ['settings', 'integrations'], queryFn: fetchIntegrationSettings });
  const connections = useQuery({ queryKey: ['settings', 'model-connections'], queryFn: fetchModelConnections });
  const options: CouncilModelOption[] = (['fast', 'slow'] as const).map((model) => ({
    value: `default:${model}`, model, disabled: false,
    label: [t('council.members.defaultConnection'), integration.data?.llm[model === 'fast' ? 'fastModel' : 'slowModel'],
      t(`council.members.modelTier.${model}`)].filter(Boolean).join(' · '),
  }));
  for (const connection of connections.data ?? []) {
    for (const model of ['fast', 'slow'] as const) options.push({
      value: `${connection.id}:${model}`, connectionId: connection.id, model,
      disabled: !connection.available || Boolean(connection.needsReentry),
      label: `${connection.name} · ${connection[model === 'fast' ? 'fastModel' : 'slowModel']} · ${t(`council.members.modelTier.${model}`)}${connection.available && !connection.needsReentry ? '' : ` (${t('council.members.unavailable')})`}`,
    });
  }
  return { options, loading: integration.isLoading || connections.isLoading,
    error: integration.error ?? connections.error,
    refetch: () => { void integration.refetch(); void connections.refetch(); } };
}
