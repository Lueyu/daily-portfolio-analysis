/**
 * @file types/index.ts
 * @brief Barrel re-export for shared TypeScript types.
 *
 * Consumers import from `@client/src/types` (or relative `../types`) so that
 * the location of individual type files can change without touching callers.
 */

// Re-export all shared domain types.
export * from './common';
