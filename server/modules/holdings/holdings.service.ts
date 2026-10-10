import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq, desc, and } from 'drizzle-orm';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';

import { holdings } from '@server/database/schema';
import { QuoteService } from './../quote/quote.service';
import type {
  Holding,
  CreateHoldingDto,
  UpdateHoldingDto,
  ListResponse,
  BatchPriceUpdateDto,
} from '@shared/api.interface';

@Injectable()
export class HoldingsService {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly quoteService: QuoteService,
  ) {}

  async findAll(userId: string): Promise<ListResponse<Holding>> {
    const rows = await this.db
      .select()
      .from(holdings)
      .where(eq(holdings.owner, userId))
      .orderBy(desc(holdings.updatedAt));
    return { items: rows.map((r) => this.mapRow(r)) };
  }

  async findOne(id: string, userId: string): Promise<Holding> {
    const rows = await this.db
      .select()
      .from(holdings)
      .where(and(eq(holdings.id, id), eq(holdings.owner, userId)));
    if (rows.length === 0) throw new NotFoundException('持仓不存在');
    return this.mapRow(rows[0]);
  }

  async create(dto: CreateHoldingDto, userId: string): Promise<Holding> {
    const marketInfo = this.quoteService.detectMarket(dto.ticker);
    const rows = await this.db
      .insert(holdings)
      .values({
        ticker: dto.ticker,
        company: dto.company,
        sector: dto.sector,
        buyDate: dto.buyDate,
        buyPrice: dto.buyPrice !== undefined ? String(dto.buyPrice) : undefined,
        shares: String(dto.shares),
        currentPrice: dto.currentPrice !== undefined ? String(dto.currentPrice) : undefined,
        rating: dto.rating,
        action: dto.action,
        analysis: dto.analysis,
        targetPrice: dto.targetPrice !== undefined ? String(dto.targetPrice) : undefined,
        groupId: dto.groupId,
        market: marketInfo.market,
        currency: marketInfo.currency,
        symbolNative: marketInfo.symbolNative,
        displaySymbol: marketInfo.displaySymbol,
        owner: userId,
        createdBy: userId,
        updatedBy: userId,
      })
      .returning();
    return this.mapRow(rows[0]);
  }

  async update(id: string, dto: UpdateHoldingDto, userId: string): Promise<Holding> {
    const patch: Partial<typeof holdings.$inferInsert> = {};
    if (dto.company !== undefined) patch.company = dto.company;
    if (dto.sector !== undefined) patch.sector = dto.sector;
    if (dto.buyDate !== undefined) patch.buyDate = dto.buyDate;
    if (dto.buyPrice !== undefined) patch.buyPrice = String(dto.buyPrice);
    if (dto.shares !== undefined) patch.shares = String(dto.shares);
    if (dto.currentPrice !== undefined) patch.currentPrice = String(dto.currentPrice);
    if (dto.rating !== undefined) patch.rating = dto.rating;
    if (dto.action !== undefined) patch.action = dto.action;
    if (dto.analysis !== undefined) patch.analysis = dto.analysis;
    if (dto.targetPrice !== undefined) patch.targetPrice = String(dto.targetPrice);
    if (dto.groupId !== undefined) patch.groupId = dto.groupId;

    patch.updatedAt = new Date();
    patch.updatedBy = userId;

    const rows = await this.db
      .update(holdings)
      .set(patch)
      .where(and(eq(holdings.id, id), eq(holdings.owner, userId)))
      .returning();
    if (rows.length === 0) throw new NotFoundException('持仓不存在');
    return this.mapRow(rows[0]);
  }

  async remove(id: string, userId: string): Promise<{ success: true }> {
    const rows = await this.db
      .delete(holdings)
      .where(and(eq(holdings.id, id), eq(holdings.owner, userId)))
      .returning({ id: holdings.id });
    if (rows.length === 0) throw new NotFoundException('持仓不存在');
    return { success: true };
  }

  async updatePrices(items: BatchPriceUpdateDto[], userId: string): Promise<{ success: true }> {
    await this.db.transaction(async (tx) => {
      for (const item of items) {
        await tx
          .update(holdings)
          .set({
            currentPrice: String(item.price),
            updatedAt: new Date(),
            updatedBy: userId,
          })
          .where(and(eq(holdings.ticker, item.ticker), eq(holdings.owner, userId)));
      }
    });
    return { success: true };
  }

  private mapRow(row: typeof holdings.$inferSelect): Holding {
    return {
      id: row.id,
      ticker: row.ticker,
      company: row.company,
      sector: row.sector,
      buyDate: row.buyDate,
      buyPrice: row.buyPrice,
      shares: row.shares,
      currentPrice: row.currentPrice,
      rating: row.rating,
      action: row.action,
      analysis: row.analysis,
      targetPrice: row.targetPrice,
      groupId: row.groupId,
      market: (row.market as Holding['market']) || 'US',
      currency: (row.currency as Holding['currency']) || 'USD',
      symbolNative: row.symbolNative ?? null,
      displaySymbol: row.displaySymbol ?? null,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
