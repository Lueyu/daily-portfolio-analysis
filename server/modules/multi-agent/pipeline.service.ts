import { Injectable, Inject, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { eq, and } from 'drizzle-orm';
import { agentRuns } from '@server/database/schema';
import { LlmService } from './llm.service';
import { EvidenceService, type EvidenceInput } from './evidence.service';
import { PortfolioContextService } from './portfolio-context.service';
import type { AgentRunDetail, AgentRunStatus, StrategyRule, AgentRating, AgentConfidence, AgentRunMode } from '@shared/api.interface';
import { MultiAgentService } from './multi-agent.service';

@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name);
  private completeCallbacks: Array<(runId: string, userId: string, mode: AgentRunMode) => void> = [];

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly llmService: LlmService,
    private readonly evidenceService: EvidenceService,
    private readonly portfolioContextService: PortfolioContextService,
    private readonly multiAgentService: MultiAgentService,
  ) {}

  onRunComplete(cb: (runId: string, userId: string, mode: AgentRunMode) => void): void {
    this.completeCallbacks.push(cb);
  }

  private notifyComplete(runId: string, userId: string, mode: AgentRunMode): void {
    for (const cb of this.completeCallbacks) {
      try {
        cb(runId, userId, mode);
      } catch (err) {
        this.logger.error(`Complete callback error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  startPipeline(runId: string, userId: string): void {
    void this.runPipeline(runId, userId).catch((err) => {
      this.logger.error(`Pipeline failed for run ${runId}: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  private async runPipeline(runId: string, userId: string): Promise<void> {
    let tokensUsed = 0;
    const addTokens = (n: number): void => {
      tokensUsed += n;
    };

    try {
      await this.setStatus(runId, userId, 'fetching', { startedAt: new Date() });

      const runDetail = await this.multiAgentService.getRun(userId, runId);
      const ticker = runDetail.ticker;

      if (await this.isCancelled(runId, userId)) return;

      // Phase 1: Evidence collection
      this.logger.log(`Phase 1: Fetching evidence for ${ticker}`);
      const portfolio = await this.portfolioContextService.getPortfolioContext(userId);
      const evidence = await this.evidenceService.collectEvidence(ticker, userId, portfolio);

      await this.multiAgentService.addEvidence(
        userId,
        runId,
        evidence.map((e) => ({
          role: e.role,
          evidenceType: e.evidenceType as 'financial' | 'news' | 'price' | 'indicator' | 'rating' | 'other',
          title: e.title,
          content: e.content,
          sourceUrl: e.sourceUrl,
          sourceName: e.sourceName,
          fetchedAt: new Date().toISOString(),
          relevanceScore: e.relevanceScore,
        })),
      );

      if (await this.isCancelled(runId, userId)) return;

      // Phase 2: Bull/Bear debate
      this.logger.log(`Phase 2: Bull/Bear debate for ${ticker}`);
      await this.setStatus(runId, userId, 'debating');
      const debateTokens = await this.runDebatePhase(runId, userId, ticker, evidence);
      addTokens(debateTokens);

      if (await this.isCancelled(runId, userId)) return;

      // Phase 3: Critique
      this.logger.log(`Phase 3: Critique for ${ticker}`);
      await this.setStatus(runId, userId, 'critiquing');
      const critiqueTokens = await this.runCritiquePhase(runId, userId);
      addTokens(critiqueTokens);

      if (await this.isCancelled(runId, userId)) return;

      // Phase 4: Risk gate
      this.logger.log(`Phase 4: Risk gate for ${ticker}`);
      await this.setStatus(runId, userId, 'risk_check');
      const rules = await this.multiAgentService.getStrategyRules(userId);
      const riskResults = this.portfolioContextService.checkRiskRules(ticker, portfolio, rules);
      await this.multiAgentService.saveRiskGateResults(
        userId,
        runId,
        riskResults.map((r) => ({
          ruleName: r.ruleName,
          ruleType: r.ruleType,
          passed: r.passed,
          currentValue: r.currentValue,
          thresholdValue: r.thresholdValue,
          detail: r.detail,
          suggestedAction: r.suggestedAction,
        })),
      );

      const hasHardFailure = riskResults.some((r) => r.ruleType === 'hard' && !r.passed);

      if (await this.isCancelled(runId, userId)) return;

      // Phase 5: Rating aggregation
      this.logger.log(`Phase 5: Rating aggregation for ${ticker}`);
      const ratingTokens = await this.runRatingPhase(runId, userId, ticker, hasHardFailure, rules);
      addTokens(ratingTokens);

      // Final: awaiting human decision
      await this.setStatus(runId, userId, 'awaiting_human', {
        completedAt: new Date(),
        tokensUsed,
      });

      await this.multiAgentService.addAuditLog(userId, runId, 'run_completed', {
        ticker,
        tokensUsed,
        hasHardFailure,
      });

      this.logger.log(`Pipeline completed for run ${runId} (${ticker}), tokens: ${tokensUsed}`);
      this.notifyComplete(runId, userId, runDetail.runMode);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Pipeline error for run ${runId}: ${errorMsg}`);
      try {
        await this.setStatus(runId, userId, 'failed', {
          errorMessage: errorMsg,
          completedAt: new Date(),
          tokensUsed,
        });
        await this.multiAgentService.addAuditLog(userId, runId, 'run_failed', {
          error: errorMsg,
          tokensUsed,
        });
      } catch (updateErr) {
        this.logger.error(`Failed to update run status to failed: ${updateErr instanceof Error ? updateErr.message : String(updateErr)}`);
      }
      const runDetail = await this.multiAgentService.getRun(userId, runId).catch(() => null);
      if (runDetail) {
        this.notifyComplete(runId, userId, runDetail.runMode);
      }
    }
  }

  private async isCancelled(runId: string, userId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ status: agentRuns.status })
      .from(agentRuns)
      .where(and(eq(agentRuns.id, runId), eq(agentRuns.owner, userId)));
    return row?.status === 'cancelled';
  }

  private async setStatus(
    runId: string,
    userId: string,
    status: AgentRunStatus,
    extra?: { startedAt?: Date; completedAt?: Date; errorMessage?: string; tokensUsed?: number },
  ): Promise<void> {
    const patch: Record<string, unknown> = { status };
    if (extra?.startedAt !== undefined) patch.startedAt = extra.startedAt;
    if (extra?.completedAt !== undefined) patch.completedAt = extra.completedAt;
    if (extra?.errorMessage !== undefined) patch.errorMessage = extra.errorMessage;
    if (extra?.tokensUsed !== undefined) patch.tokensUsed = extra.tokensUsed;

    await this.db
      .update(agentRuns)
      .set(patch)
      .where(and(eq(agentRuns.id, runId), eq(agentRuns.owner, userId)));
  }

  private async runDebatePhase(
    runId: string,
    userId: string,
    ticker: string,
    evidence: EvidenceInput[],
  ): Promise<number> {
    const evidenceText = this.formatEvidence(evidence);
    let totalTokens = 0;

    const bullPrompt = `你是一位看多的股票研究员（Bull Analyst）。请仔细阅读以下关于 ${ticker} 的证据，列出 3-4 条看多理由。每条理由必须引用具体的证据数据，要有数字支撑，不要泛泛而谈。

【证据】
${evidenceText}

请以 JSON 格式返回：
{
  "arguments": [
    { "point": "理由标题", "evidence_refs": ["引用的证据标题"] },
    ...
  ]
}`;

    const bearPrompt = `你是一位看空的股票研究员（Bear Analyst）。请仔细阅读以下关于 ${ticker} 的证据，列出 3-4 条看空理由。每条理由必须引用具体的证据数据，要有数字支撑，不要泛泛而谈。

【证据】
${evidenceText}

请以 JSON 格式返回：
{
  "arguments": [
    { "point": "理由标题", "evidence_refs": ["引用的证据标题"] },
    ...
  ]
}`;

    const [bullResult, bearResult] = await Promise.all([
      this.llmService.chatSlowJSON([{ role: 'user', content: bullPrompt }]),
      this.llmService.chatSlowJSON([{ role: 'user', content: bearPrompt }]),
    ]);

    totalTokens += bullResult.tokens + bearResult.tokens;

    const bullArgs = this.extractArguments(bullResult.data);
    const bearArgs = this.extractArguments(bearResult.data);

    await Promise.all([
      ...bullArgs.map((arg, i) =>
        this.multiAgentService.addArgument(userId, runId, {
          side: 'bull',
          round: 1,
          argument: arg.point,
          evidenceIds: arg.evidence_refs,
        }),
      ),
      ...bearArgs.map((arg, i) =>
        this.multiAgentService.addArgument(userId, runId, {
          side: 'bear',
          round: 1,
          argument: arg.point,
          evidenceIds: arg.evidence_refs,
        }),
      ),
      this.multiAgentService.addDebateRecord(userId, runId, {
        round: 1,
        speaker: 'bull',
        content: `【第一轮 - 多头论点】\n${bullArgs.map((a, i) => `${i + 1}. ${a.point}`).join('\n')}`,
        tokensUsed: bullResult.tokens,
      }),
      this.multiAgentService.addDebateRecord(userId, runId, {
        round: 1,
        speaker: 'bear',
        content: `【第一轮 - 空头论点】\n${bearArgs.map((a, i) => `${i + 1}. ${a.point}`).join('\n')}`,
        tokensUsed: bearResult.tokens,
      }),
    ]);

    const bullSummary = bullArgs.map((a) => a.point).join('; ');
    const bearSummary = bearArgs.map((a) => a.point).join('; ');

    const bullRebuttalPrompt = `你是多头研究员。对方（空头）提出了以下看空论点，请逐一回应，指出其漏洞或不成立之处，并坚持你的看多立场。

【空头论点】
${bearArgs.map((a, i) => `${i + 1}. ${a.point}`).join('\n')}

【你的原始立场】
${bullArgs.map((a, i) => `${i + 1}. ${a.point}`).join('\n')}

请以 JSON 格式返回：
{
  "arguments": [
    { "point": "回应内容" },
    ...
  ]
}`;

    const bearRebuttalPrompt = `你是空头研究员。对方（多头）提出了以下看多论点，请逐一回应，指出其漏洞或不成立之处，并坚持你的看空立场。

【多头论点】
${bullArgs.map((a, i) => `${i + 1}. ${a.point}`).join('\n')}

【你的原始立场】
${bearArgs.map((a, i) => `${i + 1}. ${a.point}`).join('\n')}

请以 JSON 格式返回：
{
  "arguments": [
    { "point": "回应内容" },
    ...
  ]
}`;

    try {
      const [bullRebuttal, bearRebuttal] = await Promise.all([
        this.llmService.chatSlowJSON([{ role: 'user', content: bullRebuttalPrompt }]),
        this.llmService.chatSlowJSON([{ role: 'user', content: bearRebuttalPrompt }]),
      ]);

      totalTokens += bullRebuttal.tokens + bearRebuttal.tokens;

      const bullRebuttalArgs = this.extractArguments(bullRebuttal.data);
      const bearRebuttalArgs = this.extractArguments(bearRebuttal.data);

      await Promise.all([
        ...bullRebuttalArgs.map((arg) =>
          this.multiAgentService.addArgument(userId, runId, {
            side: 'bull',
            round: 2,
            argument: arg.point,
          }),
        ),
        ...bearRebuttalArgs.map((arg) =>
          this.multiAgentService.addArgument(userId, runId, {
            side: 'bear',
            round: 2,
            argument: arg.point,
          }),
        ),
        this.multiAgentService.addDebateRecord(userId, runId, {
          round: 2,
          speaker: 'bull',
          content: `【第二轮 - 多头反驳】\n${bullRebuttalArgs.map((a, i) => `${i + 1}. ${a.point}`).join('\n')}`,
          tokensUsed: bullRebuttal.tokens,
        }),
        this.multiAgentService.addDebateRecord(userId, runId, {
          round: 2,
          speaker: 'bear',
          content: `【第二轮 - 空头反驳】\n${bearRebuttalArgs.map((a, i) => `${i + 1}. ${a.point}`).join('\n')}`,
          tokensUsed: bearRebuttal.tokens,
        }),
      ]);
    } catch (rebuttalErr) {
      this.logger.warn(`Debate round 2 failed: ${rebuttalErr instanceof Error ? rebuttalErr.message : String(rebuttalErr)}`);
    }

    return totalTokens;
  }

  private async runCritiquePhase(runId: string, userId: string): Promise<number> {
    const detail = await this.multiAgentService.getRun(userId, runId);

    const bullArgs = detail.arguments
      .filter((a) => a.side === 'bull')
      .map((a) => `[第${a.round}轮] ${a.argument}`)
      .join('\n');

    const bearArgs = detail.arguments
      .filter((a) => a.side === 'bear')
      .map((a) => `[第${a.round}轮] ${a.argument}`)
      .join('\n');

    const critiquePrompt = `你是一位资深投资评论家（Critic）。请阅读以下多空双方的辩论，尖锐地指出：

1. 多头论点中最薄弱的环节是什么？为什么？
2. 空头论点中最薄弱的环节是什么？为什么？
3. 双方都忽略了哪些关键风险或机会？
4. 双方在数据使用或推理中存在哪些逻辑漏洞？

请务必具体、犀利，不要和稀泥。

【多头论点】
${bullArgs || '（无）'}

【空头论点】
${bearArgs || '（无）'}`;

    const result = await this.llmService.chatSlow([{ role: 'user', content: critiquePrompt }]);

    await this.multiAgentService.addDebateRecord(userId, runId, {
      round: 3,
      speaker: 'critic',
      content: result.content,
      tokensUsed: result.totalTokens,
    });

    return result.totalTokens;
  }

  private async runRatingPhase(
    runId: string,
    userId: string,
    ticker: string,
    hasHardFailure: boolean,
    rules: StrategyRule[],
  ): Promise<number> {
    const detail = await this.multiAgentService.getRun(userId, runId);

    const evidenceSummary = detail.evidence
      .slice(0, 8)
      .map((e) => `- [${e.role}] ${e.title}: ${e.content.slice(0, 150)}`)
      .join('\n');

    const bullArgs = detail.arguments
      .filter((a) => a.side === 'bull')
      .map((a) => `- ${a.argument}`)
      .join('\n');

    const bearArgs = detail.arguments
      .filter((a) => a.side === 'bear')
      .map((a) => `- ${a.argument}`)
      .join('\n');

    const criticEntry = detail.debate.find((d) => d.speaker === 'critic');

    const riskSummary = detail.riskGate
      .map((r) => `- [${r.ruleType}] ${r.ruleName}: ${r.passed ? '通过' : '未通过'} (当前${r.currentValue ?? 'N/A'}/阈值${r.thresholdValue ?? 'N/A'})`)
      .join('\n');

    const hardRules = rules.filter((r) => r.ruleType === 'hard').map((r) => r.ruleName).join('、');

    const ratingPrompt = `你是一位资深投资组合经理（Portfolio Manager）。请基于以下所有信息，给出对 ${ticker} 的最终投资评级和操作建议。

【重要约束】
${hasHardFailure ? `- ⚠️ 风控硬规则（${hardRules}）未通过，评级不得为 Strong Buy 或 Buy，最高只能给 Hold。` : `- 风控硬规则全部通过。`}
- 如果置信度为 low，评级应为 Watch，而非 Buy 或 Sell。
- rating 可选值：Strong Buy / Buy / Hold / Sell / Strong Sell / Watch
- confidence 可选值：high / medium / low

【证据摘要】
${evidenceSummary}

【多头论点】
${bullArgs || '（无）'}

【空头论点】
${bearArgs || '（无）'}

【Critic 评论】
${criticEntry?.content ?? '（无）'}

【风控检查结果】
${riskSummary}

请以 JSON 格式返回：
{
  "rating": "Buy/Hold/Sell/Watch/Strong Buy/Strong Sell",
  "confidence": "high/medium/low",
  "target_price": 数字或null,
  "action": "具体操作建议（如：逢低买入、持有观望、减仓一半等）",
  "aggregation_logic": "为什么是这个评级，综合了哪些因素",
  "key_uncertainty": "主要不确定性因素",
  "bull_summary": "多头要点总结（1-2句话）",
  "bear_summary": "空头要点总结（1-2句话）",
  "catalysts": "主要催化剂（用1) ... 2) ...编号）",
  "risks": "主要风险（用1) ... 2) ...编号）"
}`;

    const result = await this.llmService.chatSlowJSON([{ role: 'user', content: ratingPrompt }]);

    const data = result.data as Record<string, unknown>;

    let rating = String(data.rating ?? 'Watch').trim() as AgentRating;
    const confidence = String(data.confidence ?? 'low').trim().toLowerCase() as AgentConfidence;

    const validRatings: AgentRating[] = ['Strong Buy', 'Buy', 'Hold', 'Sell', 'Strong Sell', 'Watch'];
    if (!validRatings.includes(rating)) {
      rating = 'Watch';
    }

    if (hasHardFailure && (rating === 'Buy' || rating === 'Strong Buy')) {
      rating = 'Hold';
    }
    if (confidence === 'low' && (rating === 'Buy' || rating === 'Sell' || rating === 'Strong Buy' || rating === 'Strong Sell')) {
      rating = 'Watch';
    }

    await this.multiAgentService.saveRating(userId, runId, {
      ticker,
      rating,
      confidence: confidence as 'high' | 'medium' | 'low',
      targetPrice: data.target_price !== null && data.target_price !== undefined ? Number(data.target_price) : undefined,
      action: String(data.action ?? ''),
      aggregationLogic: data.aggregation_logic ? String(data.aggregation_logic) : undefined,
      keyUncertainty: data.key_uncertainty ? String(data.key_uncertainty) : undefined,
      bullSummary: data.bull_summary ? String(data.bull_summary) : undefined,
      bearSummary: data.bear_summary ? String(data.bear_summary) : undefined,
      catalysts: data.catalysts ? String(data.catalysts) : undefined,
      risks: data.risks ? String(data.risks) : undefined,
    });

    return result.tokens;
  }

  private formatEvidence(evidence: EvidenceInput[]): string {
    return evidence
      .map(
        (e, i) =>
          `证据 ${i + 1} [${e.role}/${e.evidenceType}] ${e.title}\n内容: ${e.content}\n来源: ${e.sourceName ?? '未知'}\n相关度: ${e.relevanceScore}`,
      )
      .join('\n\n');
  }

  private extractArguments(data: unknown): Array<{ point: string; evidence_refs: string[] }> {
    if (!data || typeof data !== 'object') return [];
    const obj = data as Record<string, unknown>;
    const args = obj.arguments;
    if (!Array.isArray(args)) return [];

    return args
      .filter((a): a is Record<string, unknown> => typeof a === 'object' && a !== null)
      .map((a) => ({
        point: String(a.point ?? ''),
        evidence_refs: Array.isArray(a.evidence_refs)
          ? (a.evidence_refs as string[]).map(String)
          : [],
      }))
      .filter((a) => a.point.length > 0);
  }
}
