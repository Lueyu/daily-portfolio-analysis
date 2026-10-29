/**
 * Global auth guard.
 *
 * Runs before every route. Routes decorated with `@NeedLogin()` must carry a
 * valid `Authorization: Bearer <accessToken>` header; the verified identity is
 * attached as `req.userContext` for controllers. Undecorated routes (auth
 * endpoints, the SPA shell, the agent gateway with its own token guard)
 * pass through untouched.
 */
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { NEED_LOGIN_KEY } from './need-login.decorator';
import { verifyAccessToken } from '../../modules/auth/jwt';

@Injectable()
export class AuthGlobalGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const needLogin = this.reflector.getAllAndOverride<boolean>(NEED_LOGIN_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const req = context.switchToHttp().getRequest<Request>();
    if (!needLogin) return true;

    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('未登录');
    }
    const payload = verifyAccessToken(header.slice('Bearer '.length));
    if (!payload) {
      throw new UnauthorizedException('登录已过期，请重新登录');
    }
    req.userContext = { userId: payload.sub, username: payload.username };
    return true;
  }
}
