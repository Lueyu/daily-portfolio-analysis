import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Req,
  Param,
  Query,
  ParseUUIDPipe,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';
import { MultiAgentService } from './multi-agent.service';
import { PipelineService } from './pipeline.service';
import { PortfolioContextService } from './portfolio-context.service';
import { BatchService } from './batch.service';
import type {
  AgentRun,
  AgentRunDetail,
  AgentEvidence,
  BullBearArgument,
  DebateRecord,
  AgentRatingRecord,
  RiskGateResult,
  StrategyRule,
  AgentAuditLog,
  CreateAgentRunDto,
  UpdateAgentRunDto,
  CreateEvidenceDto,
  CreateArgumentDto,
  CreateDebateRecordDto,
  CreateAgentRatingDto,
  CreateRiskGateDto,
  UpdateStrategyRuleDto,
  CreateStrategyRuleDto,
  ReorderStrategyRuleDto,
  DeepReport,
  AgentRunStatus,
  HumanDecisionDto,
  PortfolioContext,
  BatchRunRequest,
  BatchRunResult,
  LatestRating,
  AgentRunWithRating,
  AgentRunMode,
  DailyBatchResult,
} from '@shared/api.interface';

interface ListRunsQuery {
  ticker?: string;
  status?: AgentRunStatus;
  runMode?: AgentRunMode;
  from?: string;
  to?: string;
  limit?: string;
  offset?: string;
}

interface EvidenceBatchDto {
  items: CreateEvidenceDto[];
}

interface RiskGateBatchDto {
  items: CreateRiskGateDto[];
}

@NeedLogin()
@Controller('api/multi-agent')
export class MultiAgentController {
  constructor(
    private readonly multiAgentService: MultiAgentService,
    private readonly pipelineService: PipelineService,
    private readonly portfolioContextService: PortfolioContextService,
    private readonly batchService: BatchService,
  ) {}

  @Get('runs')
  async listRuns(
    @Req() req: Request,
    @Query() query: ListRunsQuery,
  ): Promise<{ items: AgentRunWithRating[]; total: number }> {
    const { userId } = req.userContext;
    return this.multiAgentService.listRunsWithRating(userId, {
      ticker: query.ticker,
      status: query.status,
      runMode: query.runMode,
      from: query.from,
      to: query.to,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
      offset: query.offset ? parseInt(query.offset, 10) : undefined,
    });
  }

  @Post('runs/batch')
  @NeedLogin()
  async createBatch(
    @Req() req: Request,
    @Body() dto: BatchRunRequest,
  ): Promise<BatchRunResult> {
    const { userId } = req.userContext;
    return this.batchService.createBatch(userId, dto);
  }

  @Post('daily-batch')
  @NeedLogin()
  async createDailyBatch(@Req() req: Request): Promise<DailyBatchResult> {
    const { userId } = req.userContext;
    return this.batchService.createDailyBatch(userId);
  }

  @Get('latest-ratings')
  @NeedLogin()
  async getLatestRatings(
    @Req() req: Request,
    @Query('tickers') tickers?: string,
  ): Promise<LatestRating[]> {
    const { userId } = req.userContext;
    const tickerList = tickers ? tickers.split(',').map((t) => t.trim()).filter(Boolean) : undefined;
    return this.multiAgentService.getLatestRatings(userId, tickerList);
  }

