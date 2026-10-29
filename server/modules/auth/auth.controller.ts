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

@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /** Create an account. Disabled entirely when REGISTER_ENABLED=false. */
  @Post('register')
  async register(
    @Body() body: { username?: string; password?: string; displayName?: string },
  ) {
    return this.authService.register({
      username: body.username ?? '',
      password: body.password ?? '',
      displayName: body.displayName,
    });
  }

  /** Log in with username + password. */
  @Post('login')
  async login(@Body() body: { username?: string; password?: string }) {
    return this.authService.login({
      username: body.username ?? '',
      password: body.password ?? '',
    });
  }

  /** Exchange a refresh token for a fresh token pair. */
  @Post('refresh')
  async refresh(@Body() body: { refreshToken?: string }) {
    return this.authService.refresh(body.refreshToken);
  }

  /** Profile of the caller (used by the layout user menu). */
  @NeedLogin()
  @Get('me')
  async me(@Req() req: Request) {
    return this.authService.getProfile(req.userContext.userId);
  }
}
