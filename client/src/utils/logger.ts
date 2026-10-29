/**
 * @file utils/logger.ts
 * @description Minimal first-party logger.
 *
 * Replaces the platform toolkit logger: everything lands on the browser
 * console with a [squabble] prefix. Nothing is ever sent anywhere — no
 * remote logging, no telemetry (see docs/privacy.md).
 */

/* eslint-disable no-console */
export const logger = {
  debug(...args: unknown[]) {
    console.debug('[squabble]', ...args);
  },
  info(...args: unknown[]) {
    console.info('[squabble]', ...args);
  },
  warn(...args: unknown[]) {
    console.warn('[squabble]', ...args);
  },
  error(...args: unknown[]) {
    console.error('[squabble]', ...args);
  },
};

export default logger;
