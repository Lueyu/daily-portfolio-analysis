/**
 * Auth service — first-party accounts.
 *
 * Privacy posture (see docs/privacy.md): an account is nothing more than a
 * username and a bcrypt password hash. No phone number, no email
 * verification; `emailNotify` is an optional free-text field the user may
 * fill for notification routing and is never required or validated against
 * anything.
 *
 * Registration can be closed via REGISTER_ENABLED=false for private
 * deployments.
 */
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '../../common/platform/database.provider';
import { agentSessions, users } from '../../database/schema';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from './jwt';

/** Shape returned by register/login/refresh. */
export interface AuthResult {
  user: { id: string; username: string; displayName: string | null };
  accessToken: string;
  refreshToken: string;
  recoveryCode?: string;
}

function recoveryHash(code: string): string {
  return createHash('sha256').update(code.toLowerCase()).digest('hex');
}

/** Username rules: 2-32 chars of letters/digits/._- */
const USERNAME_PATTERN = /^[a-zA-Z0-9_.-]{2,32}$/;

function normalizeUsername(raw: string): string {
  const username = (raw ?? '').trim().toLowerCase();
  if (!USERNAME_PATTERN.test(username)) {
    throw new BadRequestException('Username must be 2-32 letters, digits, or . _ -');
  }
  return username;
}

function validatePassword(raw: string): void {
  if (typeof raw !== 'string' || raw.length < 12 || raw.length > 128) {
    throw new BadRequestException('Password must be 12-128 characters');
  }
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  /** Create an account and issue tokens. Registration may be disabled by env. */
  async register(input: {
    username: string;
    password: string;
    displayName?: string;
  }): Promise<AuthResult> {
    if (process.env.REGISTER_ENABLED === 'false') {
      throw new BadRequestException('Registration is disabled on this instance');
    }
    const username = normalizeUsername(input.username);
    validatePassword(input.password);

    const [existing] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, username));
    if (existing) {
      throw new ConflictException('Username is already taken');
    }

    const passwordHash = await bcrypt.hash(input.password, 10);
    const recoveryCode = randomBytes(24).toString('hex');
    const [created] = await this.db
      .insert(users)
      .values({
        username,
        passwordHash,
        recoveryCodeHash: recoveryHash(recoveryCode),
        displayName: input.displayName?.trim() || username,
      })
      .returning({ id: users.id, username: users.username, displayName: users.displayName, sessionVersion: users.sessionVersion });

    return { ...this.issueTokens(created), recoveryCode };
  }

  /** Verify credentials and issue tokens. */
  async login(input: { username: string; password: string }): Promise<AuthResult> {
    const username = normalizeUsername(input.username);
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.username, username));
    if (!user) {
      throw new UnauthorizedException('Invalid username or password');
    }
    const ok = await bcrypt.compare(input.password ?? '', user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Invalid username or password');
    }
    return this.issueTokens({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      sessionVersion: user.sessionVersion,
    });
  }

  /** One-time offline recovery code replaces the password and all prior sessions. */
  async recoverAccount(input: { username?: string; recoveryCode?: string; newPassword?: string }): Promise<AuthResult> {
    const code = input.recoveryCode?.trim() ?? '';
    if (!/^[a-fA-F0-9]{48}$/.test(code)) throw new UnauthorizedException('Invalid recovery code');
    validatePassword(input.newPassword ?? '');
    const username = normalizeUsername(input.username ?? '');
    const [user] = await this.db.select().from(users).where(eq(users.username, username));
    if (!user?.recoveryCodeHash || user.recoveryCodeHash !== recoveryHash(code)) {
      throw new UnauthorizedException('Invalid recovery code');
    }
    const passwordHash = await bcrypt.hash(input.newPassword!, 10);
    const nextCode = randomBytes(24).toString('hex');
    return this.db.transaction(async (tx) => {
      const [updated] = await tx.update(users).set({
        passwordHash,
        recoveryCodeHash: recoveryHash(nextCode),
        sessionVersion: user.sessionVersion + 1,
        updatedAt: new Date(),
      }).where(and(eq(users.id, user.id), eq(users.recoveryCodeHash, user.recoveryCodeHash)))
        .returning({ id: users.id, username: users.username, displayName: users.displayName, sessionVersion: users.sessionVersion });
      if (!updated) throw new UnauthorizedException('Invalid recovery code');
      await tx.update(agentSessions).set({ status: 'revoked', updatedAt: new Date() })
        .where(eq(agentSessions.owner, user.id));
      return { ...this.issueTokens(updated), recoveryCode: nextCode };
    });
  }

  /** Let an existing signed-in user create or rotate an offline recovery code. */
  async rotateRecoveryCode(userId: string, password: string): Promise<AuthResult> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!user || !await bcrypt.compare(password ?? '', user.passwordHash)) {
      throw new UnauthorizedException('Invalid password');
    }
    const code = randomBytes(24).toString('hex');
    const [updated] = await this.db.update(users).set({
      recoveryCodeHash: recoveryHash(code),
      sessionVersion: user.sessionVersion + 1,
      updatedAt: new Date(),
    }).where(and(eq(users.id, user.id), eq(users.sessionVersion, user.sessionVersion)))
      .returning({ id: users.id, username: users.username, displayName: users.displayName, sessionVersion: users.sessionVersion });
    if (!updated) throw new UnauthorizedException('Please sign in again');
    return { ...this.issueTokens(updated), recoveryCode: code };
  }

  /** Rotate tokens from a valid refresh token. */
  async refresh(refreshToken: string | undefined): Promise<AuthResult> {
    if (!refreshToken) {
      throw new UnauthorizedException('Missing refresh token');
    }
    const payload = verifyRefreshToken(refreshToken);
    if (!payload) {
      throw new UnauthorizedException('Refresh token is invalid or expired');
    }
    const [user] = await this.db
      .select({ id: users.id, username: users.username, displayName: users.displayName, sessionVersion: users.sessionVersion })
      .from(users)
      .where(and(eq(users.id, payload.sub), eq(users.username, payload.username)));
    if (!user || (payload.ver ?? 0) !== user.sessionVersion) {
      throw new UnauthorizedException('Refresh token is invalid or expired');
    }
    return this.issueTokens(user);
  }

  /** Load the profile behind an access token. */
  async getProfile(userId: string): Promise<{
    id: string;
    username: string;
    displayName: string | null;
    emailNotify: string | null;
  }> {
    const [user] = await this.db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        emailNotify: users.emailNotify,
      })
      .from(users)
      .where(eq(users.id, userId));
    if (!user) {
      throw new NotFoundException('Account not found');
    }
    return user;
  }

  private issueTokens(user: {
    id: string;
    username: string;
    displayName: string | null;
    sessionVersion: number;
  }): AuthResult {
    return {
      user: { id: user.id, username: user.username, displayName: user.displayName },
      accessToken: signAccessToken({ id: user.id, username: user.username, sessionVersion: user.sessionVersion }),
      refreshToken: signRefreshToken({ id: user.id, username: user.username, sessionVersion: user.sessionVersion }),
    };
  }
}
