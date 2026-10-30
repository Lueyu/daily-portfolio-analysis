/**
 * EvidenceService — collects the evidence that feeds the multi-agent debate.
 *
 * Evidence is split into fundamental, news, and technical streams. Unavailable
 * inputs are stored as explicit data gaps, never as positive/negative facts.
 */
import { Injectable, Inject, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '../../common/platform';
import { eq } from 'drizzle-orm';
import { holdings, watchlist } from '@server/database/schema';
import { QuoteService } from '@server/modules/quote/quote.service';
import type { EvidenceType, PortfolioContext, QuoteResponse } from '@shared/api.interface';
import { FinnhubEvidenceService } from './finnhub-evidence.service';

/** High-level category of evidence; used to label evidence rows in the UI. */
export type EvidenceRole = 'fundamental' | 'news' | 'technical';

/** A single evidence item ready to be fed into an LLM prompt or persisted. */
export interface EvidenceInput {
  role: EvidenceRole;
  evidenceType: EvidenceType;
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
    private readonly finnhubEvidence: FinnhubEvidenceService,
  ) {}

  /**
   * Collect all evidence for a ticker. Runs the three collectors in parallel;
   * partial failures are recorded as data gaps rather than research facts.
   * @param ticker the stock ticker to analyze.
   * @param userId owner, used to fetch the caller's holdings/watchlist.
   * @param portfolioContext USD-normalized portfolio snapshot for weights.
   */
  async collectEvidence(
    ticker: string,
    userId: string,
    portfolioContext: PortfolioContext,
  ): Promise<EvidenceInput[]> {
    const [fundamental, news, technical] = await Promise.allSettled([
      this.collectFundamental(ticker, userId, portfolioContext),
      this.collectNews(ticker, userId),
      this.collectTechnical(ticker),
    ]);

    const allEvidence: EvidenceInput[] = [];

    if (fundamental.status === 'fulfilled') {
      allEvidence.push(...fundamental.value);
    } else {
      this.logger.warn(`Fundamental analysis failed for ${ticker}: ${fundamental.reason}`);
      allEvidence.push(this.dataGap(
        'fundamental', '基本面数据获取失败',
        '持仓、关注列表或行情获取失败，当前基本面数据不完整。',
      ));
    }

    if (news.status === 'fulfilled') {
      allEvidence.push(...news.value);
    } else {
      this.logger.warn(`News analysis failed for ${ticker}: ${news.reason}`);
      allEvidence.push(this.dataGap(
        'news', '新闻数据获取失败', '新闻数据获取失败，无法判断最新事件与情绪。',
      ));
    }

    if (technical.status === 'fulfilled') {
      allEvidence.push(...technical.value);
    } else {
      this.logger.warn(`Technical analysis failed for ${ticker}: ${technical.reason}`);
      allEvidence.push(this.dataGap(
        'technical', '技术面数据获取失败',
        '行情或历史K线获取失败，无法完成技术面分析。',
      ));
    }

    return allEvidence;
  }

  private dataGap(
    role: EvidenceRole,
    title: string,
    content: string,
  ): EvidenceInput {
    return {
      role,
      evidenceType: 'other',
      title,
      content,
      sourceName: 'Data Unavailable',
      relevanceScore: 0,
    };
  }

  /**
   * Fundamental evidence: quote, portfolio, and any configured provider
   * metrics. Statements remain a gap until a verified statement source exists.
   */
  private async collectFundamental(
    ticker: string,
    userId: string,
    portfolioContext: PortfolioContext,
  ): Promise<EvidenceInput[]> {
    const evidence: EvidenceInput[] = [];
    let quote: QuoteResponse | null = null;
    try {
      quote = await this.quoteService.getQuote(ticker);
    } catch (error) {
      this.logger.warn(`Quote lookup failed for ${ticker}: ${String(error)}`);
    }

    if (quote && Number.isFinite(Number(quote.price)) && Number(quote.price) > 0) {
      evidence.push(this.buildQuoteEvidence(quote));
    } else {
      quote = null;
      evidence.push(this.dataGap(
        'fundamental', `${ticker} 行情缺失`,
        '当前行情报价获取失败，无法据此计算最新市值和浮盈亏。',
      ));
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
      const buyPrice = Number(h.buyPrice ?? 0);
      const currency = h.currency || quote?.currency || 'USD';
      const portfolioHolding = portfolioContext.holdings?.find(
        (item) => item.ticker.toUpperCase() === h.ticker.toUpperCase(),
      );
      let content = `持仓数量: ${shares}股, 成本价: ${currency} ${buyPrice.toFixed(2)}, 行业: ${h.sector ?? '未知'}`;
      if (quote && quote.currency === currency) {
        const currentPrice = Number(quote.price);
        const marketValue = shares * currentPrice;
        const cost = shares * buyPrice;
        const pnl = marketValue - cost;
        const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
        content += [
          `, 报价: ${currency} ${currentPrice.toFixed(2)}`,
          `市值: ${currency} ${marketValue.toFixed(2)}`,
          `浮盈亏: ${currency} ${pnl.toFixed(2)} (${pnlPct.toFixed(2)}%)`,
        ].join(', ');
      } else if (quote) {
        content += ', 报价币种与持仓币种不一致，无法计算浮盈亏';
      }
      if (portfolioHolding) {
        content += `, 组合记录市值: USD ${portfolioHolding.marketValue.toFixed(2)}`;
        content += `, 组合权重: ${portfolioHolding.weightPct.toFixed(2)}%`;
      }

      evidence.push({
        role: 'fundamental',
        evidenceType: 'other',
        title: `持仓信息 - ${h.ticker}`,
        content,
        sourceName: 'Portfolio Data',
        relevanceScore: 0.95,
      });
    } else if (watchRows.length > 0) {
      const w = watchRows[0];
      evidence.push({
        role: 'fundamental',
        evidenceType: 'other',
        title: `关注股信息 - ${w.ticker}`,
        content: `关注股: ${w.ticker}, 公司: ${w.company ?? '未知'}, 行业: ${w.sector ?? '未知'}`,
        sourceName: 'Watchlist Data',
        relevanceScore: 0.8,
      });
    } else {
      evidence.push({
        role: 'fundamental',
        evidenceType: 'other',
        title: `${ticker} - 无持仓`,
        content: `该标的不在当前持仓或关注列表中。`,
        sourceName: 'Portfolio Data',
        relevanceScore: 0.5,
      });
    }

    let hasValuation = false;
    try {
      const metrics = await this.finnhubEvidence.getMetrics(userId, ticker);
      if (metrics) {
        evidence.push(...metrics.items);
        hasValuation = metrics.hasValuation;
      }
    } catch (error) {
      this.logger.warn(`Finnhub metrics unavailable for ${ticker}: ${String(error)}`);
    }

    evidence.push(this.dataGap(
      'fundamental', `${ticker} 财报数据缺失`,
      '当前缺少经核实的营收、利润、现金流、负债等财报数据。',
    ));
    if (!hasValuation) {
      evidence.push(this.dataGap(
        'fundamental', `${ticker} 估值数据缺失`,
        '当前缺少 PE、PB、PS 等估值数据及可比公司或历史估值参考。',
      ));
    }

    return evidence;
  }

  /** Build a single evidence row from a provider quote. */
  private buildQuoteEvidence(quote: QuoteResponse): EvidenceInput {
    const changePct = Number(quote.changePercent);
    const direction = changePct > 0 ? '上涨' : changePct < 0 ? '下跌' : '持平';

    return {
      role: 'fundamental',
      evidenceType: 'price',
      title: `${quote.symbol} 行情报价${quote.delayed ? '（延时）' : ''}`,
      content: [
        `报价: ${quote.currency} ${quote.price}`,
        `涨跌幅: ${quote.changePercent}% (${direction})`,
        `涨跌额: ${quote.currency} ${quote.change}`,
        `开盘价: ${quote.currency} ${quote.open ?? 'N/A'}`,
        `最高价: ${quote.currency} ${quote.high ?? 'N/A'}`,
        `最低价: ${quote.currency} ${quote.low ?? 'N/A'}`,
        `成交量: ${quote.volume ?? 'N/A'}`,
        `市场: ${quote.market}`,
        `币种: ${quote.currency}${quote.delayed ? '。供应商报价可能延时' : ''}`,
      ].join(', '),
      sourceName: 'Market Quote Provider',
      relevanceScore: 0.9,
    };
  }

  /** Use verified company headlines when available; never invent sentiment. */
  private async collectNews(ticker: string, userId: string): Promise<EvidenceInput[]> {
    try {
      const news = await this.finnhubEvidence.getNews(userId, ticker);
      if (news?.length) return news;
    } catch (error) {
      this.logger.warn(`Finnhub news unavailable for ${ticker}: ${String(error)}`);
    }
    return [
      this.dataGap(
        'news', `${ticker} 新闻与情绪缺失`,
        '当前没有经核实的近期公司新闻或市场情绪数据；数据源可能未配置、无覆盖或暂时不可用。',
      ),
    ];
  }

  /**
   * Current-session price action is available from the quote. Historical
   * indicators and support/resistance are unavailable without K-line data.
   */
  private async collectTechnical(ticker: string): Promise<EvidenceInput[]> {
    let quote: QuoteResponse | null = null;
    try {
      quote = await this.quoteService.getQuote(ticker);
    } catch (error) {
      this.logger.warn(`Technical quote lookup failed for ${ticker}: ${String(error)}`);
    }

    if (!quote || !Number.isFinite(Number(quote.price)) || Number(quote.price) <= 0) {
      return [this.dataGap(
        'technical', `${ticker} 技术面数据缺失`,
        '当前行情和历史K线均不可用，无法计算技术指标。',
      )];
    }

    return [
      {
        role: 'technical',
        evidenceType: 'price',
        title: `${ticker} 当日价格行为`,
        content: [
          `报价: ${quote.currency} ${quote.price}`,
          `当日最高: ${quote.currency} ${quote.high ?? 'N/A'}`,
          `当日最低: ${quote.currency} ${quote.low ?? 'N/A'}`,
          `当日涨跌幅: ${quote.changePercent}%`,
          `成交量: ${quote.volume ?? 'N/A'}${quote.delayed ? '。供应商报价可能延时' : ''}`,
        ].join(', '),
        sourceName: 'Quote Provider',
        relevanceScore: 0.6,
      },
      this.dataGap(
        'technical', `${ticker} 历史技术数据缺失`,
        '缺少历史K线及历史成交量，无法计算均线、RSI、MACD、量比和可靠的支撑阻力位。',
      ),
    ];
  }
}
