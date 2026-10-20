import { describe, it, expect } from 'vitest';
import { finalizeRatingDecision } from './rating-rules';

const BUY_WORDS = /买入|加仓|建仓|补仓|增持|抄底|买进/;
const SELL_WORDS = /卖出|减仓|清仓|减持|止盈|止损/;

describe('finalizeRatingDecision', () => {
  describe('no override', () => {
    it('keeps a high-confidence Buy untouched when every hard rule passes', () => {
      const out = finalizeRatingDecision({
        rating: 'Buy',
        confidence: 'high',
        action: '逢低买入，目标价 540',
        hasHardFailure: false,
      });
      expect(out.rating).toBe('Buy');
      expect(out.confidence).toBe('high');
      expect(out.action).toBe('逢低买入，目标价 540');
      expect(out.changed).toBe(false);
      expect(out.overrideReasons).toEqual([]);
    });

    it('keeps Hold and Sell as-is when there is nothing to reconcile', () => {
      expect(
        finalizeRatingDecision({ rating: 'Hold', confidence: 'medium', action: '持有观望', hasHardFailure: false }).rating,
      ).toBe('Hold');
      expect(
        finalizeRatingDecision({ rating: 'Sell', confidence: 'high', action: '减仓一半', hasHardFailure: false }).rating,
      ).toBe('Sell');
    });
  });

  describe('hard risk-gate cap', () => {
    it('caps Buy at Hold and removes the buy intent from the action', () => {
      const out = finalizeRatingDecision({
        rating: 'Buy',
        confidence: 'high',
        action: '逢低买入、可加仓',
        hasHardFailure: true,
      });
      expect(out.rating).toBe('Hold');
      expect(out.action).not.toMatch(BUY_WORDS);
      expect(out.overrideReasons).toContain('hard-risk-gate');
      expect(out.changed).toBe(true);
      // original model text is retained for audit
      expect(out.originalAction).toBe('逢低买入、可加仓');
    });

    it('caps Strong Buy at Hold on a hard failure', () => {
      const out = finalizeRatingDecision({
        rating: 'Strong Buy',
        confidence: 'high',
        action: '重仓买入',
        hasHardFailure: true,
      });
      expect(out.rating).toBe('Hold');
      expect(out.action).not.toMatch(BUY_WORDS);
    });

    it('preserves Sell when a hard rule fails (de-risking must not be blocked)', () => {
      const out = finalizeRatingDecision({
        rating: 'Sell',
        confidence: 'high',
        action: '减仓一半',
        hasHardFailure: true,
      });
      expect(out.rating).toBe('Sell');
      expect(out.action).toBe('减仓一半');
      expect(out.overrideReasons).not.toContain('hard-risk-gate');
    });

    it('preserves Strong Sell when a hard rule fails', () => {
      const out = finalizeRatingDecision({
        rating: 'Strong Sell',
        confidence: 'high',
        action: '立即清仓',
        hasHardFailure: true,
      });
      expect(out.rating).toBe('Strong Sell');
      expect(out.action).toBe('立即清仓');
    });

    it('keeps a non-contradictory action when capping Buy to Hold', () => {
      // The model already said "持有" even though it rated Buy; nothing to rewrite.
      const out = finalizeRatingDecision({
        rating: 'Buy',
        confidence: 'high',
        action: '持有，暂不新增',
        hasHardFailure: true,
      });
      expect(out.rating).toBe('Hold');
      expect(out.action).toBe('持有，暂不新增');
    });
  });

  describe('low confidence downgrade', () => {
    it('downgrades Buy to Watch and neutralizes the action when confidence is low', () => {
      const out = finalizeRatingDecision({
        rating: 'Buy',
        confidence: 'low',
        action: '逢低买入',
        hasHardFailure: false,
      });
      expect(out.rating).toBe('Watch');
      expect(out.action).not.toMatch(BUY_WORDS);
      expect(out.action).not.toMatch(SELL_WORDS);
      expect(out.overrideReasons).toContain('low-confidence');
    });

    it('downgrades Sell to Watch on low confidence', () => {
      const out = finalizeRatingDecision({
        rating: 'Sell',
        confidence: 'low',
        action: '减仓',
        hasHardFailure: false,
      });
      expect(out.rating).toBe('Watch');
      expect(out.action).not.toMatch(SELL_WORDS);
    });

    it('lets the hard gate take precedence over the low-confidence downgrade', () => {
      const out = finalizeRatingDecision({
        rating: 'Buy',
        confidence: 'low',
        action: '加仓',
        hasHardFailure: true,
      });
      expect(out.rating).toBe('Hold');
      expect(out.overrideReasons).toContain('hard-risk-gate');
    });
  });

  describe('defensive defaults', () => {
    it('clamps an unknown rating to Watch', () => {
      const out = finalizeRatingDecision({
        rating: 'Strong Hold!!!',
        confidence: 'high',
        action: '买入',
        hasHardFailure: false,
      });
      expect(out.rating).toBe('Watch');
      expect(out.overrideReasons).toContain('unknown-rating');
      expect(out.action).not.toMatch(BUY_WORDS);
    });

    it('treats a missing confidence as low and a missing rating as Watch', () => {
      const out = finalizeRatingDecision({
        rating: undefined,
        confidence: undefined,
        action: '',
        hasHardFailure: false,
      });
      expect(out.rating).toBe('Watch');
      expect(out.confidence).toBe('low');
    });

    it('never returns a directional action that contradicts the final rating', () => {
      const cases: Array<{ rating: string; confidence: string; action: string; hard: boolean }> = [
        { rating: 'Buy', confidence: 'high', action: '逢低买入', hard: true },
        { rating: 'Strong Buy', confidence: 'high', action: '建仓', hard: true },
        { rating: 'Buy', confidence: 'low', action: '加仓', hard: false },
        { rating: 'Sell', confidence: 'low', action: '清仓', hard: false },
      ];
      for (const c of cases) {
        const out = finalizeRatingDecision({
          rating: c.rating,
          confidence: c.confidence,
          action: c.action,
          hasHardFailure: c.hard,
        });
        if (out.rating === 'Hold' || out.rating === 'Watch') {
          expect(out.action).not.toMatch(BUY_WORDS);
        }
        if (out.rating === 'Watch') {
          expect(out.action).not.toMatch(SELL_WORDS);
        }
      }
    });
  });
});
