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
import { AnalysisService } from './analysis.service';
import type {
  Analysis,
  CreateAnalysisDto,
  ListResponse,
} from '@shared/api.interface';

@NeedLogin()
@Controller('api/portfolio/analysis')
export class AnalysisController {
  constructor(private readonly analysisService: AnalysisService) {}

  @Get()
  async list(
    @Req() req: Request,
    @Query('date') date?: string,
    @Query('ticker') ticker?: string,
  ): Promise<ListResponse<Analysis>> {
    const { userId } = req.userContext;
    return this.analysisService.list(userId, date, ticker);
  }

  @Get('dates')
  async dates(@Req() req: Request): Promise<ListResponse<{ date: string }>> {
    const { userId } = req.userContext;
    return this.analysisService.listDates(userId);
  }

  @Post()
  async upsert(
    @Req() req: Request,
    @Body() dto: CreateAnalysisDto,
  ): Promise<Analysis> {
    const { userId } = req.userContext;
    return this.analysisService.upsert(userId, dto);
  }

  @Post('batch')
  async batchUpsert(
    @Req() req: Request,
    @Body() items: CreateAnalysisDto[],
  ): Promise<ListResponse<Analysis>> {
    const { userId } = req.userContext;
    return this.analysisService.batchUpsert(userId, items);
  }

  @Delete(':id')
  async remove(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    const { userId } = req.userContext;
    return this.analysisService.remove(userId, id);
  }
}
