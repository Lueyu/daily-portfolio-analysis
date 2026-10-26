/**
 * Trading journal service.
 *
 * Business logic and PostgreSQL (Drizzle) data access for the user's per-day
 * trading journal. Entries are owner-scoped and keyed by (owner, journalDate);
 * `upsert` updates the existing entry for that date or creates one if absent.
 */
import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { eq, and, desc } from 'drizzle-orm';
import { journal } from '@server/database/schema';
import type { JournalEntry, CreateJournalDto, ListResponse } from '@shared/api.interface';

/**
 * Provides journal read/upsert/delete. Depends on the Drizzle database connection.
 */
@Injectable()
export class JournalService {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  /**
   * Lists journal entries for a user, newest first, optionally filtered by date.
   *
   * @param userId Owner id.
   * @param date   Optional journal date filter.
   */
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

  /**
   * Returns the most recent journal entry for the user, or null if none.
   *
   * @param userId Owner id.
   */
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

  /**
   * Upserts the journal entry for a given date: updates it if one already exists
   * for (owner, date), otherwise inserts a new one. Runs in a transaction.
   *
   * @param userId Owner id.
   * @param dto    Journal payload keyed by `journalDate`.
   */
  async upsert(userId: string, dto: CreateJournalDto): Promise<JournalEntry> {
    const result = await this.db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(journal)
        .where(and(eq(journal.owner, userId), eq(journal.journalDate, dto.journalDate)))
        .limit(1);

      if (existing.length > 0) {
        // Update only the fields supplied in the DTO.
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

  /**
   * Deletes an owned journal entry.
   *
   * @param userId Owner id.
   * @param id     Journal entry primary key.
   * @throws NotFoundException if the entry does not belong to the user.
   */
  async remove(userId: string, id: string): Promise<{ success: boolean }> {
    const deleted = await this.db
      .delete(journal)
      .where(and(eq(journal.id, id), eq(journal.owner, userId)))
      .returning({ id: journal.id });

    if (deleted.length === 0)
      // NOTE: Chinese user-facing message (existing behavior; not mojibake).
      throw new NotFoundException('日志记录不存在');
    return { success: true };
  }
}
