import { Injectable, Inject, Logger, NotFoundException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { eq, and, desc } from 'drizzle-orm';
import { journal } from '@server/database/schema';
import type { JournalEntry, CreateJournalDto, ListResponse } from '@shared/api.interface';

@Injectable()
export class JournalService {
  private readonly logger = new Logger(JournalService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  async list(userId: string, date?: string): Promise<ListResponse<JournalEntry>> {
    const conditions = [eq(journal.owner, userId)];
    if (date) conditions.push(eq(journal.journalDate, date));

    const rows = await this.db
      .select()
      .from(journal)
      .where(and(...conditions))
      .orderBy(desc(journal.journalDate));

    return {
      items: rows.map((row) => ({
        id: row.id,
        journalDate: row.journalDate,
        marketSummary: row.marketSummary,
        portfolioSummary: row.portfolioSummary,
        actions: row.actions,
        plan: row.plan,
        lessons: row.lessons,
        updatedAt: row.updatedAt.toISOString(),
      })),
    };
  }

  async latest(userId: string): Promise<JournalEntry | null> {
    const rows = await this.db
      .select()
      .from(journal)
      .where(eq(journal.owner, userId))
      .orderBy(desc(journal.journalDate))
      .limit(1);

    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      id: row.id,
      journalDate: row.journalDate,
      marketSummary: row.marketSummary,
      portfolioSummary: row.portfolioSummary,
      actions: row.actions,
      plan: row.plan,
      lessons: row.lessons,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async upsert(userId: string, dto: CreateJournalDto): Promise<JournalEntry> {
    const result = await this.db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(journal)
        .where(and(eq(journal.owner, userId), eq(journal.journalDate, dto.journalDate)))
        .limit(1);

      if (existing.length > 0) {
        const patch: Record<string, unknown> = {};
        if (dto.marketSummary !== undefined) patch.marketSummary = dto.marketSummary;
        if (dto.portfolioSummary !== undefined) patch.portfolioSummary = dto.portfolioSummary;
        if (dto.actions !== undefined) patch.actions = dto.actions;
        if (dto.plan !== undefined) patch.plan = dto.plan;
        if (dto.lessons !== undefined) patch.lessons = dto.lessons;
        patch.updatedAt = new Date();
        patch.updatedBy = userId;

        const [updated] = await tx
          .update(journal)
          .set(patch)
          .where(eq(journal.id, existing[0].id))
          .returning();
        return updated;
      }

      const [inserted] = await tx
        .insert(journal)
        .values({
          journalDate: dto.journalDate,
          marketSummary: dto.marketSummary ?? null,
          portfolioSummary: dto.portfolioSummary ?? null,
          actions: dto.actions ?? null,
          plan: dto.plan ?? null,
          lessons: dto.lessons ?? null,
          owner: userId,
          createdBy: userId,
          updatedBy: userId,
        })
        .returning();
      return inserted;
    });

    return {
      id: result.id,
      journalDate: result.journalDate,
      marketSummary: result.marketSummary,
      portfolioSummary: result.portfolioSummary,
      actions: result.actions,
      plan: result.plan,
      lessons: result.lessons,
      updatedAt: result.updatedAt.toISOString(),
    };
  }

  async remove(userId: string, id: string): Promise<{ success: boolean }> {
    const deleted = await this.db
      .delete(journal)
      .where(and(eq(journal.id, id), eq(journal.owner, userId)))
      .returning({ id: journal.id });

    if (deleted.length === 0) {
      throw new NotFoundException('日志记录不存在');
    }
    return { success: true };
  }
}
