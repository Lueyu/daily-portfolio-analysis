/**
 * EvidenceService — collects the evidence that feeds the multi-agent debate.
 *
 * Evidence is split into three parallel streams (fundamental, news, technical)
 * collected via Promise.allSettled so that one failing source does not abort
 * the others. When a stream rejects, a placeholder evidence row is inserted
 * (with low relevanceScore) so the LLM debate still has context about what
 * data is missing.
 *
 * Current state:
 *  - Fundamental: live quote + portfolio position / watchlist row + a
 *    placeholder note about missing valuation metrics.
 *  - News: two placeholder rows (news source not yet integrated).
 *  - Technical: intraday price action + estimated support/resistance + volume
 *    placeholder (historical K-line data not yet integrated).
 *
 * Relevance score (0–1) is attached to each row; the pipeline does not use it
 * for filtering today, but it is stored for future prompt-side ranking.
 */
import { Injectable, Inject, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { eq } from 'drizzle-orm';
import { holdings, watchlist } from '@server/database/schema';
import { QuoteService } from '@server/modules/quote/quote.service';
import type { QuoteResponse } from '@shared/api.interface';

/** High-level category of evidence; used to label evidence rows in the UI. */
export type EvidenceRole = 'fundamental' | 'news' | 'technical';

/** A single evidence item ready to be fed into an LLM prompt or persisted. */
export interface EvidenceInput {
  role: EvidenceRole;
  evidenceType: string;
  title: string;
  content: string;
  sourceUrl?: string;
  sourceName?: string;
  relevanceScore: number;
}

@Injectable()
export class EvidenceService {
  private readonly logger = new Logger(EvidenceService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly quoteService: QuoteService,
  ) {}

  /**
   * Collect all evidence for a ticker. Runs the three collectors in parallel;
   * partial failures are downgraded to placeholder rows rather than thrown.
   * @param ticker the stock ticker to analyze.
   * @param userId owner, used to fetch the caller's holdings/watchlist.
   * @param portfolioContext caller's total portfolio value (for weight calc).
   */
  async collectEvidence(
    ticker: string,
    userId: string,
    portfolioContext: { totalValue: number },
  ): Promise<EvidenceInput[]> {
    const [fundamental, news, technical] = await Promise.allSettled([
      this.collectFundamental(ticker, userId, portfolioContext.totalValue),
      this.collectNews(ticker),
      this.collectTechnical(ticker),
    ]);

    const allEvidence: EvidenceInput[] = [];

    if (fundamental.status === 'fulfilled') {
      allEvidence.push(...fundamental.value);
    } else {
      this.logger.warn(`Fundamental analysis failed for ${ticker}: ${fundamental.reason}`);
      allEvidence.push({
        role: 'fundamental',
        evidenceType: 'error',
        title: '基本面数据获取失败',
        content: String(fundamental.reason),
        relevanceScore: 0.1,
      });
    }

    if (news.status === 'fulfilled') {
      allEvidence.push(...news.value);
    } else {
      this.logger.warn(`News analysis failed for ${ticker}: ${news.reason}`);
      allEvidence.push({
        role: 'news',
        evidenceType: 'error',
        title: '新闻数据获取失败',
        content: String(news.reason),
        relevanceScore: 0.1,
      });
    }

    if (technical.status === 'fulfilled') {
      allEvidence.push(...technical.value);
    } else {
      this.logger.warn(`Technical analysis failed for ${ticker}: ${technical.reason}`);
      allEvidence.push({
        role: 'technical',
        evidenceType: 'error',
        title: '技术面数据获取失败',
        content: String(technical.reason),
        relevanceScore: 0.1,
      });
    }

    return allEvidence;
  }

  /**
   * Fundamental evidence: live quote, position/watchlist context, and a
   * placeholder noting that valuation multiples (PE/PB/PS) are not yet wired in.
   */
  private async collectFundamental(
    ticker: string,
    userId: string,
    totalValue: number,
  ): Promise<EvidenceInput[]> {
    const evidence: EvidenceInput[] = [];
    const quote = await this.quoteService.getQuote(ticker);

    if (quote) {
      evidence.push(this.buildQuoteEvidence(quote));
    }

    const [holdingRows, watchRows] = await Promise.all([
      this.db
        .select()
        .from(holdings)
        .where(eq(holdings.owner, userId))
        .then((rows) => rows.filter((r) => r.ticker.toUpperCase() === ticker.toUpperCase())),
      this.db
        .select()
        .from(watchlist)
        .where(eq(watchlist.owner, userId))
        .then((rows) => rows.filter((r) => r.ticker.toUpperCase() === ticker.toUpperCase())),
    ]);

    if (holdingRows.length > 0) {
      const h = holdingRows[0];
      const shares = Number(h.shares ?? 0);
      const currentPrice = quote ? Number(quote.price) : Number(h.currentPrice ?? 0);
      const buyPrice = Number(h.buyPrice ?? 0);
      const marketValue = shares * currentPrice;
      const cost = shares * buyPrice;
      const pnl = marketValue - cost;
      const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
      const weightPct = totalValue > 0 ? (marketValue / totalValue) * 100 : 0;

      evidence.push({
        role: 'fundamental',
        evidenceType: 'position',
        title: `持仓信息 - ${h.ticker}`,
        content: `持仓数量: ${shares}股, 成本价: $${buyPrice.toFixed(2)}, 当前价: $${currentPrice.toFixed(2)}, 市值: $${marketValue.toFixed(2)}, 浮盈亏: $${pnl.toFixed(2)} (${pnlPct.toFixed(2)}%), 组合权重: ${weightPct.toFixed(2)}%, 行业: ${h.sector ?? '未知'}, 评级: ${h.rating ?? '未评级'}, 操作建议: ${h.action ?? '无'}`,
        sourceName: 'Portfolio Data',
        relevanceScore: 0.95,
      });
    } else if (watchRows.length > 0) {
      const w = watchRows[0];
      evidence.push({
        role: 'fundamental',
        evidenceType: 'watchlist',
        title: `关注股信息 - ${w.ticker}`,
        content: `关注股: ${w.ticker}, 公司: ${w.company ?? '未知'}, 行业: ${w.sector ?? '未知'}, 入场价: $${w.entryPrice ?? '未知'}, 目标买入价: $${w.targetBuy ?? '未设定'}, 当前评级: ${w.rating ?? '未评级'}, 信号: ${w.signal ?? '无信号'}`,
        sourceName: 'Watchlist Data',
        relevanceScore: 0.8,
      });
    } else {
      evidence.push({
        role: 'fundamental',
        evidenceType: 'position',
        title: `${ticker} - 无持仓`,
        content: `该标的不在当前持仓或关注列表中。`,
        sourceName: 'Portfolio Data',
        relevanceScore: 0.5,
      });
    }

    evidence.push({
      role: 'fundamental',
      evidenceType: 'valuation',
      title: '估值数据（占位）',
      content: '当前缺少 PE、PB、PS 等估值数据，需要人工补充或接入第三方数据源。建议关注：市盈率、市净率、市销率、EV/EBITDA、股息率等关键估值指标，并与行业中位数和历史分位比较。',
      sourceName: 'Manual Required',
      relevanceScore: 0.4,
    });

    return evidence;
  }

  /** Build a single evidence row from a live quote response. */
  private buildQuoteEvidence(quote: QuoteResponse): EvidenceInput {
    const changePct = Number(quote.changePercent);
    const direction = changePct > 0 ? '上涨' : changePct < 0 ? '下跌' : '持平';

    return {
      role: 'fundamental',
      evidenceType: 'price',
      title: `${quote.symbol} 实时行情`,
      content: `当前价格: $${quote.price}, 涨跌幅: ${quote.changePercent}% (${direction}), 涨跌额: $${quote.change}, 开盘价: ${quote.open ?? 'N/A'}, 最高价: ${quote.high ?? 'N/A'}, 最低价: ${quote.low ?? 'N/A'}, 成交量: ${quote.volume ?? 'N/A'}, 市场: ${quote.market}, 币种: ${quote.currency}`,
      sourceName: quote.market === 'US' ? 'Tencent Finance' : quote.market === 'HK' ? 'Tencent Finance HK' : 'Tencent Finance CN',
      relevanceScore: 0.9,
    };
  }

  /**
   * News evidence: currently two placeholder rows. A real news/sentiment feed
   * has not been integrated; the placeholders nudge the LLM to treat news as
   * neutral and to flag the gap.
   */
  private async collectNews(ticker: string): Promise<EvidenceInput[]> {
    return [
      {
        role: 'news',
        evidenceType: 'news_placeholder',
        title: `${ticker} 新闻与情绪（待补充）`,
        content: '新闻数据源暂未接入，需人工补充最新新闻。请关注以下方向：1) 公司公告与财报 2) 行业政策变化 3) 宏观经济数据 4) 分析师评级变动 5) 竞争对手动态。当前情绪判断：中性（缺少数据支撑）。',
        sourceName: 'Manual Required',
        relevanceScore: 0.3,
      },
      {
        role: 'news',
        evidenceType: 'sentiment',
        title: `${ticker} 市场情绪（占位）`,
        content: '由于缺少实时新闻和社交媒体数据，当前无法精确量化市场情绪。建议结合：新闻报道正负向比例、分析师预期变化、期权隐含波动率、成交量变化等综合判断。',
        sourceName: 'Manual Required',
        relevanceScore: 0.3,
      },
    ];
  }

  /**
   * Technical evidence: derived purely from the current quote (intraday range,
   * trend, estimated support/resistance, volume). Historical indicators
   * (MA/MACD/RSI/Bollinger) are not yet computed.
   */
  private async collectTechnical(ticker: string): Promise<EvidenceInput[]> {
    const quote = await this.quoteService.getQuote(ticker);

    if (!quote) {
      return [
        {
          role: 'technical',
          evidenceType: 'technical_placeholder',
          title: `${ticker} 技术面数据不足`,
          content: '无法获取当前价格及历史数据，技术分析暂不可用。需要接入历史K线数据后计算：均线系统、MACD、RSI、布林带、支撑阻力位等技术指标。',
          sourceName: 'Data Unavailable',
          relevanceScore: 0.2,
        },
      ];
    }

    const price = Number(quote.price);
    const high = quote.high ? Number(quote.high) : price;
    const low = quote.low ? Number(quote.low) : price;
    const changePct = Number(quote.changePercent);

    const intradayRangePct = high > 0 ? ((high - low) / high) * 100 : 0;
    const trend = changePct > 1 ? '短期偏强' : changePct < -1 ? '短期偏弱' : '震荡整理';

    return [
      {
        role: 'technical',
        evidenceType: 'price_action',
        title: `${ticker} 当日价格行为`,
        content: `当前价: $${quote.price}, 当日最高: $${quote.high ?? 'N/A'}, 当日最低: $${quote.low ?? 'N/A'}, 当日振幅: ${intradayRangePct.toFixed(2)}%, 当日涨跌幅: ${quote.changePercent}%, 短期趋势判断: ${trend}`,
        sourceName: 'Intraday Data',
        relevanceScore: 0.6,
      },
      {
        role: 'technical',
        evidenceType: 'levels',
        title: `${ticker} 关键价位（估算）`,
        content: `日内支撑位（估算）: $${low.toFixed(2)}, 日内阻力位（估算）: $${high.toFixed(2)}。注：精确的支撑阻力位需要历史K线数据计算（如前高前低、均线、斐波那契回撤等）。缺少5日/20日/50日/200日均线、成交量分析、RSI/MACD等指标。`,
        sourceName: 'Estimated from Daily Range',
        relevanceScore: 0.5,
      },
      {
        role: 'technical',
        evidenceType: 'volume',
        title: `${ticker} 成交量分析（占位）`,
        content: `当日成交量: ${quote.volume ?? '未知'}。缺少历史均量对比，无法判断放量/缩量状态。建议补充：5日均量、20日均量、量比、OBV能量潮等指标。`,
        sourceName: quote.volume ? 'Intraday Data' : 'Data Unavailable',
        relevanceScore: quote.volume ? 0.5 : 0.2,
      },
    ];
  }
}
