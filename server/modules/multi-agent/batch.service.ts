import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { eq, and } from 'drizzle-orm';
import { holdings, watchlist, agentRuns } from '@server/database/schema';
import { MultiAgentService } from './multi-agent.service';
import { PipelineService } from './pipeline.service';
import { PortfolioContextService } from './portfolio-context.service';
import type {
  BatchRunRequest,
  BatchRunResult,
  BatchRunItem,
  AgentRunMode,
  AgentRunStatus,
} from '@shared/api.interface';

interface QueueItem {
  runId: string;
  userId: string;
  ticker: string;
  runMode: AgentRunMode;
}

@Injectable()
export class BatchService implements OnModuleInit {
  private readonly logger = new Logger(BatchService.name);
  private readonly MAX_FULL_CONCURRENT = 3;
  private readonly MAX_SUMMARY_CONCURRENT = 5;

  private fullRunning = 0;
  private summaryRunning = 0;
  private fullQueue: QueueItem[] = [];
  private summaryQueue: QueueItem[] = [];

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly multiAgentService: MultiAgentService,
    private readonly pipelineService: PipelineService,
    private readonly portfolioContextService: PortfolioContextService,
  ) {}

  onModuleInit(): void {
    this.pipelineService.onRunComplete((runId, userId, mode) => {
      this.releaseSlot(mode);
      this.processQueue();
    });
  }

  async createBatch(userId: string, req: BatchRunRequest): Promise<BatchRunResult> {
    const targets = await this.resolveTargets(userId, req);
    const result: BatchRunResult = {
      created: 0,
      queued: 0,
      running: 0,
      runs: [],
      errors: [],
    };

    for (const target of targets) {
      try {
        const run = await this.multiAgentService.createRun(userId, {
          ticker: target.ticker,
          tickerName: target.company ?? undefined,
          market: target.market ?? undefined,
          triggerType: 'manual',
          runMode: target.runMode,
        });

        const item: BatchRunItem = {
          runId: run.id,
          ticker: run.ticker,
          runMode: run.runMode,
          status: run.status,
        };
        result.runs.push(item);
        result.created += 1;

        const queueItem: QueueItem = {
          runId: run.id,
          userId,
          ticker: target.ticker,
          runMode: target.runMode,
        };

        if (this.canStart(target.runMode)) {
          this.acquireSlot(target.runMode);
          this.pipelineService.startPipeline(run.id, userId);
          item.status = 'fetching';
          result.running += 1;
        } else {
          this.enqueue(queueItem);
          item.status = 'pending';
          result.queued += 1;
        }
      } catch (err) {
        result.errors.push({
          ticker: target.ticker,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return result;
  }

  async createDailyBatch(userId: string): Promise<{
    holdingsRuns: BatchRunItem[];
    watchlistRuns: BatchRunItem[];
    totalCreated: number;
    errors: Array<{ ticker: string; error: string }>;
  }> {
    const holdingsResult = await this.createBatch(userId, {
      scope: 'holdings',
      tiered: true,
    });

    const watchlistItems = await this.getWatchlistTargets(userId);
    const buySignals = watchlistItems.filter((w) => {
      const sig = w.signal ?? '';
      return sig.includes('买入') || sig.includes('强烈');
    });

    const watchlistResult = await this.createBatch(userId, {
      scope: 'custom',
      tickers: buySignals.map((w) => w.ticker),
      tiered: true,
    });

    return {
      holdingsRuns: holdingsResult.runs,
      watchlistRuns: watchlistResult.runs,
      totalCreated: holdingsResult.created + watchlistResult.created,
      errors: [...holdingsResult.errors, ...watchlistResult.errors],
    };
  }

  processQueue(): void {
    while (this.fullRunning < this.MAX_FULL_CONCURRENT && this.fullQueue.length > 0) {
      const item = this.fullQueue.shift();
      if (!item) break;
      this.fullRunning += 1;
      this.logger.log(`Dequeued full run: ${item.ticker} (${item.runId})`);
      this.pipelineService.startPipeline(item.runId, item.userId);
    }

    while (this.summaryRunning < this.MAX_SUMMARY_CONCURRENT && this.summaryQueue.length > 0) {
      const item = this.summaryQueue.shift();
      if (!item) break;
      this.summaryRunning += 1;
      this.logger.log(`Dequeued summary run: ${item.ticker} (${item.runId})`);
      this.pipelineService.startPipeline(item.runId, item.userId);
    }
  }

  private async resolveTargets(
    userId: string,
    req: BatchRunRequest,
  ): Promise<Array<{ ticker: string; company: string | null; market: string | null; runMode: AgentRunMode }>> {
    const portfolio = req.tiered ? await this.portfolioContextService.getPortfolioContext(userId) : null;

    const targets: Array<{ ticker: string; company: string | null; market: string | null; runMode: AgentRunMode }> = [];

    if (req.scope === 'holdings' || req.scope === 'all') {
      const holdingRows = await this.db
        .select()
        .from(holdings)
        .where(eq(holdings.owner, userId));

      for (const h of holdingRows) {
        let runMode: AgentRunMode = 'full';
        if (req.tiered && portfolio) {
          const holding = portfolio.holdings.find(
            (p) => p.ticker.toUpperCase() === h.ticker.toUpperCase(),
          );
          runMode = holding && holding.weightPct > 5 ? 'full' : 'summary';
        }
        targets.push({
          ticker: h.ticker,
          company: h.company,
          market: h.market,
          runMode,
        });
      }
    }

    if (req.scope === 'watchlist' || req.scope === 'all') {
      const watchRows = await this.db
        .select()
        .from(watchlist)
        .where(eq(watchlist.owner, userId));

      for (const w of watchRows) {
        let runMode: AgentRunMode = 'full';
        if (req.tiered) {
          const signal = w.signal ?? '';
          runMode = signal.includes('买入') || signal.includes('强烈') ? 'full' : 'summary';
        }
        targets.push({
          ticker: w.ticker,
          company: w.company,
          market: w.market,
          runMode,
        });
      }
    }

    if (req.scope === 'custom' && req.tickers && req.tickers.length > 0) {
      const [holdingRows, watchRows] = await Promise.all([
        this.db.select().from(holdings).where(eq(holdings.owner, userId)),
        this.db.select().from(watchlist).where(eq(watchlist.owner, userId)),
      ]);

      const tickerUpper = new Set(req.tickers.map((t) => t.toUpperCase()));

      for (const t of req.tickers) {
        const upper = t.toUpperCase();
        const h = holdingRows.find((r) => r.ticker.toUpperCase() === upper);
        const w = watchRows.find((r) => r.ticker.toUpperCase() === upper);

        let runMode: AgentRunMode = 'full';
        let company: string | null = null;
        let market: string | null = null;

        if (h) {
          company = h.company;
          market = h.market;
          if (req.tiered && portfolio) {
            const ph = portfolio.holdings.find(
              (p) => p.ticker.toUpperCase() === upper,
            );
            runMode = ph && ph.weightPct > 5 ? 'full' : 'summary';
          }
        } else if (w) {
          company = w.company;
          market = w.market;
          if (req.tiered) {
            const signal = w.signal ?? '';
            runMode = signal.includes('买入') || signal.includes('强烈') ? 'full' : 'summary';
          }
        }

        targets.push({ ticker: t, company, market, runMode });
      }
    }

    return targets;
  }

  private async getWatchlistTargets(userId: string): Promise<Array<{ ticker: string; signal: string | null }>> {
    const rows = await this.db
      .select({ ticker: watchlist.ticker, signal: watchlist.signal })
      .from(watchlist)
      .where(eq(watchlist.owner, userId));
    return rows;
  }

  private canStart(mode: AgentRunMode): boolean {
    if (mode === 'full') return this.fullRunning < this.MAX_FULL_CONCURRENT;
    return this.summaryRunning < this.MAX_SUMMARY_CONCURRENT;
  }

  private acquireSlot(mode: AgentRunMode): void {
    if (mode === 'full') this.fullRunning += 1;
    else this.summaryRunning += 1;
  }

  private releaseSlot(mode: AgentRunMode): void {
    if (mode === 'full') this.fullRunning = Math.max(0, this.fullRunning - 1);
    else this.summaryRunning = Math.max(0, this.summaryRunning - 1);
  }

  private enqueue(item: QueueItem): void {
    if (item.runMode === 'full') this.fullQueue.push(item);
    else this.summaryQueue.push(item);
    this.logger.log(
      `Queued ${item.runMode} run: ${item.ticker} (queue full=${this.fullQueue.length}, summary=${this.summaryQueue.length})`,
    );
  }
}