  @Get('runs/:id')
  async getRun(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AgentRunDetail> {
    const { userId } = req.userContext;
    return this.multiAgentService.getRun(userId, id);
  }

  @Post('runs')
  async createRun(
    @Req() req: Request,
    @Body() dto: CreateAgentRunDto,
  ): Promise<AgentRun> {
    const { userId } = req.userContext;
    return this.multiAgentService.createRun(userId, dto);
  }

  @Patch('runs/:id')
  async updateRun(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAgentRunDto,
  ): Promise<AgentRun> {
    const { userId } = req.userContext;
    return this.multiAgentService.updateRunStatus(userId, id, dto.status, dto);
  }

  @Post('runs/:id/cancel')
  async cancelRun(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AgentRun> {
    const { userId } = req.userContext;
    return this.multiAgentService.cancelRun(userId, id);
  }

  @Get('runs/:id/evidence')
  async getEvidence(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AgentEvidence[]> {
    const { userId } = req.userContext;
    return this.multiAgentService.getEvidence(userId, id);
  }

  @Post('runs/:id/evidence')
  async addEvidence(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EvidenceBatchDto,
  ): Promise<AgentEvidence[]> {
    const { userId } = req.userContext;
    return this.multiAgentService.addEvidence(userId, id, dto.items);
  }

  @Get('runs/:id/arguments')
  async getArguments(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BullBearArgument[]> {
    const { userId } = req.userContext;
    return this.multiAgentService.getArguments(userId, id);
  }

  @Post('runs/:id/arguments')
  async addArgument(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateArgumentDto,
  ): Promise<BullBearArgument> {
    const { userId } = req.userContext;
    return this.multiAgentService.addArgument(userId, id, dto);
  }

  @Get('runs/:id/debate')
  async getDebate(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DebateRecord[]> {
    const { userId } = req.userContext;
    return this.multiAgentService.getDebate(userId, id);
  }

  @Post('runs/:id/debate')
  async addDebateRecord(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateDebateRecordDto,
  ): Promise<DebateRecord> {
    const { userId } = req.userContext;
    return this.multiAgentService.addDebateRecord(userId, id, dto);
  }

  @Get('runs/:id/rating')
  async getRating(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AgentRatingRecord | null> {
    const { userId } = req.userContext;
    return this.multiAgentService.getRating(userId, id);
  }

  @Post('runs/:id/rating')
  async saveRating(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateAgentRatingDto,
  ): Promise<AgentRatingRecord> {
    const { userId } = req.userContext;
    return this.multiAgentService.saveRating(userId, id, dto);
  }

  @Get('runs/:id/risk-gate')
  async getRiskGate(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RiskGateResult[]> {
    const { userId } = req.userContext;
    return this.multiAgentService.getRiskGate(userId, id);
  }

  @Post('runs/:id/risk-gate')
  async saveRiskGate(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RiskGateBatchDto,
  ): Promise<RiskGateResult[]> {
    const { userId } = req.userContext;
    return this.multiAgentService.saveRiskGateResults(userId, id, dto.items);
  }

  @Post('runs/:id/start')
  @NeedLogin()
  async startRun(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ runId: string; status: string }> {
    const { userId } = req.userContext;
    const run = await this.multiAgentService.getRun(userId, id);
    if (run.status !== 'pending' && run.status !== 'failed') {
      throw new BadRequestException(`Run status ${run.status} cannot be started`);
    }
    this.pipelineService.startPipeline(id, userId);
    return { runId: id, status: 'fetching' };
  }

  @Get('runs/:id/status')
  @NeedLogin()
  async getRunStatus(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AgentRunDetail> {
    const { userId } = req.userContext;
    return this.multiAgentService.getRun(userId, id);
  }

  @Post('runs/:id/human-decision')
  @NeedLogin()
  async humanDecision(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: HumanDecisionDto,
  ): Promise<AgentRun> {
    const { userId } = req.userContext;

    if (!['approved', 'modified', 'rejected'].includes(dto.decision)) {
      throw new BadRequestException('Invalid decision value');
    }

    const run = await this.multiAgentService.getRun(userId, id);
    if (run.status !== 'awaiting_human' && run.status !== 'completed') {
      throw new BadRequestException(`Run status ${run.status} does not allow human decision`);
    }

    if (dto.decision === 'rejected') {
      await this.multiAgentService.addAuditLog(userId, id, 'human_rejected', {
        note: dto.note ?? null,
      });
      return this.multiAgentService.updateRunStatus(userId, id, 'cancelled', {
        humanDecision: 'rejected',
        humanNote: dto.note,
      });
    }

    if (dto.decision === 'modified' && dto.modifiedRating) {
      const mr = dto.modifiedRating;
      await this.multiAgentService.saveRating(userId, id, {
        ticker: run.ticker,
        rating: mr.rating,
        confidence: mr.confidence,
        targetPrice: mr.targetPrice,
        action: mr.action,
        bullSummary: mr.bullSummary,
        bearSummary: mr.bearSummary,
        catalysts: mr.catalysts,
        risks: mr.risks,
        aggregationLogic: `人工修改评级，原始评级: ${run.rating?.rating ?? 'N/A'}`,
        keyUncertainty: run.rating?.keyUncertainty ?? undefined,
      });
    }

    if (dto.decision === 'approved' || dto.decision === 'modified') {
      const shouldSync = dto.syncToAnalysis !== false;
      const shouldApply = dto.applyToHoldings === true;

      if (shouldSync) {
        await this.multiAgentService.syncRatingToAnalysis(userId, id);
      }
      if (shouldApply) {
        await this.portfolioContextService.applyRatingToHoldings(userId, id);
      }

      await this.multiAgentService.addAuditLog(userId, id, `human_${dto.decision}` as const, {
        note: dto.note ?? null,
        syncToAnalysis: shouldSync,
        applyToHoldings: shouldApply,
      });
    }

    return this.multiAgentService.updateRunStatus(userId, id, 'completed', {
      humanDecision: dto.decision,
      humanNote: dto.note,
    });
  }

  @Get('strategy-rules')
  async getStrategyRules(@Req() req: Request): Promise<StrategyRule[]> {
    const { userId } = req.userContext;
    return this.multiAgentService.getStrategyRules(userId);
  }

  @Post('strategy-rules')
  @NeedLogin()
  async createStrategyRule(
    @Req() req: Request,
    @Body() dto: CreateStrategyRuleDto,
  ): Promise<StrategyRule> {
    const { userId } = req.userContext;
    return this.multiAgentService.createStrategyRule(userId, dto);
  }

  @Patch('strategy-rules/:id')
  @NeedLogin()
  async updateStrategyRule(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStrategyRuleDto,
  ): Promise<StrategyRule> {
    const { userId } = req.userContext;
    return this.multiAgentService.updateStrategyRule(userId, id, dto);
  }

  @Delete('strategy-rules/:id')
  @NeedLogin()
  async deleteStrategyRule(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ deleted: boolean }> {
    const { userId } = req.userContext;
    await this.multiAgentService.deleteStrategyRule(userId, id);
    return { deleted: true };
  }

  @Post('strategy-rules/reorder')
  @NeedLogin()
  async reorderStrategyRules(
    @Req() req: Request,
    @Body() body: { items: ReorderStrategyRuleDto[] },
  ): Promise<{ updated: number }> {
    const { userId } = req.userContext;
    if (!Array.isArray(body.items) || body.items.length === 0) {
      throw new BadRequestException('items 不能为空');
    }
    const count = await this.multiAgentService.reorderStrategyRules(
      userId,
      body.items,
    );
    return { updated: count };
  }

  @Post('strategy-rules/reset-default')
  @NeedLogin()
  async resetStrategyRules(@Req() req: Request): Promise<StrategyRule[]> {
    const { userId } = req.userContext;
    return this.multiAgentService.resetDefaultStrategyRules(userId);
  }

  @Get('deep-report/:runId')
  @NeedLogin()
  async getDeepReport(
    @Req() req: Request,
    @Param('runId', ParseUUIDPipe) runId: string,
  ): Promise<DeepReport | null> {
    const { userId } = req.userContext;
    return this.multiAgentService.getDeepReport(userId, runId);
  }

  @Post('runs/:id/generate-sample-deep-report')
  @NeedLogin()
  async generateSampleDeepReport(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DeepReport> {
    const { userId } = req.userContext;
    return this.multiAgentService.generateSampleDeepReport(userId, id);
  }

  @Get('audit-logs')
  async getAuditLogs(
    @Req() req: Request,
    @Query('limit') limit?: string,
  ): Promise<AgentAuditLog[]> {
    const { userId } = req.userContext;
    return this.multiAgentService.getAuditLogs(userId, limit ? parseInt(limit, 10) : 20);
  }

  @Get('portfolio-context')
  @NeedLogin()
  async getPortfolioContext(@Req() req: Request): Promise<PortfolioContext> {
    const { userId } = req.userContext;
    return this.portfolioContextService.getPortfolioContext(userId);
  }
}
