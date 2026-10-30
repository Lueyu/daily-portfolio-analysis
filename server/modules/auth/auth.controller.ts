/**
 * Auth controller — register / login / refresh / me.
 *
 * None of these routes are `@NeedLogin()`-decorated except `me`; the global
 * guard verifies the Bearer token and attaches `req.userContext` there.
 */
import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { NeedLogin } from '../../common/platform/need-login.decorator';
import { AuthService } from './auth.service';
import { AuthRateLimiter } from './auth-rate-limiter';

@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService, private readonly limiter: AuthRateLimiter) {}

  /** Create an account. Disabled entirely when REGISTER_ENABLED=false. */
  @Post('register')
  async register(
    @Req() request: Request,
    @Body() body: { username?: string; password?: string; displayName?: string },
  ) {
    this.limiter.consume(request, 'register');
    return this.authService.register({
      username: body.username ?? '',
      password: body.password ?? '',
      displayName: body.displayName,
    });
  }

  /** Log in with username + password. */
  @Post('login')
  async login(@Req() request: Request, @Body() body: { username?: string; password?: string }) {
    this.limiter.consume(request, 'login');
    return this.authService.login({
      username: body.username ?? '',
      password: body.password ?? '',
    });
  }

  /** Exchange a refresh token for a fresh token pair. */
  @Post('refresh')
  async refresh(@Req() request: Request, @Body() body: { refreshToken?: string }) {
    this.limiter.consume(request, 'refresh');
    return this.authService.refresh(body.refreshToken);
  }

  /** Replace a forgotten password using the offline code issued at registration. */
  @Post('recover')
  async recover(@Req() request: Request, @Body() body: { username?: string; recoveryCode?: string; newPassword?: string }) {
    this.limiter.consume(request, 'recover');
    return this.authService.recoverAccount(body);
  }

  @NeedLogin()
  @Post('recovery-code')
  async recoveryCode(@Req() request: Request, @Body() body: { password?: string }) {
    this.limiter.consume(request, 'recover');
    return this.authService.rotateRecoveryCode(request.userContext.userId, body.password ?? '');
  }

  /** Profile of the caller (used by the layout user menu). */
  @NeedLogin()
  @Get('me')
  async me(@Req() req: Request) {
    return this.authService.getProfile(req.userContext.userId);
  }
}
