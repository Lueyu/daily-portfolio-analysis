import {
  BadRequestException, Inject, Injectable, Logger, NotFoundException, type OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '../../common/platform';
import { builderProfiles, paperOrders } from '../../database/schema';
import { councilMessages, councilReports, councilSessions } from '../../database/council.schema';
import { llmBudgetUsage } from '../../database/llm-budget.schema';
import { LlmService } from '../multi-agent/llm.service';
import { EvidenceService } from '../multi-agent/evidence.service';
import { PortfolioContextService } from '../multi-agent/portfolio-context.service';
import { MultiAgentService } from '../multi-agent/multi-agent.service';
import { safeAnalysisError } from '../multi-agent/analysis-report';
import { normalizeBuilderConfig } from '../paper-trading/agent-builder.rules';
import type { BuilderConfig, BuilderProfile } from '@shared/api.interface';
import type {
  CouncilCandidate, CouncilMember, CouncilReport, CouncilReviewResult, CouncilSession,
} from '@shared/council.interface';
import {
  byteExcerpt, cacheKey, councilPrompt, criticalEvidenceGaps, DEFAULT_MEMBERS, eligibleApproval, evidenceExcerpts,
  isRuleCandidate, normalizeCandidate, normalizeTicker, parseOpinion,
  type CouncilEvidence, type CouncilOpinion,
} from './council.rules';

type SessionRow = typeof councilSessions.$inferSelect;
type ReportRow = typeof councilReports.$inferSelect;
interface ResearchSnapshot { evidence: CouncilEvidence[]; sourceRunId: string | null }
interface MemberOutput { member: CouncilMember; opinion: CouncilOpinion; tokens: number }

@Injectable()
export class CouncilService implements OnModuleInit {
  private readonly logger = new Logger(CouncilService.name);
  private readonly jobs = new Map<string, Promise<void>>();
  private readonly candidateJobs = new Map<string, Promise<CouncilReviewResult>>();

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly llm: LlmService,
    private readonly evidence: EvidenceService,
    private readonly portfolio: PortfolioContextService,
    private readonly research: MultiAgentService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Recovery changes lifecycle only. It never resumes model calls or touches order execution.
    await this.db.update(councilSessions).set({ status: 'paused', revision: sql`${councilSessions.revision} + 1`,
      error: 'Server restarted. Resume this discussion explicitly.', updatedAt: new Date() })
      .where(eq(councilSessions.status, 'running'));
  }

  async listSessions(userId: string): Promise<CouncilSession[]> {
    const rows = await this.db.select().from(councilSessions).where(eq(councilSessions.owner, userId))
      .orderBy(desc(councilSessions.updatedAt)).limit(50);
    return Promise.all(rows.map((row) => this.hydrate(userId, row)));
  }

  async createSession(userId: string, input: { profileId: string; ticker: string; language?: 'zh-CN' | 'en' }): Promise<CouncilSession> {
    if (!input || typeof input !== 'object') throw new BadRequestException('Council input is required');
    this.assertId(input.profileId);
    const ticker = this.validateTicker(input.ticker);
    if (input.language !== undefined && input.language !== 'en' && input.language !== 'zh-CN') {
      throw new BadRequestException('Language must be zh-CN or en');
    }
    const profile = await this.getProfile(userId, input.profileId);
    const row = await this.insertSession(userId, profile, ticker, input.language ?? 'zh-CN');
    return this.hydrate(userId, row);
  }

  async getSession(userId: string, id: string): Promise<CouncilSession> {
    return this.hydrate(userId, await this.requireSession(userId, id));
  }

  async addMessage(userId: string, id: string, content: unknown): Promise<CouncilSession> {
    this.assertId(id);
    if (typeof content !== 'string' || !content.trim() || content.trim().length > 2000) {
      throw new BadRequestException('Message must contain 1–2000 characters');
    }
    await this.db.transaction(async (tx) => {
      const [current] = await tx.select().from(councilSessions)
        .where(and(eq(councilSessions.owner, userId), eq(councilSessions.id, id))).for('update');
      if (!current) throw new NotFoundException('Council session not found');
      const [counts] = await tx.select({ count: sql<number>`count(*)` }).from(councilMessages)
        .where(and(eq(councilMessages.owner, userId), eq(councilMessages.sessionId, id), eq(councilMessages.role, 'user')));
      if (Number(counts?.count) >= 30) throw new BadRequestException('This discussion has reached 30 user messages');
      const revision = current.revision + 1;
      await tx.insert(councilMessages).values({ owner: userId, sessionId: id, role: 'user', memberName: 'You',
        content: content.trim(), revision, tokensUsed: 0 });
      const held = current.status === 'failed' || current.status === 'paused';
      await tx.update(councilSessions).set({ revision, updatedAt: new Date(), error: held ? current.error : null,
        status: current.status === 'running' || held ? current.status : 'idle' })
        .where(and(eq(councilSessions.owner, userId), eq(councilSessions.id, id)));
    });
    return this.getSession(userId, id);
  }

  async pauseSession(userId: string, id: string): Promise<CouncilSession> {
    this.assertId(id);
    const [row] = await this.db.update(councilSessions).set({ status: 'paused',
      revision: sql`${councilSessions.revision} + 1`, updatedAt: new Date() })
      .where(and(eq(councilSessions.owner, userId), eq(councilSessions.id, id))).returning();
    if (!row) throw new NotFoundException('Council session not found');
    return this.hydrate(userId, row);
  }

  async runSession(userId: string, id: string): Promise<CouncilSession> {
    this.assertId(id);
    const { row, started } = await this.db.transaction(async (tx) => {
      const [current] = await tx.select().from(councilSessions)
        .where(and(eq(councilSessions.owner, userId), eq(councilSessions.id, id))).for('update');
      if (!current) throw new NotFoundException('Council session not found');
      if (current.status === 'running') return { row: current, started: false };
      // The task budget is deliberately retained across resumes and user revisions.
      const [started] = await tx.update(councilSessions).set({ status: 'running',
        revision: current.revision + 1, error: null, updatedAt: new Date(),
        // Explicit follow-ups use current credentials/data, without erasing old reports or budget usage.
        ...(!current.candidate || current.revision > 1
          ? { evidenceSnapshot: [], sourceRunId: null, cacheKey: null } : {}) })
        .where(and(eq(councilSessions.owner, userId), eq(councilSessions.id, id))).returning();
      return { row: started, started: true };
    });
    if (!started) return this.hydrate(userId, row);
    const active = this.jobs.get(`${userId}:${id}`);
    if (active) {
      // A resume can arrive while a paused provider request is still draining.
      // Enqueue exactly that explicit resume after the old job releases its slot.
      void active.then(async () => {
        const current = await this.requireSession(userId, id);
        if (current.status === 'running') this.launch(userId, id);
      }).catch(() => this.logger.error(`Council session ${id} could not resume`));
    } else this.launch(userId, row.id);
    return this.hydrate(userId, row);
  }

  async reviewCandidate(userId: string, profile: BuilderProfile, input: CouncilCandidate): Promise<CouncilReviewResult> {
    let candidate: CouncilCandidate;
    try { candidate = normalizeCandidate(input); } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Invalid candidate');
    }
    const current = await this.getProfile(userId, profile.id);
    if (current.version !== profile.version) throw new BadRequestException('Agent profile changed before council review');
    const key = `${userId}:${profile.id}:${profile.version}:${candidate.ticker}:${candidate.side}`;
    const active = this.candidateJobs.get(key);
    if (active) {
      await active;
      // A concurrent scan must revalidate its own exact candidate against the persisted result.
    }
    const work = this.reviewCandidateOnce(userId, current, candidate);
    this.candidateJobs.set(key, work);
    try { return await work; } finally {
      if (this.candidateJobs.get(key) === work) this.candidateJobs.delete(key);
    }
  }

  async attachPaperOrder(userId: string, reportId: string, orderId: string): Promise<void> {
    this.assertId(reportId);
    this.assertId(orderId);
    const [report] = await this.db.select().from(councilReports)
      .where(and(eq(councilReports.owner, userId), eq(councilReports.id, reportId)));
    if (!report) throw new NotFoundException('Council report not found');
    await this.db.transaction(async (tx) => {
      const [session] = await tx.select().from(councilSessions)
        .where(and(eq(councilSessions.owner, userId), eq(councilSessions.id, report.sessionId))).for('update');
      const [order] = await tx.select().from(paperOrders)
        .where(and(eq(paperOrders.owner, userId), eq(paperOrders.id, orderId)));
      if (!session || !order) throw new NotFoundException('Council session or paper order not found');
      if (report.decision !== 'approve' || report.revision !== session.revision || session.status !== 'completed'
        || !report.candidate || report.candidate.ticker !== order.ticker || report.candidate.side !== order.side
        || report.candidate.quantity !== Number(order.quantity)) {
        throw new BadRequestException('Paper order does not match a current council approval');
      }
      const [linked] = await tx.update(councilReports).set({ paperOrderId: orderId })
        .where(and(eq(councilReports.owner, userId), eq(councilReports.id, reportId),
          sql`(${councilReports.paperOrderId} IS NULL OR ${councilReports.paperOrderId} = ${orderId})`)).returning();
      if (!linked) throw new BadRequestException('Council approval was already used');
    });
  }

  private async reviewCandidateOnce(userId: string, profile: BuilderProfile, candidate: CouncilCandidate): Promise<CouncilReviewResult> {
    const snapshot = await this.collectSnapshot(userId, candidate.ticker, profile.config.language ?? 'zh-CN', profile.config, candidate);
    const key = cacheKey(userId, profile.id, profile.version, candidate, snapshot.evidence, snapshot.sourceRunId);
    const rows = await this.db.select().from(councilSessions).where(and(eq(councilSessions.owner, userId),
      eq(councilSessions.cacheKey, key), gte(councilSessions.createdAt, new Date(Date.now() - 24 * 3600_000))))
      .orderBy(desc(councilSessions.createdAt)).limit(8);
    const modelConfigured = await this.llm.isConfigured(userId);
    for (const row of rows) {
      const session = await this.hydrate(userId, row);
      const report = session.reports.at(-1);
      if (!report || report.revision !== session.revision || !['completed', 'failed'].includes(session.status)) continue;
      // Configuring a previously absent model is actionable new information.
      if (report.engine === 'basic' && modelConfigured) continue;
      if (report.decision !== 'approve') return this.reviewResult(row, report, candidate);
      if (Date.now() - Date.parse(report.createdAt) <= 30 * 60_000
        && this.reviewResult(row, report, candidate).approved) return this.reviewResult(row, report, candidate);
    }
    const row = await this.insertSession(userId, profile, candidate.ticker, profile.config.language ?? 'zh-CN', candidate, snapshot, key);
    await this.runSession(userId, row.id);
    await this.jobs.get(`${userId}:${row.id}`);
    const latest = await this.requireSession(userId, row.id);
    const session = await this.hydrate(userId, latest);
    return this.reviewResult(latest, session.reports.at(-1) ?? null, candidate);
  }

  private reviewResult(row: SessionRow, report: CouncilReport | null, candidate: CouncilCandidate): CouncilReviewResult {
    const approved = Boolean(report && eligibleApproval({ status: row.status, revision: row.revision,
      reportRevision: report.revision, decision: report.decision, candidate, reviewedCandidate: report.candidate,
      hasCriticalGaps: criticalEvidenceGaps(row.evidenceSnapshot), ruleOnly: isRuleCandidate(row.profileSnapshot, candidate),
      paperOrderId: report.paperOrderId }));
    return { approved, reason: report?.summary ?? 'Council review is paused or incomplete',
      sessionId: row.id, reportId: report?.id ?? null };
  }

  private launch(userId: string, id: string): void {
    const key = `${userId}:${id}`;
    if (this.jobs.has(key)) return;
    const job = this.execute(userId, id).catch(async () => {
      this.logger.error(`Council session ${id} could not finish`);
      await this.db.update(councilSessions).set({ status: 'failed', error: 'Council could not finish. Please retry.', updatedAt: new Date() })
        .where(and(eq(councilSessions.owner, userId), eq(councilSessions.id, id), eq(councilSessions.status, 'running')));
    }).finally(() => { this.jobs.delete(key); });
    this.jobs.set(key, job);
    // The catch above persists a safe terminal status. Avoid an unhandled rejection if storage is down too.
    void job.catch(() => this.logger.error(`Council session ${id} storage unavailable`));
  }

  private async execute(userId: string, id: string): Promise<void> {
    // At most three revision attempts; user steering cannot reset the persistent task budget.
    for (let attempt = 0; attempt < 3; attempt++) {
      let row = await this.requireSession(userId, id);
      if (row.status !== 'running') return;
      if (!row.evidenceSnapshot.length) {
        const snapshot = await this.collectSnapshot(userId, row.ticker, row.language, row.profileSnapshot, row.candidate, true);
        await this.db.update(councilSessions).set({ evidenceSnapshot: snapshot.evidence, sourceRunId: snapshot.sourceRunId })
          .where(and(eq(councilSessions.owner, userId), eq(councilSessions.id, id),
            eq(councilSessions.status, 'running'), eq(councilSessions.revision, row.revision)));
        row = await this.requireSession(userId, id);
        if (row.status !== 'running') return;
        if (!row.evidenceSnapshot.length) continue;
      }
      const revision = row.revision;
      const en = row.language === 'en';
      try {
        if (!(await this.llm.isConfigured(userId))) {
          await this.publish(userId, row, { decision: 'wait',
            summary: en ? 'Basic mode: no model is configured. No AI member discussion occurred; wait for a configured model and sufficient evidence.'
              : '基础模式：尚未配置模型，未进行 AI 成员讨论；等待模型配置和充分证据。',
            dissent: [], nextReviewCondition: en ? 'Configure a model, then review verified evidence.' : '配置模型后重新审查已核实证据。', evidenceIds: [] }, 'basic', null);
        } else {
          const members = this.members(row.profileSnapshot);
          const reviewers = members.filter((member) => member.role !== 'manager');
          const results = await Promise.allSettled(reviewers.map((member) => this.runMember(userId, row, member, [])));
          const current = await this.requireSession(userId, id);
          if (current.status !== 'running') return;
          if (current.revision !== revision) continue;
          const failure = results.find((result) => result.status === 'rejected');
          if (failure?.status === 'rejected') throw failure.reason;
          const opinions = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
          const manager = members.find((member) => member.role === 'manager');
          const final = await this.runMember(userId, row, manager, opinions);
          const opinion = { ...final.opinion, dissent: [...new Set([
            ...final.opinion.dissent, ...opinions.flatMap((result) => result.opinion.dissent),
            ...opinions.filter((result) => result.opinion.decision !== final.opinion.decision)
              .map((result) => `${result.member.name}: ${result.opinion.summary}`),
          ])].slice(0, 12) };
          if (opinion.decision === 'approve' && criticalEvidenceGaps(row.evidenceSnapshot)
            && !isRuleCandidate(row.profileSnapshot, row.candidate)) {
            opinion.decision = 'wait';
            opinion.summary = en ? 'Critical research evidence is missing; approval is withheld. ' + opinion.summary
              : '关键研究证据缺失，暂缓批准。' + opinion.summary;
            opinion.nextReviewCondition = en ? 'Obtain verified financial statements and current market evidence.' : '补齐经核实的财务报表和当前市场证据。';
          }
          await this.publish(userId, row, opinion, 'llm', null);
        }
      } catch (error) {
        const budget = /budget|limit|quota|LLM_BUDGET/iu.test(error instanceof Error ? error.message : '');
        const reason = safeAnalysisError(error, row.language);
        await this.publish(userId, row, { decision: 'wait', summary: reason, dissent: [],
          nextReviewCondition: budget
            ? en ? 'Review the specific limit in Research budget; continuing does not reset this discussion’s usage.'
              : '请在研究预算中检查对应上限；继续讨论不会重置本次已用额度。'
            : en ? 'Restore the data/model service and explicitly retry.' : '恢复数据或模型服务后手动重试。', evidenceIds: [] }, 'llm', reason);
      }
      const current = await this.requireSession(userId, id);
      if (current.status !== 'running') return;
      if (current.revision === revision) return;
    }
    const row = await this.requireSession(userId, id);
    if (row.status === 'running') {
      const published = await this.publish(userId, row, { decision: 'wait', summary: row.language === 'en'
        ? 'Steering changed repeatedly. Review the latest message and resume; the same task budget still applies.'
        : '讨论内容多次变更，已停止自动重跑。请检查最新留言并手动继续，仍使用同一任务预算。',
      dissent: [], nextReviewCondition: row.language === 'en' ? 'Resume with stable instructions.' : '确定讨论要求后手动继续。', evidenceIds: [] }, 'llm', null);
      if (!published) await this.db.update(councilSessions)
        .set({ status: 'paused', error: 'Steering changed repeatedly. Resume explicitly.', updatedAt: new Date() })
        .where(and(eq(councilSessions.owner, userId), eq(councilSessions.id, id), eq(councilSessions.status, 'running')));
    }
  }

  private async runMember(userId: string, row: SessionRow, member: CouncilMember, previous: MemberOutput[]): Promise<MemberOutput> {
    const current = await this.requireSession(userId, row.id);
    if (current.status !== 'running' || current.revision !== row.revision) throw new Error('Council revision changed');
    const messages = await this.db.select().from(councilMessages)
      .where(and(eq(councilMessages.owner, userId), eq(councilMessages.sessionId, row.id), eq(councilMessages.role, 'user')))
      .orderBy(councilMessages.createdAt).limit(30);
    const [lastReport] = await this.db.select({ revision: councilReports.revision }).from(councilReports)
      .where(and(eq(councilReports.owner, userId), eq(councilReports.sessionId, row.id)))
      .orderBy(desc(councilReports.version)).limit(1);
    const previousDiscussion = lastReport ? await this.db.select().from(councilMessages)
      .where(and(eq(councilMessages.owner, userId), eq(councilMessages.sessionId, row.id),
        eq(councilMessages.revision, lastReport.revision), sql`${councilMessages.role} IN ('researcher', 'challenger', 'manager')`))
      .orderBy(councilMessages.createdAt).limit(3) : [];
    const data = { ticker: row.ticker, candidate: row.candidate, ruleOnly: isRuleCandidate(row.profileSnapshot, row.candidate),
      criticalEvidenceMissing: criticalEvidenceGaps(row.evidenceSnapshot),
      profile: { template: row.profileSnapshot.template, maxOrderPct: row.profileSnapshot.maxOrderPct,
        dailyLossLimitPct: row.profileSnapshot.dailyLossLimitPct, customPrompt: row.profileSnapshot.customPrompt },
      customization: member.instructions,
      // Keep all human instructions intact. Oversized requests fail closed at the shared budget gate.
      steering: messages.map((item) => item.content),
      // Published conclusions are conversational context, not new factual evidence.
      previousDiscussion: previousDiscussion.map((item) => ({ role: item.role, content: byteExcerpt(item.content, 140) })),
      evidenceExcerpts: true, evidence: evidenceExcerpts(row.evidenceSnapshot),
      gaps: row.evidenceSnapshot.filter((item) => item.sourceName === 'Data Unavailable').slice(0, 3)
        .map((item) => ({ title: byteExcerpt(item.title, 60), detail: byteExcerpt(item.content, 160) })),
      publishedOpinions: previous.map((item) => ({ role: item.member.role, decision: item.opinion.decision,
        summary: byteExcerpt(item.opinion.summary, 240), dissent: item.opinion.dissent.slice(0, 1)
          .map((text) => byteExcerpt(text, 100)), evidenceIds: item.opinion.evidenceIds.slice(0, 3) })),
    };
    const prompt = [{ role: 'system' as const, content: councilPrompt(member.role, row.language) },
      { role: 'user' as const, content: JSON.stringify(data) }];
    const options = { taskId: row.taskId, purpose: `council:${member.role}`, maxOutputTokens: 900,
      shouldContinue: async () => {
        const latest = await this.requireSession(userId, row.id);
        return latest.status === 'running' && latest.revision === row.revision;
      } };
    const result = member.model === 'slow'
      ? await this.llm.chatSlowJSON(prompt, userId, options)
      : await this.llm.chatFastJSON(prompt, userId, options);
    const validIds = new Set(data.evidence.map((item) => item.id));
    const opinion = parseOpinion(result.data, validIds);
    const tokens = Number.isFinite(result.tokens) ? Math.max(0, Math.trunc(result.tokens)) : 0;
    await this.db.insert(councilMessages).values({ owner: userId, sessionId: row.id, role: member.role,
      memberName: member.name, revision: row.revision, tokensUsed: tokens,
      content: [opinion.summary, ...opinion.dissent, opinion.nextReviewCondition].filter(Boolean).join('\n\n') });
    return { member, opinion, tokens };
  }

  private async publish(userId: string, row: SessionRow, opinion: CouncilOpinion, engine: 'basic' | 'llm', error: string | null): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [current] = await tx.select().from(councilSessions)
        .where(and(eq(councilSessions.owner, userId), eq(councilSessions.id, row.id))).for('update');
      if (!current || current.status !== 'running' || current.revision !== row.revision) return false;
      const [latest] = await tx.select({ version: councilReports.version }).from(councilReports)
        .where(and(eq(councilReports.owner, userId), eq(councilReports.sessionId, row.id)))
        .orderBy(desc(councilReports.version)).limit(1);
      const [usage] = await tx.select({ total: sql<number>`coalesce(sum(${llmBudgetUsage.chargedTokens}), 0)` })
        .from(llmBudgetUsage).where(and(eq(llmBudgetUsage.owner, userId), eq(llmBudgetUsage.taskId, row.taskId)));
      await tx.insert(councilReports).values({ owner: userId, sessionId: row.id, version: (latest?.version ?? 0) + 1,
        revision: row.revision, decision: opinion.decision, summary: opinion.summary, dissent: opinion.dissent,
        nextReviewCondition: opinion.nextReviewCondition, sourceRunId: row.sourceRunId,
        candidate: row.candidate, engine, tokensUsed: Math.min(2_147_483_647, Number(usage?.total ?? 0)),
        evidence: row.evidenceSnapshot.map(({ id, title, content, sourceUrl, fetchedAt }) => ({ id, title, content, sourceUrl, fetchedAt })) });
      await tx.update(councilSessions).set({ status: error ? 'failed' : 'completed', error, updatedAt: new Date() })
        .where(and(eq(councilSessions.owner, userId), eq(councilSessions.id, row.id)));
      return true;
    });
  }

  private async collectSnapshot(userId: string, ticker: string, language: 'zh-CN' | 'en',
    config: BuilderConfig, candidate: CouncilCandidate | null, fresh = false): Promise<ResearchSnapshot> {
    const evidence: CouncilEvidence[] = [];
    let sourceRunId: string | null = null;
    const now = new Date().toISOString();
    if (!fresh) try {
      const runs = await this.research.listRuns(userId, { ticker, status: 'completed', limit: 1 });
      const latest = runs.items[0];
      if (latest && Date.now() - Date.parse(latest.completedAt ?? latest.createdAt) < 48 * 3600_000) {
        const saved = await this.research.getEvidence(userId, latest.id);
        if (saved.length && !saved.some((item) => item.sourceName === 'Data Unavailable')) {
          sourceRunId = latest.id;
          evidence.push(...saved.map((item) => ({ ...item, relevanceScore: Number(item.relevanceScore ?? 0) })));
        }
      }
    } catch {
      // A missing saved report must not prevent direct provider collection.
      this.logger.warn('Council saved research unavailable; collecting fresh evidence');
    }
    let portfolio: Awaited<ReturnType<PortfolioContextService['getPortfolioContext']>> | null = null;
    try {
      portfolio = await this.portfolio.getPortfolioContext(userId);
    } catch {
      evidence.push({ id: randomUUID(), role: 'fundamental', evidenceType: 'other',
        title: language === 'en' ? 'Current portfolio data unavailable' : '当前组合数据不可用',
        content: language === 'en' ? 'Portfolio valuation or FX could not be verified. Stock research continues; portfolio sizing is withheld.'
          : '组合估值或汇率暂时无法核实。个股研究仍会继续，暂不计算组合仓位建议。',
        sourceName: 'Data Unavailable', sourceUrl: null, fetchedAt: now, relevanceScore: 0 });
    }
    if (!sourceRunId) {
      try {
        const collected = await this.evidence.collectEvidence(ticker, userId, portfolio, language);
        evidence.push(...collected.map((item) => ({ ...item, id: randomUUID(), sourceUrl: item.sourceUrl ?? null,
          sourceName: item.sourceName ?? null, fetchedAt: now })));
      } catch {
        evidence.push({ id: randomUUID(), role: 'fundamental', evidenceType: 'other',
          title: language === 'en' ? 'Stock research data unavailable' : '个股研究数据不可用',
          content: language === 'en' ? 'Stock data collection failed. Check the data provider and retry.' : '个股数据采集失败，请检查金融数据服务后重试。',
          sourceName: 'Data Unavailable', sourceUrl: null, fetchedAt: now, relevanceScore: 0 });
      }
    }
    if (portfolio) {
      evidence.push({ id: randomUUID(), role: 'fundamental', evidenceType: 'other',
        title: language === 'en' ? 'Current portfolio snapshot (USD)' : '当前组合快照（美元）',
        content: JSON.stringify({ totalValue: portfolio.totalValue, cash: portfolio.cash,
          holdings: portfolio.holdings.filter((holding) => holding.ticker.toUpperCase() === ticker) }),
        sourceName: 'Portfolio Data', sourceUrl: null, fetchedAt: now, relevanceScore: 1 });
    }
    if (isRuleCandidate(config, candidate)) {
      const rule = config.priceRules.find((item) => item.ticker.toUpperCase() === ticker);
      evidence.push({ id: randomUUID(), role: 'fundamental', evidenceType: 'other',
        title: language === 'en' ? 'Investor-authored price rule (not an AI forecast)' : '投资者自设价格规则（非 AI 预测）',
        content: JSON.stringify(rule), sourceName: 'Investor configuration', sourceUrl: null, fetchedAt: now, relevanceScore: 1 });
      evidence.push({ id: randomUUID(), role: 'technical', evidenceType: 'price',
        title: language === 'en' ? 'Paper scanner candidate quote' : '模拟交易扫描报价',
        content: JSON.stringify({ ticker, price: candidate.price, side: candidate.side, quantity: candidate.quantity }),
        sourceName: 'Paper scan quote', sourceUrl: null, fetchedAt: now, relevanceScore: 1 });
    }
    return { evidence: evidence.slice(0, 40), sourceRunId };
  }

  private async insertSession(userId: string, profile: BuilderProfile, ticker: string, language: 'zh-CN' | 'en',
    candidate: CouncilCandidate | null = null, snapshot: ResearchSnapshot = { evidence: [], sourceRunId: null }, key: string | null = null): Promise<SessionRow> {
    const [row] = await this.db.insert(councilSessions).values({ owner: userId, profileId: profile.id,
      profileVersion: profile.version, profileSnapshot: profile.config, ticker, language, candidate,
      evidenceSnapshot: snapshot.evidence, sourceRunId: snapshot.sourceRunId, cacheKey: key }).returning();
    return row;
  }

  private async getProfile(userId: string, id: string): Promise<BuilderProfile> {
    this.assertId(id);
    const [row] = await this.db.select().from(builderProfiles)
      .where(and(eq(builderProfiles.owner, userId), eq(builderProfiles.id, id)));
    if (!row) throw new NotFoundException('Agent profile not found');
    return { id: row.id, config: normalizeBuilderConfig(row.config as BuilderConfig),
      status: row.status as BuilderProfile['status'], version: row.version,
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
  }

  private members(config: BuilderConfig): CouncilMember[] {
    const members = config.council?.members ?? DEFAULT_MEMBERS;
    if (members.length !== 3 || new Set(members.map((member) => member.role)).size !== 3
      || !members.some((member) => member.role === 'researcher') || !members.some((member) => member.role === 'challenger')
      || !members.some((member) => member.role === 'manager')) throw new Error('Council requires three distinct roles');
    return members;
  }

  private async requireSession(userId: string, id: string): Promise<SessionRow> {
    this.assertId(id);
    const [row] = await this.db.select().from(councilSessions)
      .where(and(eq(councilSessions.owner, userId), eq(councilSessions.id, id)));
    if (!row) throw new NotFoundException('Council session not found');
    return row;
  }

  private async hydrate(userId: string, row: SessionRow): Promise<CouncilSession> {
    const [messages, reports] = await Promise.all([
      this.db.select().from(councilMessages)
        .where(and(eq(councilMessages.owner, userId), eq(councilMessages.sessionId, row.id))).orderBy(councilMessages.createdAt),
      this.db.select().from(councilReports)
        .where(and(eq(councilReports.owner, userId), eq(councilReports.sessionId, row.id))).orderBy(councilReports.version),
    ]);
    return { id: row.id, profileId: row.profileId, profileVersion: row.profileVersion,
      ticker: row.ticker, language: row.language, status: row.status, revision: row.revision,
      messages: messages.map(({ id, role, memberName, content, revision, tokensUsed, createdAt }) => ({
        id, role, memberName, content, revision, tokensUsed, createdAt: createdAt.toISOString(),
      })), reports: reports.map((report) => this.mapReport(report)), error: row.error,
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
  }

  private mapReport(row: ReportRow): CouncilReport {
    return { id: row.id, version: row.version, revision: row.revision, decision: row.decision, summary: row.summary,
      dissent: row.dissent, nextReviewCondition: row.nextReviewCondition, evidence: row.evidence,
      sourceRunId: row.sourceRunId, candidate: row.candidate, paperOrderId: row.paperOrderId,
      tokensUsed: row.tokensUsed, engine: row.engine, createdAt: row.createdAt.toISOString() };
  }

  private assertId(value: unknown): asserts value is string {
    if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) {
      throw new BadRequestException('Invalid identifier');
    }
  }

  private validateTicker(value: unknown): string {
    try { return normalizeTicker(value); } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Invalid ticker');
    }
  }
}
