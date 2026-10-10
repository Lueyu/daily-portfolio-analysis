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

import { HoldingsService } from './holdings.service';
import type {
  Holding,
  CreateHoldingDto,
  UpdateHoldingDto,
  ListResponse,
  BatchPriceUpdateDto,
} from '@shared/api.interface';

@Controller('api/portfolio/holdings')
@NeedLogin()
export class HoldingsController {
  constructor(private readonly holdingsService: HoldingsService) {}

  @Get()
  async findAll(@Req() req: Request): Promise<ListResponse<Holding>> {
    const { userId } = req.userContext;
    return this.holdingsService.findAll(userId);
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<Holding> {
    const { userId } = req.userContext;
    return this.holdingsService.findOne(id, userId);
  }

  @Post()
  async create(
    @Body() dto: CreateHoldingDto,
    @Req() req: Request,
  ): Promise<Holding> {
    const { userId } = req.userContext;
    return this.holdingsService.create(dto, userId);
  }

  @Patch('prices')
  async updatePrices(
    @Body() body: { items: BatchPriceUpdateDto[] },
    @Req() req: Request,
  ): Promise<{ success: true }> {
    const { userId } = req.userContext;
    return this.holdingsService.updatePrices(body.items, userId);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateHoldingDto,
    @Req() req: Request,
  ): Promise<Holding> {
    const { userId } = req.userContext;
    return this.holdingsService.update(id, dto, userId);
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<{ success: true }> {
    const { userId } = req.userContext;
    return this.holdingsService.remove(id, userId);
  }
}
