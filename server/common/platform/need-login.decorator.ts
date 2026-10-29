/**
 * NeedLogin route decorator.
 *
 * Marks a controller or handler as requiring an authenticated user. The global
 * auth guard (auth.guard.ts) reads this metadata, verifies the Bearer JWT and
 * attaches `req.userContext` before the handler runs.
 */
import { SetMetadata } from '@nestjs/common';

/** Metadata key scanned by the global auth guard. */
export const NEED_LOGIN_KEY = 'sq:need-login';

/**
 * Decorate a controller or route with `@NeedLogin()` to require a valid
 * session. Handlers receive the caller identity via `req.userContext.userId`.
 */
export const NeedLogin = (): MethodDecorator & ClassDecorator =>
  SetMetadata(NEED_LOGIN_KEY, true) as MethodDecorator & ClassDecorator;
