import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq, desc, and } from 'drizzle-orm';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';

import { alphaPicks } from '@server/database/schema';
import type {
  AlphaPick,
  CreateAlphaPickDto,
  ListResponse,
} from '@shared/api.interface';

export interface UpdateAlphaPickDto {
  company?: string;
  sector?: string;
  datePicked?: string;
  returnPct?: number;
  rating?: string;
  weightPct?: number;
}

@Injectable()
export class AlphaPicksService {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async findAll(userId: string): Promise<ListResponse<AlphaPick>> {
    const rows = await this.db
      .select()
      .from(alphaPicks)
      .where(eq(alphaPicks.owner, userId))
      .orderBy(desc(alphaPicks.datePicked));
    return { items: rows.map((r) => this.mapRow(r)) };
  }

  async create(dto: CreateAlphaPickDto, userId: string): Promise<AlphaPick> {
    const rows = await this.db
      .insert(alphaPicks)
      .values({
        ticker: dto.ticker,
        company: dto.company,
        sector: dto.sector,
        datePicked: dto.datePicked,
        returnPct: dto.returnPct !== undefined ? String(dto.returnPct) : undefined,
        rating: dto.rating,
        weightPct: dto.weightPct !== undefined ? String(dto.weightPct) : undefined,
        owner: userId,
        createdBy: userId,
        updatedBy: userId,
      })
      .returning();
    return this.mapRow(rows[0]);
  }

  async update(id: string, dto: UpdateAlphaPickDto, userId: string): Promise<AlphaPick> {
    const patch: Partial<typeof alphaPicks.$inferInsert> = {};
    if (dto.company !== undefined) patch.company = dto.company;
    if (dto.sector !== undefined) patch.sector = dto.sector;
    if (dto.datePicked !== undefined) patch.datePicked = dto.datePicked;
    if (dto.returnPct !== undefined) patch.returnPct = String(dto.returnPct);
    if (dto.rating !== undefined) patch.rating = dto.rating;
    if (dto.weightPct !== undefined) patch.weightPct = String(dto.weightPct);

    patch.updatedAt = new Date();
    patch.updatedBy = userId;

    const rows = await this.db
      .update(alphaPicks)
      .set(patch)
      .where(and(eq(alphaPicks.id, id), eq(alphaPicks.owner, userId)))
      .returning();
    if (rows.length === 0) throw new NotFoundException('推荐记录不存在');
    return this.mapRow(rows[0]);
  }

  async remove(id: string, userId: string): Promise<{ success: true }> {
    const rows = await this.db
      .delete(alphaPicks)
      .where(and(eq(alphaPicks.id, id), eq(alphaPicks.owner, userId)))
      .returning({ id: alphaPicks.id });
    if (rows.length === 0) throw new NotFoundException('推荐记录不存在');
    return { success: true };
  }

  private mapRow(row: typeof alphaPicks.$inferSelect): AlphaPick {
    return {
      id: row.id,
      ticker: row.ticker,
      company: row.company,
      sector: row.sector,
      datePicked: row.datePicked,
      returnPct: row.returnPct,
      rating: row.rating,
      weightPct: row.weightPct,
    };
  }
}
