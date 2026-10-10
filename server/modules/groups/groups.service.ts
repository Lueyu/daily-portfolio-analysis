import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq, asc, and } from 'drizzle-orm';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';

import { groups } from '@server/database/schema';
import type {
  Group,
  CreateGroupDto,
  UpdateGroupDto,
  ListResponse,
} from '@shared/api.interface';

@Injectable()
export class GroupsService {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async findAll(userId: string): Promise<ListResponse<Group>> {
    const rows = await this.db
      .select()
      .from(groups)
      .where(eq(groups.owner, userId))
      .orderBy(asc(groups.sort));
    return { items: rows.map((r) => this.mapRow(r)) };
  }

  async create(dto: CreateGroupDto, userId: string): Promise<Group> {
    const rows = await this.db
      .insert(groups)
      .values({
        name: dto.name,
        color: dto.color,
        sort: dto.sort,
        owner: userId,
        createdBy: userId,
        updatedBy: userId,
      })
      .returning();
    return this.mapRow(rows[0]);
  }

  async update(id: string, dto: UpdateGroupDto, userId: string): Promise<Group> {
    const patch: Partial<typeof groups.$inferInsert> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.color !== undefined) patch.color = dto.color;
    if (dto.sort !== undefined) patch.sort = dto.sort;

    patch.updatedAt = new Date();
    patch.updatedBy = userId;

    const rows = await this.db
      .update(groups)
      .set(patch)
      .where(and(eq(groups.id, id), eq(groups.owner, userId)))
      .returning();
    if (rows.length === 0) throw new NotFoundException('分组不存在');
    return this.mapRow(rows[0]);
  }

  async remove(id: string, userId: string): Promise<{ success: true }> {
    const rows = await this.db
      .delete(groups)
      .where(and(eq(groups.id, id), eq(groups.owner, userId)))
      .returning({ id: groups.id });
    if (rows.length === 0) throw new NotFoundException('分组不存在');
    return { success: true };
  }

  private mapRow(row: typeof groups.$inferSelect): Group {
    return {
      id: row.id,
      name: row.name,
      color: row.color,
      sort: row.sort ?? 0,
    };
  }
}
