import { Injectable, Inject, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { eq, and } from 'drizzle-orm';
import { holdings, cashAccounts, agentRuns, agentRatings } from '@server/database/schema';
import type { PortfolioContext, StrategyRule } from '@shared/api.interface';

const LEVERAGE_ETF_TICKERS = new Set([
  'TQQQ', 'SQQQ', 'SOXL', 'SOXS', 'NUGT', 'DUST', 'JDST', 'JPNL',
  'UDOW', 'SDOW', 'UMDD', 'SMDD', 'UBOT', 'LABU', 'LABD', 'TMF',
  'TMV', 'UPRO', 'SPXU', 'QID', 'QLD', 'SDS', 'SSO',
]);

const XIAOMI_GROUP = 'Xiaomi';

function getCompanyGroup(ticker: string): string {
  const upper = ticker.toUpperCase().replace(/\.HK$/, '').replace(/^0+/, '');
  if (upper === '1810' || upper === 'XIACF' || upper === 'XIACY') {
    return XIAOMI_GROUP;
  }
  return ticker.toUpperCase();
}

@Injectable()
export class PortfolioContextService {
  private readonly logger = new Logger(PortfolioContextService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  async getPortfolioContext(userId: string): Promise<PortfolioContext> {
    const [holdingRows, cashRows] = await Promise.all([
      this.db.select().from(holdings).where(eq(holdings.owner, userId)),
      this.db.select().from(cashAccounts).where(eq(cashAccounts.owner, userId)),
    ]);

    let totalMv = 0;
    let cash = 0;

    for (const row of cashRows) {
      cash += Number(row.balance ?? 0);
    }

    const holdingDetails = holdingRows.map((h) => {
      const shares = Number(h.shares ?? 0);
      const currentPrice = Number(h.currentPrice ?? 0);
      const buyPrice = h.buyPrice ? Number(h.buyPrice) : null;
      const marketValue = shares * currentPrice;
      totalMv += marketValue;
      const pnlPct = buyPrice && buyPrice > 0 ? ((currentPrice - buyPrice) / buyPrice) * 100 : null;

      return {
        ticker: h.ticker,
        company: h.company,
        sector: h.sector,
        market: h.market ?? 'US',
        currency: h.currency ?? 'USD',
        shares,
        currentPrice,
        costPrice: buyPrice,
        marketValue,
        weightPct: 0,
        pnlPct,
        companyGroup: getCompanyGroup(h.ticker),
      };
    });

    const totalValue = totalMv + cash;

    for (const h of holdingDetails) {
      h.weightPct = totalValue > 0 ? (h.marketValue / totalValue) * 100 : 0;
    }

    const companyExposures: Record<string, number> = {};
    for (const h of holdingDetails) {
      companyExposures[h.companyGroup] = (companyExposures[h.companyGroup] ?? 0) + h.weightPct;
    }

    return {
      totalValue,
      totalMv,
      cash,
      cashRatio: totalValue > 0 ? (cash / totalValue) * 100 : 0,
      holdings: holdingDetails,
      companyExposures,
    };
  }

  checkRiskRules(
    ticker: string,
    portfolio: PortfolioContext,
    rules: StrategyRule[],
  ): Array<{
    ruleKey: string;
    ruleName: string;
    ruleType: 'hard' | 'soft';
    passed: boolean;
    currentValue: number | null;
    thresholdValue: number | null;
    detail: string;
    suggestedAction: string;
  }> {
    const results: Array<{
      ruleKey: string;
      ruleName: string;
      ruleType: 'hard' | 'soft';
      passed: boolean;
      currentValue: number | null;
      thresholdValue: number | null;
      detail: string;
      suggestedAction: string;
    }> = [];

    const ruleMap = new Map(rules.map((r) => [r.ruleKey, r]));
    const companyGroup = getCompanyGroup(ticker);
    const holding = portfolio.holdings.find((h) => h.ticker.toUpperCase() === ticker.toUpperCase());

    for (const rule of rules) {
      if (!rule.enabled) continue;
      const threshold = rule.threshold ? Number(rule.threshold) : null;

      switch (rule.ruleKey) {
        case 'single_company_exposure': {
          const exposure = portfolio.companyExposures[companyGroup] ?? 0;
          const passed = threshold === null ? true : exposure <= threshold;
          results.push({
            ruleKey: rule.ruleKey,
            ruleName: rule.ruleName,
            ruleType: rule.ruleType,
            passed,
            currentValue: Number(exposure.toFixed(2)),
            thresholdValue: threshold,
            detail: `${companyGroup} 合并敞口 ${exposure.toFixed(2)}%，阈值 ${threshold}%`,
            suggestedAction: passed ? '敞口在允许范围内' : `需减持 ${companyGroup} 相关标的至 ${threshold}% 以下`,
          });
          break;
        }

        case 'single_stock_limit': {
          const weight = holding?.weightPct ?? 0;
          const passed = threshold === null ? true : weight <= threshold;
          results.push({
            ruleKey: rule.ruleKey,
            ruleName: rule.ruleName,
            ruleType: rule.ruleType,
            passed,
            currentValue: Number(weight.toFixed(2)),
            thresholdValue: threshold,
            detail: `${ticker} 权重 ${weight.toFixed(2)}%，阈值 ${threshold}%`,
            suggestedAction: passed ? '单股权重在建议范围内' : `建议减持 ${ticker} 至 ${threshold}% 以下`,
          });
          break;
        }

        case 'small_cap_weight': {
          const price = holding?.currentPrice ?? 0;
          const weight = holding?.weightPct ?? 0;
          const isSmallCap = price > 0 && price < 5;
          if (isSmallCap && holding) {
            const passed = threshold === null ? true : weight <= threshold;
            results.push({
              ruleKey: rule.ruleKey,
              ruleName: rule.ruleName,
              ruleType: rule.ruleType,
              passed,
              currentValue: Number(weight.toFixed(2)),
              thresholdValue: threshold,
              detail: `${ticker} 为低价股($${price})，权重 ${weight.toFixed(2)}%，阈值 ${threshold}%`,
              suggestedAction: passed ? '小盘股权重在允许范围内' : `需减持小盘股 ${ticker} 至 ${threshold}% 以下`,
            });
          } else if (holding) {
            results.push({
              ruleKey: rule.ruleKey,
              ruleName: rule.ruleName,
              ruleType: rule.ruleType,
              passed: true,
              currentValue: Number(weight.toFixed(2)),
              thresholdValue: threshold,
              detail: `${ticker} 价格 $${price}，不属于小盘股范围`,
              suggestedAction: '不适用小盘股规则',
            });
          } else {
            results.push({
              ruleKey: rule.ruleKey,
              ruleName: rule.ruleName,
              ruleType: rule.ruleType,
              passed: true,
              currentValue: 0,
              thresholdValue: threshold,
              detail: `${ticker} 不在持仓中，无小盘股敞口`,
              suggestedAction: '不适用',
            });
          }
          break;
        }

        case 'leverage_etf': {
          const isLeverageEtf = LEVERAGE_ETF_TICKERS.has(ticker.toUpperCase());
          const weight = holding?.weightPct ?? 0;
          if (isLeverageEtf && holding) {
            const passed = threshold === null ? true : weight <= threshold;
            results.push({
              ruleKey: rule.ruleKey,
              ruleName: rule.ruleName,
              ruleType: rule.ruleType,
              passed,
              currentValue: Number(weight.toFixed(2)),
              thresholdValue: threshold,
              detail: `${ticker} 为杠杆ETF，权重 ${weight.toFixed(2)}%，阈值 ${threshold}%`,
              suggestedAction: passed ? '杠杆ETF敞口在允许范围内' : `需减持杠杆ETF ${ticker} 至 ${threshold}% 以下`,
            });
          } else {
            results.push({
              ruleKey: rule.ruleKey,
              ruleName: rule.ruleName,
              ruleType: rule.ruleType,
              passed: true,
              currentValue: isLeverageEtf ? 0 : null,
              thresholdValue: threshold,
              detail: isLeverageEtf ? `${ticker} 为杠杆ETF但未持仓` : `${ticker} 不是杠杆ETF`,
              suggestedAction: '不适用',
            });
          }
          break;
        }

        case 'cash_ratio': {
          const passed = threshold === null ? true : (portfolio.cashRatio >= 5 && portfolio.cashRatio <= 10);
          results.push({
            ruleKey: rule.ruleKey,
            ruleName: rule.ruleName,
            ruleType: rule.ruleType,
            passed,
            currentValue: Number(portfolio.cashRatio.toFixed(2)),
            thresholdValue: threshold,
            detail: `现金比例 ${portfolio.cashRatio.toFixed(2)}%，建议范围 5-10%（参考值 ${threshold}%）`,
            suggestedAction: passed ? '现金比例合理' : portfolio.cashRatio < 5 ? '现金过低，建议增加现金储备' : '现金过高，考虑增加投资',
          });
          break;
        }

        case 'drawdown_check': {
          const pnlPct = holding?.pnlPct;
          if (holding && pnlPct !== null && pnlPct < 0) {
            const drawdown = Math.abs(pnlPct);
            const passed = threshold === null ? true : drawdown < threshold;
            results.push({
              ruleKey: rule.ruleKey,
              ruleName: rule.ruleName,
              ruleType: rule.ruleType,
              passed,
              currentValue: Number(drawdown.toFixed(2)),
              thresholdValue: threshold,
              detail: `${ticker} 浮亏 ${drawdown.toFixed(2)}%，阈值 ${threshold}%`,
              suggestedAction: passed ? '回撤在允许范围内' : '回撤过大，需强制重检持仓逻辑',
            });
          } else if (holding) {
            results.push({
              ruleKey: rule.ruleKey,
              ruleName: rule.ruleName,
              ruleType: rule.ruleType,
              passed: true,
              currentValue: pnlPct !== null ? Number(pnlPct.toFixed(2)) : null,
              thresholdValue: threshold,
              detail: `${ticker} 当前盈利或持平，无回撤风险`,
              suggestedAction: '不适用',
            });
          } else {
            results.push({
              ruleKey: rule.ruleKey,
              ruleName: rule.ruleName,
              ruleType: rule.ruleType,
              passed: true,
              currentValue: null,
              thresholdValue: threshold,
              detail: `${ticker} 不在持仓中`,
              suggestedAction: '不适用',
            });
          }
          break;
        }

        default:
          break;
      }
    }

    return results;
  }

  async applyRatingToHoldings(userId: string, runId: string): Promise<boolean> {
    const [runRow, ratingRow] = await Promise.all([
      this.db
        .select()
        .from(agentRuns)
        .where(and(eq(agentRuns.id, runId), eq(agentRuns.owner, userId))),
      this.db
        .select()
        .from(agentRatings)
        .where(and(eq(agentRatings.runId, runId), eq(agentRatings.owner, userId))),
    ]);

    if (runRow.length === 0 || ratingRow.length === 0) return false;

    const rating = ratingRow[0];
    const ticker = runRow[0].ticker;

    const updated = await this.db
      .update(holdings)
      .set({
        rating: rating.rating,
        action: rating.action,
        targetPrice: rating.targetPrice !== null ? String(rating.targetPrice) : null,
      })
      .where(and(eq(holdings.ticker, ticker), eq(holdings.owner, userId)))
      .returning({ id: holdings.id });

    return updated.length > 0;
  }
}
