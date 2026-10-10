import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq, desc, and } from 'drizzle-orm';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';

import { watchlist } from '@server/database/schema';
import { QuoteService } from './../quote/quote.service';
import type {
  WatchItem,
  CreateWatchItemDto,
  UpdateWatchItemDto,
  ListResponse,
  BatchPriceUpdateDto,
} from '@shared/api.interface';

@Injectable()
export class WatchlistService {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly quoteService: QuoteService,
  ) {}

  async findAll(userId: string): Promise<ListResponse<WatchItem>> {
    const rows = await this.db
      .select()
      .from(watchlist)
      .where(eq(watchlist.owner, userId))
      .orderBy(desc(watchlist.updatedAt));
    return { items: rows.map((r) => this.mapRow(r)) };
  }

  async findOne(id: string, userId: string): Promise<WatchItem> {
    const rows = await this.db
      .select()
      .from(watchlist)
      .where(and(eq(watchlist.id, id), eq(watchlist.owner, userId)));
    if (rows.length === 0) throw new NotFoundException('关注项不存在');
    return this.mapRow(rows[0]);
  }

  async create(dto: CreateWatchItemDto, userId: string): Promise<WatchItem> {
    const marketInfo = this.quoteService.detectMarket(dto.ticker);
    const rows = await this.db
      .insert(watchlist)
      .values({
        ticker: dto.ticker,
        company: dto.company,
        sector: dto.sector,
        dateAdded: dto.dateAdded,
        entryPrice: dto.entryPrice !== undefined ? String(dto.entryPrice) : undefined,
        currentPrice: dto.currentPrice !== undefined ? String(dto.currentPrice) : undefined,
        rating: dto.rating,
        signal: dto.signal,
        targetBuy: dto.targetBuy !== undefined ? String(dto.targetBuy) : undefined,
        analysis: dto.analysis,
        market: marketInfo.market,
        currency: marketInfo.currency,
        owner: userId,
        createdBy: userId,
        updatedBy: userId,
      })
      .returning();
    return this.mapRow(rows[0]);
  }

  async update(id: string, dto: UpdateWatchItemDto, userId: string): Promise<WatchItem> {
    const patch: Partial<typeof watchlist.$inferInsert> = {};
    if (dto.company !== undefined) patch.company = dto.company;
    if (dto.sector !== undefined) patch.sector = dto.sector;
    if (dto.entryPrice !== undefined) patch.entryPrice = String(dto.entryPrice);
    if (dto.currentPrice !== undefined) patch.currentPrice = String(dto.currentPrice);
    if (dto.rating !== undefined) patch.rating = dto.rating;
    if (dto.signal !== undefined) patch.signal = dto.signal;
    if (dto.targetBuy !== undefined) patch.targetBuy = String(dto.targetBuy);
    if (dto.analysis !== undefined) patch.analysis = dto.analysis;

    patch.updatedAt = new Date();
    patch.updatedBy = userId;

    const rows = await this.db
      .update(watchlist)
      .set(patch)
      .where(and(eq(watchlist.id, id), eq(watchlist.owner, userId)))
      .returning();
    if (rows.length === 0) throw new NotFoundException('关注项不存在');
    return this.mapRow(rows[0]);
  }

  async remove(id: string, userId: string): Promise<{ success: true }> {
    const rows = await this.db
      .delete(watchlist)
      .where(and(eq(watchlist.id, id), eq(watchlist.owner, userId)))
      .returning({ id: watchlist.id });
    if (rows.length === 0) throw new NotFoundException('关注项不存在');
    return { success: true };
  }

  async updatePrices(items: BatchPriceUpdateDto[], userId: string): Promise<{ success: true }> {
    await this.db.transaction(async (tx) => {
      for (const item of items) {
        await tx
          .update(watchlist)
          .set({
            currentPrice: String(item.price),
            updatedAt: new Date(),
            updatedBy: userId,
          })
          .where(and(eq(watchlist.ticker, item.ticker), eq(watchlist.owner, userId)));
      }
    });
    return { success: true };
  }

  private mapRow(row: typeof watchlist.$inferSelect): WatchItem {
    return {
      id: row.id,
      ticker: row.ticker,
      company: row.company,
      sector: row.sector,
      dateAdded: row.dateAdded,
      entryPrice: row.entryPrice,
      currentPrice: row.currentPrice,
      rating: row.rating,
      signal: row.signal,
      targetBuy: row.targetBuy,
      analysis: row.analysis,
      market: (row.market as WatchItem['market']) || 'US',
      currency: (row.currency as WatchItem['currency']) || 'USD',
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
