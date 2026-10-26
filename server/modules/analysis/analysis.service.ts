/**
 * Analysis service.
 *
 * Business logic and PostgreSQL (Drizzle) data access for stock research notes.
 * Notes are owner-scoped and keyed by (owner, analysisDate, ticker). Test/deep-run
 * rows (ticker containing "testdeep") are filtered out of listings.
 */
import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { eq, and, desc, asc, notIlike } from 'drizzle-orm';
import { analysis } from '@server/database/schema';
import type { Analysis, CreateAnalysisDto, ListResponse } from '@shared/api.interface';

/**
 * Provides analysis-note read/upsert/delete. Depends on the Drizzle database.
 */
@Injectable()
export class AnalysisService {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  /**
   * Lists analysis notes for a user, newest date / ticker order (max 50 rows),
   * optionally filtered by date and/or ticker. Excludes internal test rows.
   *
   * @param userId Owner id.
   * @param date   Optional analysis date filter.
   * @param ticker Optional ticker filter.
   */
  async list(userId: string, date?: string, ticker?: string): Promise<ListResponse<Analysis>> {
    const conditions = [eq(analysis.owner, userId)];
    if (date) conditions.push(eq(analysis.analysisDate, date));
    if (ticker) conditions.push(eq(analysis.ticker, ticker));

    // Exclude internal test/deep-run rows from the public listing.
    const allConditions = [...conditions, notIlike(analysis.ticker, '%testdeep%')];

    const rows = await this.db
      .select()
      .from(analysis)
      .where(and(...allConditions))
      .orderBy(desc(analysis.analysisDate), asc(analysis.ticker))
      .limit(50);

    return {
      items: rows.map((row) => ({
        id: row.id,
        analysisDate: row.analysisDate,
        ticker: row.ticker,
        rating: row.rating,
        action: row.action,
        analysis: row.analysis,
        targetPrice: row.targetPrice,
        catalysts: row.catalysts,
        risks: row.risks,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Returns the distinct dates that have analysis notes, newest first.
   *
   * @param userId Owner id.
   */
  async listDates(userId: string): Promise<ListResponse<{ date: string }>> {
    const rows = await this.db
      .select({ date: analysis.analysisDate })
      .from(analysis)
      .where(eq(analysis.owner, userId))
      .groupBy(analysis.analysisDate)
      .orderBy(desc(analysis.analysisDate));

    return { items: rows.map((row: { date: string }) => ({ date: row.date })) };
  }

  /**
   * Upserts the analysis note for a (owner, date, ticker): updates the existing row
   * if present, otherwise inserts a new one. Runs in a transaction.
   *
   * @param userId Owner id.
   * @param dto    Analysis payload keyed by `analysisDate` and `ticker`.
   */
  async upsert(userId: string, dto: CreateAnalysisDto): Promise<Analysis> {
    const result = await this.db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(analysis)
        .where(
          and(
            eq(analysis.owner, userId),
            eq(analysis.analysisDate, dto.analysisDate),
            eq(analysis.ticker, dto.ticker),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        // Update only the fields supplied in the DTO.
        const patch: Record<string, unknown> = {};
        if (dto.rating !== undefined) patch.rating = dto.rating;
        if (dto.action !== undefined) patch.action = dto.action;
        if (dto.analysis !== undefined) patch.analysis = dto.analysis;
        if (dto.targetPrice !== undefined) patch.targetPrice = String(dto.targetPrice);
        if (dto.catalysts !== undefined) patch.catalysts = dto.catalysts;
        if (dto.risks !== undefined) patch.risks = dto.risks;
        patch.updatedAt = new Date();
        patch.updatedBy = userId;

        const [updated] = await tx
          .update(analysis)
          .set(patch)
          .where(eq(analysis.id, existing[0].id))
          .returning();
        return updated;
      }

      const [inserted] = await tx
        .insert(analysis)
        .values({
          analysisDate: dto.analysisDate,
          ticker: dto.ticker,
          rating: dto.rating ?? null,
          action: dto.action ?? null,
          analysis: dto.analysis ?? null,
          targetPrice: dto.targetPrice !== undefined ? String(dto.targetPrice) : null,
          catalysts: dto.catalysts ?? null,
          risks: dto.risks ?? null,
          owner: userId,
          createdBy: userId,
          updatedBy: userId,
        })
        .returning();
      return inserted;
    });

    return {
      id: result.id,
      analysisDate: result.analysisDate,
      ticker: result.ticker,
      rating: result.rating,
      action: result.action,
      analysis: result.analysis,
      targetPrice: result.targetPrice,
      catalysts: result.catalysts,
      risks: result.risks,
      createdAt: result.createdAt.toISOString(),
    };
  }

  /**
   * Upserts multiple analysis notes concurrently within a transaction.
   *
   * @param userId Owner id.
   * @param items  Analysis payloads.
   */
  async batchUpsert(userId: string, items: CreateAnalysisDto[]): Promise<ListResponse<Analysis>> {
    const results: Analysis[] = await this.db.transaction(async () => {
      const promises = items.map((item: CreateAnalysisDto) => this.upsert(userId, item));
      return Promise.all(promises);
    });
    return { items: results };
  }

  /**
   * Deletes an owned analysis note.
   *
   * @param userId Owner id.
   * @param id     Analysis row primary key.
   * @throws NotFoundException if the note does not belong to the user.
   */
  async remove(userId: string, id: string): Promise<{ success: boolean }> {
    const deleted = await this.db
      .delete(analysis)
      .where(and(eq(analysis.id, id), eq(analysis.owner, userId)))
      .returning({ id: analysis.id });

    if (deleted.length === 0)
      // NOTE: Chinese user-facing message (existing behavior; not mojibake).
      throw new NotFoundException('分析记录不存在');
    return { success: true };
  }
}
