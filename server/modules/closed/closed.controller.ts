import { Controller, Get, Post, Patch, Delete, Body, Param, Req } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';
import { ClosedService } from './closed.service';
import type { ClosedPosition, CreateClosedDto, RealizedPlSummary } from '@shared/api.interface';

@NeedLogin()
@Controller('api/portfolio/closed')
export class ClosedController {
  constructor(private readonly closedService: ClosedService) {}

  @Get('summary')
  async getSummary(@Req() req: Request): Promise<RealizedPlSummary> {
    const { userId } = req.userContext;
    return this.closedService.getRealizedSummary(userId);
  }

  @Get()
  async list(@Req() req: Request): Promise<{ items: ClosedPosition[] }> {
    const { userId } = req.userContext;
    const items = await this.closedService.list(userId);
    return { items };
  }

  @Post()
  async create(@Req() req: Request, @Body() dto: CreateClosedDto): Promise<ClosedPosition> {
    const { userId } = req.userContext;
    return this.closedService.create(userId, dto);
  }

  @Patch(':id')
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: Partial<CreateClosedDto>,
  ): Promise<ClosedPosition> {
    const { userId } = req.userContext;
    return this.closedService.update(userId, id, dto);
  }

  @Delete(':id')
  async remove(@Req() req: Request, @Param('id') id: string): Promise<void> {
    const { userId } = req.userContext;
    return this.closedService.remove(userId, id);
  }
}
