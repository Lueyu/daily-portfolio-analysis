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

import { AlphaPicksService, type UpdateAlphaPickDto } from './alpha-picks.service';
import type {
  AlphaPick,
  CreateAlphaPickDto,
  ListResponse,
} from '@shared/api.interface';

@Controller('api/portfolio/alpha-picks')
@NeedLogin()
export class AlphaPicksController {
  constructor(private readonly alphaPicksService: AlphaPicksService) {}

  @Get()
  async findAll(@Req() req: Request): Promise<ListResponse<AlphaPick>> {
    const { userId } = req.userContext;
    return this.alphaPicksService.findAll(userId);
  }

  @Post()
  async create(
    @Body() dto: CreateAlphaPickDto,
    @Req() req: Request,
  ): Promise<AlphaPick> {
    const { userId } = req.userContext;
    return this.alphaPicksService.create(dto, userId);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateAlphaPickDto,
    @Req() req: Request,
  ): Promise<AlphaPick> {
    const { userId } = req.userContext;
    return this.alphaPicksService.update(id, dto, userId);
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<{ success: true }> {
    const { userId } = req.userContext;
    return this.alphaPicksService.remove(id, userId);
  }
}
