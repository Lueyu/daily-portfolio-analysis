import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Req,
} from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';

import { WatchlistService } from './watchlist.service';
import type {
  WatchItem,
  CreateWatchItemDto,
  UpdateWatchItemDto,
  ListResponse,
  BatchPriceUpdateDto,
} from '@shared/api.interface';

@Controller('api/portfolio/watchlist')
@NeedLogin()
export class WatchlistController {
  constructor(private readonly watchlistService: WatchlistService) {}

  @Get()
  async findAll(@Req() req: Request): Promise<ListResponse<WatchItem>> {
    const { userId } = req.userContext;
    return this.watchlistService.findAll(userId);
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<WatchItem> {
    const { userId } = req.userContext;
    return this.watchlistService.findOne(id, userId);
  }

  @Post()
  async create(
    @Body() dto: CreateWatchItemDto,
    @Req() req: Request,
  ): Promise<WatchItem> {
    const { userId } = req.userContext;
    return this.watchlistService.create(dto, userId);
  }

  @Patch('prices')
  async updatePrices(
    @Body() body: { items: BatchPriceUpdateDto[] },
    @Req() req: Request,
  ): Promise<{ success: true }> {
    const { userId } = req.userContext;
    return this.watchlistService.updatePrices(body.items, userId);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateWatchItemDto,
    @Req() req: Request,
  ): Promise<WatchItem> {
    const { userId } = req.userContext;
    return this.watchlistService.update(id, dto, userId);
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<{ success: true }> {
    const { userId } = req.userContext;
    return this.watchlistService.remove(id, userId);
  }
}
