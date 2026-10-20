/**
 * @file rating-rules.ts
 * @description Pure post-processing rules for the Phase-5 rating decision.
 *
 * The LLM returns a rating, confidence and a free-text action. Two defensive
 * guards then apply, but historically the action text was saved verbatim, so a
 * rating could be capped to Hold while the action still said "buy" — a direct
 * contradiction visible on the holdings page.
 *
 * `finalizeRatingDecision` centralizes that logic and, crucially, reconciles the
 * action with the final rating. It is a pure function with no Nest / DB / LLM
 * dependencies so it can be unit tested in isolation.
 *
 * Rules (in order):
 *   1. An unknown rating is clamped to Watch.
 *   2. A failed HARD risk rule caps buy-side ratings (Buy / Strong Buy) at Hold.
 *      Sell-side ratings are intentionally preserved — a hard failure must not
 *      block de-risking.
 *   3. Low confidence forbids directional calls (Buy / Sell / Strong Buy /
 *      Strong Sell), downgrading them to Watch.
 *   4. Whenever the rating is capped/downgraded, an action that still points in
 *      the forbidden direction is rewritten to a neutral instruction; the
 *      original model text is returned for audit.
 */
import type { AgentRating, AgentConfidence } from '@shared/api.interface';

const VALID_RATINGS: AgentRating[] = ['Strong Buy', 'Buy', 'Hold', 'Sell', 'Strong Sell', 'Watch'];
const VALID_CONFIDENCE: AgentConfidence[] = ['high', 'medium', 'low'];

const BUY_SIDE: AgentRating[] = ['Strong Buy', 'Buy'];
const DIRECTIONAL: AgentRating[] = ['Strong Buy', 'Buy', 'Sell', 'Strong Sell'];

/** Chinese action verbs that express opening or adding to a long position. */
const BUY_WORDS = ['买入', '加仓', '建仓', '补仓', '增持', '抄底', '买进'];
/** Chinese action verbs that express reducing or exiting a position. */
const SELL_WORDS = ['卖出', '减仓', '清仓', '减持', '止盈', '止损'];

export type RatingOverrideReason = 'unknown-rating' | 'hard-risk-gate' | 'low-confidence';

export interface FinalizeRatingInput {
  /** Raw rating string from the LLM JSON (may be missing or invalid). */
  rating: string | null | undefined;
  /** Raw confidence string from the LLM JSON (defaults to low when missing). */
  confidence: string | null | undefined;
  /** Raw free-text action instruction from the LLM JSON. */
  action: string | null | undefined;
  /** Whether any hard strategy rule failed in Phase 4. */
  hasHardFailure: boolean;
}

export interface FinalizeRatingResult {
  /** The rating after every guard is applied. */
  rating: AgentRating;
  /** Normalized confidence (one of high / medium / low). */
  confidence: AgentConfidence;
  /** Action text guaranteed not to contradict the final rating. */
  action: string;
  /** The model's rating when it was a valid enum, otherwise null. */
  originalRating: AgentRating | null;
  /** The model's original, unmodified action text. */
  originalAction: string;
  /** Which guards fired, in application order. */
  overrideReasons: RatingOverrideReason[];
  /** True when the rating or action was changed by the guards. */
  changed: boolean;
}

function containsAny(text: string, words: string[]): boolean {
  return words.some((w) => text.includes(w));
}

/**
 * Apply the hard-gate / low-confidence / unknown-rating guards and keep the
 * saved action consistent with the resulting rating.
 */
export function finalizeRatingDecision(input: FinalizeRatingInput): FinalizeRatingResult {
  const overrideReasons: RatingOverrideReason[] = [];
  const originalAction = input.action ? String(input.action).trim() : '';

  const rawRating = String(input.rating ?? 'Watch').trim();
  const originalRating = VALID_RATINGS.includes(rawRating as AgentRating) ? (rawRating as AgentRating) : null;
  let rating: AgentRating = originalRating ?? 'Watch';
  if (!originalRating) {
    overrideReasons.push('unknown-rating');
  }

  const rawConfidence = String(input.confidence ?? 'low').trim().toLowerCase();
  const confidence: AgentConfidence = VALID_CONFIDENCE.includes(rawConfidence as AgentConfidence)
    ? (rawConfidence as AgentConfidence)
    : 'low';

  // Guard #1: a hard risk-gate failure caps buy-side ratings at Hold. Sell-side
  // ratings are left untouched (de-risking is always allowed).
  if (input.hasHardFailure && BUY_SIDE.includes(rating)) {
    rating = 'Hold';
    overrideReasons.push('hard-risk-gate');
  }

  // Guard #2: low confidence forbids directional calls. Applied after the hard
  // gate, so a capped Hold is not downgraded again (Hold is not directional).
  if (confidence === 'low' && DIRECTIONAL.includes(rating)) {
    rating = 'Watch';
    overrideReasons.push('low-confidence');
  }

  // Reconcile the action with the final rating. Only rewrite when the model's
  // text still points in a direction the final rating forbids.
  let action = originalAction;
  const hasBuy = containsAny(originalAction, BUY_WORDS);
  const hasSell = containsAny(originalAction, SELL_WORDS);

  if (rating === 'Hold' && overrideReasons.includes('hard-risk-gate') && hasBuy) {
    // Wording deliberately avoids buy/sell verbs so it can never be read as a
    // directional instruction.
    action = '持有观望（风控硬规则未通过，暂不新增仓位）';
  } else if (rating === 'Watch' && hasBuy) {
    if (overrideReasons.includes('low-confidence')) {
      action = '暂不操作，观望（置信度不足）';
    } else if (overrideReasons.includes('unknown-rating')) {
      action = '暂不操作，观望（评级结果无效）';
    }
  } else if (rating === 'Watch' && hasSell && overrideReasons.includes('low-confidence')) {
    action = '暂不操作，观望（置信度不足）';
  }

  const changed = overrideReasons.length > 0 || action !== originalAction;

  return {
    rating,
    confidence,
    action,
    originalRating,
    originalAction,
    overrideReasons,
    changed,
  };
}
