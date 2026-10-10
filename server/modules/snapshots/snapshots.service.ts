import { Injectable, Inject, Logger, NotFoundException, forwardRef } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { eq, and, desc, sql } from 'drizzle-orm';
import { snapshots, transactions } from '@server/database/schema';
import type { Snapshot, CreateSnapshotDto, ListResponse } from '@shared/api.interface';
import { FxService } from '../fx/fx.service';

const AUTO_DEPOSIT_MARKER = '__AUTO_DEPOSIT_FOR_BUY__';

interface NetDepositByCurrency {
  USD: number;
  HKD: number;
  CNY: number;
  [key: string]: number;
}

@Injectable()
export class SnapshotsService {
  private readonly logger = new Logger(SnapshotsService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    @Inject(forwardRef(() => FxService)) private readonly fxService: FxService,
  ) {}

  async list(userId: string, limit = 90): Promise<ListResponse<Snapshot>> {
    const safeLimit = Math.min(limit, 365);
    const rows = await this.db
      .select()
      .from(snapshots)
      .where(eq(snapshots.owner, userId))
      .orderBy(desc(snapshots.snapshotDate))
      .limit(safeLimit);

    return {
      items: rows.map((row) => this.mapRow(row)),
    };
  }

  async latest(userId: string): Promise<Snapshot | null> {
    const rows = await this.db
      .select()
      .from(snapshots)
      .where(eq(snapshots.owner, userId))
      .orderBy(desc(snapshots.snapshotDate))
      .limit(1);

    if (rows.length === 0) return null;
    return this.mapRow(rows[0]);
  }

  private mapRow(row: typeof snapshots.$inferSelect): Snapshot {
    const dateStr =
      typeof row.snapshotDate === 'string'
        ? row.snapshotDate
        : (row.snapshotDate as unknown as Date).toISOString().slice(0, 10);
    return {
      id: row.id,
      snapshotDate: dateStr,
      accountValue: row.accountValue != null ? String(row.accountValue) : null,
      totalMv: row.totalMv != null ? String(row.totalMv) : null,
      cost: row.cost != null ? String(row.cost) : null,
      cash: row.cash != null ? String(row.cash) : null,
      totalPl: row.totalPl != null ? String(row.totalPl) : null,
      dailyPl: row.dailyPl != null ? String(row.dailyPl) : null,
      dailyPct: row.dailyPct != null ? String(row.dailyPct) : null,
      netDeposit: row.netDeposit != null ? String(row.netDeposit) : null,
      cumulativeNetDeposit:
        row.cumulativeNetDeposit != null ? String(row.cumulativeNetDeposit) : null,
    };
  }

  private async getNetDepositByCurrency(
    userId: string,
    dateStr: string,
  ): Promise<NetDepositByCurrency> {
    const byCurrency: NetDepositByCurrency = { USD: 0, HKD: 0, CNY: 0 };

    const rows = await this.db
      .select({
        txType: transactions.txType,
        amount: sql<number>`(${transactions.shares} * ${transactions.price})::numeric(16,4)`,
        currency: transactions.currency,
        notes: transactions.notes,
      })
      .from(transactions)
      .where(
        and(
          sql`(${transactions.owner}).user_id = ${userId}`,
          sql`${transactions.txDate} = ${dateStr}::date`,
          sql`${transactions.txType} IN ('Deposit', 'Withdrawal')`,
        ),
      );

    for (const row of rows) {
      const cur = (row.currency || 'USD').toUpperCase();
      const amt = Number(row.amount) || 0;
      const sign = row.txType === 'Deposit' ? 1 : -1;
      if (byCurrency[cur] !== undefined) {
        byCurrency[cur] += sign * amt;
      } else {
        byCurrency[cur] = sign * amt;
      }
    }

    return byCurrency;
  }

