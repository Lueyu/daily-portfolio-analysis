/**
 * LocalDevAuthMiddleware
 *
 * Offline development only — never active in the managed cloud.
 *
 * In production the API gateway authenticates the user and injects an
 * `x-larkgw-suda-webuser` request header (URI-encoded JSON). The platform
 * `UserContextMiddleware` decodes it into `req.userContext`; the `@NeedLogin()`
 * guard then passes and the datapaas SQL context sets `app.user_id` /
 * `SET LOCAL ROLE authenticated_<schema>`.
 *
 * A local server has no gateway, so that header is missing: every protected
 * route returns 401 ("未登录") and the SQL context has no user id. When
 * `LOCAL_DEV_USER_ID` is set, this middleware fabricates the gateway header for
 * a fixed local user, so the full stack (login guard + owner-scoped data) works
 * offline against the local PostgreSQL snapshot.
 *
 * Safety:
 *  - Completely inert when LOCAL_DEV_USER_ID is unset (production default).
 *  - Never overrides a real gateway-provided header.
 *  - Inject it BEFORE the platform middlewares (see main.ts), so the standard
 *    UserContextMiddleware parses it exactly as it would in the cloud.
 */
import type { Request, Response, NextFunction } from 'express';

export function localDevAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const localUserId = process.env.LOCAL_DEV_USER_ID;
  if (!localUserId) {
    next();
    return;
  }
  // Never clobber a real identity injected by the gateway / dev proxy.
  if (req.headers['x-larkgw-suda-webuser']) {
    next();
    return;
  }

  const webuser = {
    user_id: localUserId,
    tenant_id: process.env.LOCAL_DEV_TENANT_ID || 'local-tenant',
    app_id: process.env.LOCAL_DEV_APP_ID || 'app_local',
    user_type: 'user',
    is_system_account: false,
    login_url: '',
    env: 'runtime',
    user_name: { zh_cn: 'Local Dev', en_us: 'Local Dev' },
    roles: [] as string[],
  };
  req.headers['x-larkgw-suda-webuser'] = encodeURIComponent(
    JSON.stringify(webuser),
  );
  // Local/offline mode implies a custom (non-platform) host: the platform
  // view-context middleware then resolves the SPA basename to "/" instead of
  // the platform prefix /app/<appId> (resolveBasename in the platform core).
  if (req.headers['x-miaoda-custom-host'] === undefined) {
    req.headers['x-miaoda-custom-host'] = 'local-dev';
  }
  next();
}
