import { Inject, Injectable, BadRequestException } from '@nestjs/common';
import { eq, and, sql } from 'drizzle-orm';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';

import { cashAccounts } from '@server/database/schema';
import type { CashAccount, Currency } from '@shared/api.interface';

const ALL_CURRENCIES: Currency[] = ['USD', 'HKD', 'CNY'];

@Injectable()
export class CashAccountsService {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async list(userId: string): Promise<CashAccount[]> {
    await this.ensureAccounts(userId);
    const rows = await this.db
      .select()
      .from(cashAccounts)
      .where(eq(cashAccounts.owner, userId))
      .orderBy(cashAccounts.currency);
    return rows.map((r) => this.mapRow(r));
  }

  async getBalance(userId: string, currency: string): Promise<string> {
    await this.ensureAccounts(userId);
    const rows = await this.db
      .select()
      .from(cashAccounts)
      .where(and(eq(cashAccounts.owner, userId), eq(cashAccounts.currency, currency)));
    if (rows.length === 0) return '0';
    return rows[0].balance;
  }

  async adjust(
    userId: string,
    currency: string,
    delta: number,
    _reason?: string,
  ): Promise<CashAccount> {
    await this.ensureAccounts(userId);

    // 余额减少时，先校验余额充足
    if (delta < 0) {
      const current = await this.getBalance(userId, currency);
      if (Number(current) + delta < 0) {
        throw new BadRequestException('现金不足');
      }
    }

    const rows = await this.db
      .update(cashAccounts)
      .set({
        balance: sql`${cashAccounts.balance} + ${delta}::numeric`,
      })
      .where(and(eq(cashAccounts.owner, userId), eq(cashAccounts.currency, currency)))
      .returning();

    if (rows.length === 0) {
      throw new BadRequestException('账户不存在');
    }

    return this.mapRow(rows[0]);
  }

  async ensureAccounts(userId: string): Promise<void> {
    const values = ALL_CURRENCIES.map((currency: Currency) => ({
      currency,
      balance: '0',
      owner: userId,
      createdBy: userId,
      updatedBy: userId,
    }));

    await this.db
      .insert(cashAccounts)
      .values(values)
      .onConflictDoNothing();
  }

  private mapRow(row: typeof cashAccounts.$inferSelect): CashAccount {
    return {
      id: row.id,
      currency: row.currency as Currency,
      balance: row.balance,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
