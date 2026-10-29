import type { Request as ExpressRequest } from 'express';

/**
 * Global Express request augmentation for Squabble's first-party auth.
 *
 * `userContext` is attached by the auth guard (see auth.guard.ts) for every
 * route decorated with `@NeedLogin()`; controllers derive the owning userId
 * from it. `__platform_data__` is kept as an optional field for the legacy
 * view controller locals.
 */
declare global {
  namespace Express {
    interface Request {
      userContext: { userId: string; username?: string };
      __platform_data__?: Record<string, unknown>;
    }
  }
}

export {};
