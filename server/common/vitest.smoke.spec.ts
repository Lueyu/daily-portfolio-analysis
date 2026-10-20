import { describe, expect, it } from 'vitest';

/**
 * Test harness bootstrap check.
 *
 * Confirms Vitest can execute TypeScript (including async) in the Node
 * environment. Real business-rule tests live next to the code they cover,
 * starting with `server/modules/multi-agent/rating-rules.spec.ts`.
 *
 * This file doubles as a quick "is the test runner healthy" smoke check and
 * is safe to keep.
 */
describe('vitest bootstrap', () => {
  it('runs TypeScript assertions', () => {
    const isEven = (n: number): boolean => n % 2 === 0;
    expect(isEven(4)).toBe(true);
    expect(isEven(5)).toBe(false);
  });

  it('supports async tests', async () => {
    const value = await Promise.resolve('ok');
    expect(value).toBe('ok');
  });
});
