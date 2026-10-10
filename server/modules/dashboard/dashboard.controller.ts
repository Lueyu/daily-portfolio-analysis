import { Controller, Get, Post, Query, Req } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';
import { DashboardService } from './dashboard.service';
import type { DashboardOverview } from '@shared/api.interface';

@NeedLogin()
@Controller('api/portfolio/dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('overview')
  async getOverview(
    @Req() req: Request,
    @Query('baseCurrency') baseCurrency?: string,
  ): Promise<DashboardOverview> {
    const { userId } = req.userContext;
    return this.dashboardService.getOverview(userId, baseCurrency ?? 'USD');
  }

  @Get('daily-pl')
  async getDailyPl(
    @Req() req: Request,
    @Query('days') days?: string,
    @Query('baseCurrency') baseCurrency?: string,
  ): Promise<{ date: string; accountValue: string; dailyPl: string; dailyPct: string }[]> {
    const { userId } = req.userContext;
    const daysNum = days ? parseInt(days, 10) : 30;
    return this.dashboardService.getDailyPlSeries(userId, daysNum, baseCurrency ?? 'USD');
  }

  @Post('refresh-rates')
  async refreshRates(): Promise<{ ok: true }> {
    await this.dashboardService.refreshRates();
    return { ok: true };
  }
}
