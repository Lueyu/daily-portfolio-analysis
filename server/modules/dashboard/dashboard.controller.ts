/**
 * Dashboard controller.
 *
 * Exposes aggregated portfolio endpoints under `/api/portfolio/dashboard`: an
 * overview (totals, per-currency and per-market breakdowns in a chosen base
 * currency) and a daily P&L time series. Requires login on every route.
 */
import { Controller, Get, Post, Query, Req } from '@nestjs/common';
import { NeedLogin } from '../../common/platform';
import type { Request } from 'express';
import { DashboardService } from './dashboard.service';
import { MarketOverviewService } from './market-overview.service';
import type { DashboardOverview, MarketOverviewResponse } from '@shared/api.interface';

/**
 * REST controller for the dashboard. Delegates aggregation to `DashboardService`.
 */
@NeedLogin()
@Controller('api/portfolio/dashboard')
export class DashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly marketOverviewService: MarketOverviewService,
  ) {}

  /** Public index observations; no holding or account data is sent upstream. */
  @Get('market-overview')
  async getMarketOverview(): Promise<MarketOverviewResponse> {
    return this.marketOverviewService.getOverview();
  }

  /**
   * Returns the portfolio overview (market value, cost, cash, P&L, group summary)
   * converted to the requested base currency (default USD).
   *
   * @param req          Authenticated request carrying `req.userContext.userId`.
   * @param baseCurrency Optional target currency (default USD).
   */
  @Get('overview')
  async getOverview(
    @Req() req: Request,
    @Query('baseCurrency') baseCurrency?: string,
  ): Promise<DashboardOverview> {
    const { userId } = req.userContext;
    return this.dashboardService.getOverview(userId, baseCurrency ?? 'USD');
  }

  /**
   * Returns a daily P&L series for the last N days.
   *
   * @param req          Authenticated request.
   * @param days         Optional number of days (default 30).
   * @param baseCurrency Optional target currency (default USD).
   */
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

  /**
   * Manually refreshes FX rates from the upstream provider.
   */
  @Post('refresh-rates')
  async refreshRates(): Promise<{ ok: true }> {
    await this.dashboardService.refreshRates();
    return { ok: true };
  }
}
