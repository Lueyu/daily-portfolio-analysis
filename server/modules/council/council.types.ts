import type { CouncilMessage, CouncilPhase, CouncilResearchKind } from '@shared/council.interface';
import type { CouncilEvidence } from './council.rules';

export interface DialogueTurn { memberId: string; phase: Exclude<CouncilPhase, 'progress'> }
export interface ResearchRequest { kind: CouncilResearchKind; query?: string }
export interface CouncilCheckpoint {
  cycleId: string;
  turns: DialogueTurn[];
  nextTurn: number;
  toolKindsUsed: CouncilResearchKind[];
  pendingResearch: ResearchRequest[];
  evidenceArchive?: CouncilEvidence[];
  inflight?: { id: string; turn: number; revision: number };
}
export interface CouncilMessageMetadata extends Pick<CouncilMessage,
  'memberId' | 'phase' | 'replyToMessageId' | 'evidenceIds' | 'reasoningSummary' | 'questions' | 'acquisition'> {
  cycleId?: string;
  turn?: number;
}
