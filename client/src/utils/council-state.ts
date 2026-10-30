import type {
  CouncilConfig, CouncilMessage, CouncilReport, CouncilSession, LlmBudgetSettings, TradingCadence,
} from '@shared/council.interface';

export const DEFAULT_CADENCE: TradingCadence = {
  reviewEveryTradingDays: 5, maxOrdersPerWeek: 2,
  cooldownTradingDays: 3, maxWeeklyTurnoverPct: 10,
};

/** A message never resumes a paused/failed room or starts a second active run. */
export function shouldStartCouncilAfterMessage(
  previousStatus: CouncilSession['status'], savedStatus: CouncilSession['status'],
): boolean {
  return (previousStatus === 'idle' || previousStatus === 'completed') && savedStatus === 'idle';
}

export function shouldSendCouncilMessage(event: {
  key: string; shiftKey: boolean; isComposing: boolean; keyCode: number;
}): boolean {
  return event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229;
}

const EVIDENCE_UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const INTERNAL_EVIDENCE_LINE = new RegExp(`^\\s*\\[\\s*${EVIDENCE_UUID}(?:\\s*,\\s*${EVIDENCE_UUID})*\\s*\\]\\s*$`, 'iu');

/** Legacy AI replies included internal IDs; source details remain in the report. */
export function councilMessageDisplayContent(message: Pick<CouncilMessage, 'role' | 'content'>): string {
  if (message.role === 'user' || message.role === 'system') return message.content;
  return message.content.split('\n').filter((line: string) => !INTERNAL_EVIDENCE_LINE.test(line)).join('\n');
}

export function isCurrentCouncilReport(
  report: CouncilReport, session: CouncilSession, profileVersion?: number,
): boolean {
  return report.revision === session.revision
    && (profileVersion === undefined || session.profileVersion === profileVersion)
    && !session.reports.some((item: CouncilReport) => item.version > report.version);
}

export function budgetPercent(used: number, limit: number): number {
  return limit > 0 ? Math.max(0, Math.min(100, used / limit * 100)) : 0;
}

export function validateCouncilSettings(
  council: CouncilConfig | undefined, cadence: TradingCadence | undefined,
): 'teamInvalid' | 'cadenceInvalid' | null {
  if (council?.enabled) {
    const members = council.members;
    if (members.length !== 3 || new Set(members.map((member) => member.role)).size !== 3
      || new Set(members.map((member) => member.id)).size !== 3
      || members.some((member) => !member.name.trim() || member.name.length > 40
        || member.instructions.length > 1000)) return 'teamInvalid';
  }
  if (cadence && (!Number.isInteger(cadence.reviewEveryTradingDays)
    || cadence.reviewEveryTradingDays < 1 || cadence.reviewEveryTradingDays > 60
    || !Number.isInteger(cadence.maxOrdersPerWeek)
    || cadence.maxOrdersPerWeek < 1 || cadence.maxOrdersPerWeek > 20
    || !Number.isInteger(cadence.cooldownTradingDays)
    || cadence.cooldownTradingDays < 0 || cadence.cooldownTradingDays > 60
    || !Number.isFinite(cadence.maxWeeklyTurnoverPct)
    || cadence.maxWeeklyTurnoverPct < 0.1 || cadence.maxWeeklyTurnoverPct > 100)) {
    return 'cadenceInvalid';
  }
  return null;
}

export function validateBudget(settings: LlmBudgetSettings): string | null {
  const caps: number[] = [settings.dailyTokenLimit, settings.monthlyTokenLimit,
    settings.perTaskTokenLimit, settings.maxInputTokens, settings.maxOutputTokens,
    settings.maxCallsPerTask, settings.dailyCallLimit];
  if (caps.some((value: number) => !Number.isSafeInteger(value) || value <= 0)) return 'invalid';
  if (Math.max(settings.dailyTokenLimit, settings.monthlyTokenLimit, settings.perTaskTokenLimit) > 1e9
    || Math.max(settings.maxInputTokens, settings.maxOutputTokens) > 1e6
    || settings.maxCallsPerTask > 10000 || settings.dailyCallLimit > 100000) return 'invalid';
  if ([settings.inputUsdPerMillion, settings.outputUsdPerMillion].some(
    (value: number | null) => value !== null && (!Number.isFinite(value) || value < 0 || value > 100000),
  )) return 'priceInvalid';
  if (settings.maxInputTokens + settings.maxOutputTokens > settings.perTaskTokenLimit
    || settings.perTaskTokenLimit > settings.dailyTokenLimit
    || settings.dailyTokenLimit > settings.monthlyTokenLimit
    || settings.maxCallsPerTask > settings.dailyCallLimit) return 'inconsistent';
  return null;
}
