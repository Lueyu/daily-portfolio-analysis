import { Controller, Get, Post, Body, Req, Query } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';
import { AgentService } from './agent.service';
import type {
  AgentStateResponse,
  CreateJournalDto,
  CreateSnapshotDto,
  JournalEntry,
  Snapshot,
  WatchItem,
  Analysis,
  Transaction,
  Holding,
} from '@shared/api.interface';

interface DailyAnalysisDto {
  date: string;
  items: Array<{
    ticker: string;
    rating?: string;
    action?: string;
    analysis?: string;
    targetPrice?: number;
    catalysts?: string;
    risks?: string;
  }>;
}

interface HoldingRatingsDto {
  items: Array<{
    ticker: string;
    rating?: string;
    action?: string;
    analysis?: string;
    targetPrice?: number;
  }>;
}

interface WatchItemsAddDto {
  items: Array<Omit<WatchItem, 'id' | 'dateAdded' | 'updatedAt'> & { dateAdded?: string }>;
}

interface WatchItemsRemoveDto {
  tickers: string[];
}

@NeedLogin()
@Controller('api/agent')
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  @Get('state')
  async getState(@Req() req: Request): Promise<AgentStateResponse> {
    const { userId } = req.userContext;
    return this.agentService.getState(userId);
  }

  @Get('history')
  async getHistory(
    @Req() req: Request,
  ): Promise<{
    analysis: Analysis[];
    transactions: Transaction[];
    snapshots: Snapshot[];
    holdings: Holding[];
  }> {
    const { userId } = req.userContext;
    return this.agentService.getHistory(userId);
  }

  @Post('daily-analysis')
  async saveDailyAnalysis(
    @Req() req: Request,
    @Body() dto: DailyAnalysisDto,
  ): Promise<{ saved: number }> {
    const { userId } = req.userContext;
    return this.agentService.saveDailyAnalysis(userId, dto);
  }

  @Post('holding-ratings')
  async applyHoldingRatings(
    @Req() req: Request,
    @Body() dto: HoldingRatingsDto,
  ): Promise<{ updated: number; skipped: number }> {
    const { userId } = req.userContext;
    return this.agentService.applyHoldingRatings(userId, dto);
  }

  @Post('watch-items/add')
  async addWatchItems(
    @Req() req: Request,
    @Body() dto: WatchItemsAddDto,
  ): Promise<{ added: number; updated: number }> {
    const { userId } = req.userContext;
    return this.agentService.addWatchItems(userId, dto);
  }

  @Post('watch-items/remove')
  async removeWatchItems(
    @Req() req: Request,
    @Body() dto: WatchItemsRemoveDto,
  ): Promise<{ removed: number }> {
    const { userId } = req.userContext;
    return this.agentService.removeWatchItems(userId, dto);
  }

  @Post('journal')
  async saveJournal(@Req() req: Request, @Body() dto: CreateJournalDto): Promise<JournalEntry> {
    const { userId } = req.userContext;
    return this.agentService.saveJournal(userId, dto);
  }

  @Get('journal')
  async getJournal(@Req() req: Request): Promise<JournalEntry[]> {
    const { userId } = req.userContext;
    return this.agentService.getJournal(userId);
  }

  @Post('snapshot')
  async saveSnapshot(@Req() req: Request, @Body() dto: CreateSnapshotDto): Promise<Snapshot> {
    const { userId } = req.userContext;
    return this.agentService.saveSnapshot(userId, dto);
  }

  @Get('snapshots')
  async getSnapshots(@Req() req: Request): Promise<Snapshot[]> {
    const { userId } = req.userContext;
    return this.agentService.getSnapshots(userId);
  }

  @Post('deep-report')
  async saveDeepReport(
    @Req() req: Request,
    @Body() body: Record<string, unknown>,
  ): Promise<{ ok: boolean; runId: string; deepReportId: string; reportDate: string }> {
    const { userId } = req.userContext;
    return this.agentService.saveDeepReport(userId, body as Parameters<typeof this.agentService.saveDeepReport>[1]);
  }

  @Get('strategy-rules')
  async getStrategyRules(@Req() req: Request) {
    const { userId } = req.userContext;
    return this.agentService.getStrategyRules(userId);
  }

  @Get('deep-report/latest')
  async getLatestDeepReport(@Req() req: Request, @Query('ticker') ticker: string) {
    const { userId } = req.userContext;
    return this.agentService.getLatestDeepReport(userId, ticker);
  }

  @Get('deep-reports')
  async listDeepReports(@Req() req: Request) {
    const { userId } = req.userContext;
    return this.agentService.listDeepReports(userId);
  }
}
