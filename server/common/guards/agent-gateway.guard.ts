/**
 * AgentGatewayGuard
 *
 * Service-to-service authentication for the Python analysis agent.
 *
 * The browser-facing API authenticates a human session with a bearer JWT.
 * The optional Python agent calls the backend from another process and proves
 * its identity with a shared secret sent in the `x-agent-token` header.
 *
 * Routes under `/openapi/agent-gateway/*` are the only routes that accept this
 * credential. Browser authentication and this service credential are separate.
 *
 * Configuration (env):
 *  - AGENT_GATEWAY_ENABLED        Must be exactly "true" to enable the gateway.
 *  - AGENT_GATEWAY_TOKEN          Shared secret compared against x-agent-token.
 *  - AGENT_GATEWAY_DEFAULT_USER_ID Owner used when no x-agent-user-id is sent.
 *  - AGENT_GATEWAY_ALLOWED_USER_IDS Optional comma-separated whitelist; when set,
 *                                 an explicit x-agent-user-id must be in it.
 *
 * Security properties:
 *  - Disabled or unconfigured -> 404 (the surface behaves as if it does not
 *    exist, rather than advertising a forbidden endpoint).
 *  - Missing/wrong token -> 401.
 *  - Authenticated but the requested identity is not whitelisted -> 403.
 *  - The token is compared in constant time to avoid timing side channels.
 *  - The acting user is always resolved server-side; the caller cannot assume an
 *    arbitrary identity that is not in the configured whitelist.
 */
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

/** Identity attached to a request that passed the agent gateway guard. */
export interface AgentContext {
  /** Owner id the service is acting on behalf of. */
  userId: string;
  /** ISO timestamp of authentication (useful for audit logs). */
  authenticatedAt: string;
}

/** Express request augmented with the resolved service identity. */
export interface AgentGatewayRequest extends Request {
  agentContext?: AgentContext;
}

/** Constant-time string comparison that does not throw on length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) {
    // Still perform a comparison against a same-length buffer to avoid leaking
    // the length difference through timing; the result is false regardless.
    const dummy = Buffer.alloc(ab.length, 0);
    timingSafeEqual(ab, dummy);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/** Parses the optional comma-separated user whitelist, trimmed and de-duped. */
function parseAllowedUserIds(raw: string | undefined): string[] {
  if (!raw) return [];
  return Array.from(
    new Set(
      raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );
}

/**
 * Authenticates requests carrying the shared `x-agent-token` and resolves the
 * owner the agent is allowed to act on. Must be applied only to the
 * `/openapi/agent-gateway/*` controller.
 */
@Injectable()
export class AgentGatewayGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AgentGatewayRequest>();

    const enabled = process.env.AGENT_GATEWAY_ENABLED === 'true';
    const configuredToken = process.env.AGENT_GATEWAY_TOKEN;
    if (!enabled || !configuredToken) {
      // Hide the surface entirely when the gateway is switched off.
      throw new NotFoundException('Not Found');
    }

    const providedToken = req.headers['x-agent-token'];
    if (typeof providedToken !== 'string' || !providedToken) {
      throw new UnauthorizedException('missing agent token');
    }
    if (!safeEqual(providedToken, configuredToken)) {
      throw new UnauthorizedException('invalid agent token');
    }

    // Resolve the acting user. The trusted identity set is the explicit
    // whitelist if configured, otherwise just the single default user. This is
    // deny-by-default: a valid token never lets the caller assume an arbitrary
    // identity that is not explicitly trusted.
    const defaultUserId = process.env.AGENT_GATEWAY_DEFAULT_USER_ID;
    const whitelist = parseAllowedUserIds(process.env.AGENT_GATEWAY_ALLOWED_USER_IDS);
    const trustedUsers = whitelist.length > 0 ? whitelist : defaultUserId ? [defaultUserId] : [];
    const headerUserId = req.headers['x-agent-user-id'];
    let userId: string;
    if (typeof headerUserId === 'string' && headerUserId.trim()) {
      const candidate = headerUserId.trim();
      if (!trustedUsers.includes(candidate)) {
        throw new ForbiddenException('agent user not allowed');
      }
      userId = candidate;
    } else {
      if (!defaultUserId) {
        throw new UnauthorizedException('no agent user configured');
      }
      userId = defaultUserId;
    }

    req.agentContext = {
      userId,
      authenticatedAt: new Date().toISOString(),
    };
    return true;
  }
}
