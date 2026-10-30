/** Public contracts for bounded, user-owned investment research. */
export interface LlmBudgetSettings {
  dailyTokenLimit: number;
  monthlyTokenLimit: number;
  perTaskTokenLimit: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxCallsPerTask: number;
  dailyCallLimit: number;
  /** Optional user-supplied conservative rates; estimates, not provider billing. */
  inputUsdPerMillion: number | null;
  outputUsdPerMillion: number | null;
}

export interface LlmBudgetUsage {
  settings: LlmBudgetSettings;
  dayTokens: number;
  monthTokens: number;
  dayCalls: number;
  reservedTokens: number;
  estimatedCostUsd: number | null;
  recent: Array<{
    id: string; purpose: string; model: string; taskId: string;
    inputTokens: number; outputTokens: number; chargedTokens: number;
    status: string; createdAt: string;
  }>;
}

export type CouncilRole = 'researcher' | 'challenger' | 'manager';
export interface CouncilMember {
  id: string;
  role: CouncilRole;
  name: string;
  instructions: string;
  model: 'fast' | 'slow';
}
export interface CouncilConfig { enabled: boolean; members: CouncilMember[] }
export interface TradingCadence {
  reviewEveryTradingDays: number;
  maxOrdersPerWeek: number;
  cooldownTradingDays: number;
  maxWeeklyTurnoverPct: number;
}
export interface CouncilCandidate {
  ticker: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  reason: string;
}
export interface CouncilMessage {
  id: string;
  role: CouncilRole | 'user' | 'system';
  memberName: string;
  content: string;
  revision: number;
  tokensUsed: number;
  createdAt: string;
}
export interface CouncilReport {
  id: string;
  version: number;
  revision: number;
  decision: 'approve' | 'wait' | 'reject';
  summary: string;
  dissent: string[];
  nextReviewCondition: string;
  evidence: Array<{ id: string; title: string; content: string; sourceUrl: string | null; fetchedAt: string }>;
  sourceRunId: string | null;
  candidate: CouncilCandidate | null;
  paperOrderId: string | null;
  tokensUsed: number;
  engine: 'basic' | 'llm';
  createdAt: string;
}
export interface CouncilSession {
  id: string;
  profileId: string;
  profileVersion: number;
  ticker: string;
  language: 'zh-CN' | 'en';
  status: 'idle' | 'running' | 'completed' | 'paused' | 'failed';
  revision: number;
  messages: CouncilMessage[];
  reports: CouncilReport[];
  error: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface CouncilReviewResult {
  approved: boolean;
  reason: string;
  sessionId: string;
  reportId: string | null;
}
