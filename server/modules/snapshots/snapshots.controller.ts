import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  Req,
} from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';
import { SnapshotsService } from './snapshots.service';
import type {
  Snapshot,
  CreateSnapshotDto,
  ListResponse,
} from '@shared/api.interface';

@NeedLogin()
@Controller('api/portfolio/snapshots')
export class SnapshotsController {
  constructor(private readonly snapshotsService: SnapshotsService) {}

  @Get()
  async list(
    @Req() req: Request,
    @Query('limit') limit?: string,
  ): Promise<ListResponse<Snapshot>> {
    const { userId } = req.userContext;
    const limitNum = limit ? parseInt(limit, 10) : 90;
    return this.snapshotsService.list(userId, limitNum);
  }

  @Get('latest')
  async latest(@Req() req: Request): Promise<Snapshot | null> {
    const { userId } = req.userContext;
    return this.snapshotsService.latest(userId);
  }

  @Post()
  async upsert(
    @Req() req: Request,
    @Body() dto: CreateSnapshotDto,
  ): Promise<Snapshot> {
    const { userId } = req.userContext;
    return this.snapshotsService.upsert(userId, dto);
  }

  @Post('batch')
  async batchUpsert(
    @Req() req: Request,
    @Body() items: CreateSnapshotDto[],
  ): Promise<ListResponse<Snapshot>> {
    const { userId } = req.userContext;
    return this.snapshotsService.batchUpsert(userId, items);
  }

  @Delete(':id')
  async remove(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    const { userId } = req.userContext;
    return this.snapshotsService.remove(userId, id);
  }
}