  private async convertNetDepositToBase(
    byCurrency: NetDepositByCurrency,
    base: string,
    dateStr: string,
  ): Promise<number> {
    let total = 0;
    for (const cur of Object.keys(byCurrency)) {
      const amt = byCurrency[cur];
      if (amt === 0) continue;
      try {
        const converted = await this.fxService.convert(amt, cur, base, dateStr);
        total += converted;
      } catch (err) {
        this.logger.warn(
          `fx convert failed for net deposit ${cur}->${base} @${dateStr}, fallback to 1: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        total += amt;
      }
    }
    return total;
  }

  async upsert(userId: string, dto: CreateSnapshotDto): Promise<Snapshot> {
    const base = 'USD';
    const dateStr = dto.snapshotDate;

    const prevRows = await this.db
      .select({
        accountValue: snapshots.accountValue,
        cumulativeNetDeposit: snapshots.cumulativeNetDeposit,
      })
      .from(snapshots)
      .where(
        and(
          eq(snapshots.owner, userId),
          sql`${snapshots.snapshotDate} < ${dateStr}::date`,
        ),
      )
      .orderBy(desc(snapshots.snapshotDate))
      .limit(1);

    const prevAv = prevRows[0]?.accountValue != null ? Number(prevRows[0].accountValue) : null;
    const prevCumulativeNetDeposit =
      prevRows[0]?.cumulativeNetDeposit != null
        ? Number(prevRows[0].cumulativeNetDeposit)
        : 0;

    const netDepositByCurrency = await this.getNetDepositByCurrency(userId, dateStr);
    const netDepositBase = await this.convertNetDepositToBase(
      netDepositByCurrency,
      base,
      dateStr,
    );
    const cumulativeNetDepositBase = prevCumulativeNetDeposit + netDepositBase;

    const accountValueNum = dto.accountValue ?? 0;

    let dailyPl: number | null = null;
    let dailyPct: number | null = null;
    if (prevAv != null && dto.accountValue !== undefined) {
      const grossDelta = accountValueNum - prevAv;
      dailyPl = grossDelta - netDepositBase;
      const prevInvestedBase = prevAv - prevCumulativeNetDeposit;
      dailyPct = prevInvestedBase > 0 ? (dailyPl / prevInvestedBase) * 100 : 0;
    } else if (dto.dailyPl !== undefined) {
      dailyPl = dto.dailyPl;
      dailyPct = dto.dailyPct ?? 0;
    }

    const result = await this.db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(snapshots)
        .where(and(eq(snapshots.owner, userId), eq(snapshots.snapshotDate, dto.snapshotDate)))
        .limit(1);

      if (existing.length > 0) {
        const patch: Record<string, unknown> = {};
        if (dto.accountValue !== undefined) patch.accountValue = String(dto.accountValue);
        if (dto.totalMv !== undefined) patch.totalMv = String(dto.totalMv);
        if (dto.cost !== undefined) patch.cost = String(dto.cost);
        if (dto.cash !== undefined) patch.cash = String(dto.cash);
        if (dto.totalPl !== undefined) patch.totalPl = String(dto.totalPl);
        if (dailyPl !== null) patch.dailyPl = String(dailyPl);
        if (dailyPct !== null) patch.dailyPct = String(dailyPct);
        patch.netDeposit = String(netDepositBase);
        patch.cumulativeNetDeposit = String(cumulativeNetDepositBase);
        patch.updatedAt = new Date();
        patch.updatedBy = userId;

        const [updated] = await tx
          .update(snapshots)
          .set(patch)
          .where(eq(snapshots.id, existing[0].id))
          .returning();
        return updated;
      }

      const [inserted] = await tx
        .insert(snapshots)
        .values({
          snapshotDate: dto.snapshotDate,
          accountValue: dto.accountValue !== undefined ? String(dto.accountValue) : null,
          totalMv: dto.totalMv !== undefined ? String(dto.totalMv) : null,
          cost: dto.cost !== undefined ? String(dto.cost) : null,
          cash: dto.cash !== undefined ? String(dto.cash) : null,
          totalPl: dto.totalPl !== undefined ? String(dto.totalPl) : null,
          dailyPl: dailyPl != null ? String(dailyPl) : null,
          dailyPct: dailyPct != null ? String(dailyPct) : null,
          netDeposit: String(netDepositBase),
          cumulativeNetDeposit: String(cumulativeNetDepositBase),
          owner: userId,
          createdBy: userId,
          updatedBy: userId,
        })
        .returning();
      return inserted;
    });

    return this.mapRow(result);
  }

  async batchUpsert(userId: string, items: CreateSnapshotDto[]): Promise<ListResponse<Snapshot>> {
    const sorted = [...items].sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));
    const results: Snapshot[] = [];
    for (const item of sorted) {
      const r = await this.upsert(userId, item);
      results.push(r);
    }
    return { items: results.sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate)) };
  }

  async remove(userId: string, id: string): Promise<{ success: boolean }> {
    const deleted = await this.db
      .delete(snapshots)
      .where(and(eq(snapshots.id, id), eq(snapshots.owner, userId)))
      .returning({ id: snapshots.id });

    if (deleted.length === 0) {
      throw new NotFoundException('快照记录不存在');
    }
    return { success: true };
  }
}
