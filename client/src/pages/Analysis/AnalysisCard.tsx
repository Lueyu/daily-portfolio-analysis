import { useState } from 'react';
import {
  Target,
  TrendingUp,
  AlertTriangle,
  Sparkles,
  ChevronRight,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { Analysis as AnalysisType } from '@shared/api.interface';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  formatPriceWithCurrency,
  ratingColor,
  actionColor,
  cn,
} from '@/utils/format';
import { inferMarket } from '@/hooks/use-market-quotes';

export function parseNumberedList(
  text: string | null
): string[] | null {
  if (!text || !text.trim()) return null;
  const parts = text
    .split(/[；;]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => s.replace(/^\d+[)\.、\s]+/, '').trim())
    .filter((s) => s.length > 0);
  return parts.length > 0 ? parts : null;
}

const PORTFOLIO_TICKER = 'PORTFOLIO';

function ratingTextColor(rating: string | null | undefined): string {
  if (!rating) return 'text-muted-foreground';
  switch (rating) {
    case 'Strong Buy':
    case 'Buy':
      return 'text-success';
    case 'Hold':
      return 'text-warning';
    case 'Sell':
    case 'Strong Sell':
      return 'text-destructive';
    default:
      return 'text-muted-foreground';
  }
}

function actionShortLabel(action: string | null | undefined): string {
  if (!action) return '—';
  const text = String(action);
  const stripped = text.replace(/(不|勿|别|无需|无须|不再|停止|暂停|暂缓|暂不)\s*(加仓|买入|增仓|增持|增加仓位|增加|追|加|买)/g, '');
  if (/清仓|清空|全部卖|全部出|离场|止损出局/.test(stripped)) return '卖出';
  if (/减仓|减持|降低仓位|减至|再减|卖出|卖掉|售出|减/.test(stripped)) return '减仓';
  if (/买入|买进|建仓|低吸|吸筹|分批加|分批买|加仓|增持|增仓|可以加|可加|首批/.test(stripped)) return '买入';
  if (/观望|等待|等回|不追|再看|观察|暂不/.test(text)) return '观望';
  if (/持有|维持|继续持有|定投|拿好/.test(text)) return '持有';
  return text.length > 5 ? text.slice(0, 5) + '…' : text;
}

function actionTextColor(action: string | null | undefined): string {
  if (!action) return 'text-muted-foreground';
  const label = actionShortLabel(action);
  switch (label) {
    case '加仓':
    case '买入':
      return 'text-success';
    case '持有':
      return 'text-warning';
    case '减仓':
    case '卖出':
      return 'text-destructive';
    case '观望':
      return 'text-foreground';
    default:
      return 'text-muted-foreground';
  }
}

interface AnalysisCardProps {
  analysis: AnalysisType;
  companyName?: string | null;
  deepReportRunId?: string | null;
}

function AnalysisCard({ analysis, companyName, deepReportRunId }: AnalysisCardProps) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const catalysts = parseNumberedList(analysis.catalysts);
  const risks = parseNumberedList(analysis.risks);
  const isPortfolio = analysis.ticker === PORTFOLIO_TICKER;
  const hasDeepReport = Boolean(deepReportRunId);
  const market = isPortfolio ? 'US' : inferMarket(analysis.ticker);
  const targetCurrency = market === 'HK' ? 'HKD' : market === 'CN' ? 'CNY' : 'USD';

  const displayCatalysts = catalysts && hasDeepReport
    ? catalysts.slice(0, 3)
    : catalysts;
  const displayRisks = risks && hasDeepReport
    ? risks.slice(0, 3)
    : risks;

  const isCollapsed = !isPortfolio && !expanded;

  const handleDeepReportClick = () => {
    if (deepReportRunId) {
      navigate(`/analysis/deep-report/${deepReportRunId}`);
    }
  };

  return (
    <Card
      className={cn(
        'flex flex-col relative overflow-hidden',
        isPortfolio && 'border-primary/40 bg-gradient-to-br from-primary/5 via-card to-card',
        deepReportRunId && 'border-amber-500/40',
      )}
    >
      <CardHeader className="pb-3">
        {isPortfolio ? (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              <CardTitle className="font-serif text-lg text-primary">
                组合策略复盘
              </CardTitle>
            </div>
            <CardDescription>
              当日整体市场判断与组合操作策略
            </CardDescription>
          </div>
        ) : (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <CardTitle className="font-mono-nums text-lg font-semibold tracking-tight truncate">
                {analysis.ticker}
              </CardTitle>
              <CardDescription className="mt-0.5 flex items-center gap-1.5 text-sm truncate">
                {companyName && <span className="truncate">{companyName}</span>}
                {companyName && analysis.targetPrice && (
                  <span className="text-muted-foreground/40 shrink-0">·</span>
                )}
                {analysis.targetPrice && (
                  <span className="font-mono-nums text-xs shrink-0">
                    目标价 {formatPriceWithCurrency(analysis.targetPrice, targetCurrency)}
                  </span>
                )}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-1.5 shrink-0">
              {analysis.rating && (
                <Badge
                  variant="outline"
                  className={cn(
                    'border-transparent text-[11px] font-medium rounded-md',
                    ratingColor(analysis.rating)
                  )}
                >
                  {analysis.rating}
                </Badge>
              )}
              {deepReportRunId && (
                <button
                  onClick={handleDeepReportClick}
                  className="inline-flex"
                >
                  <Badge
                    variant="outline"
                    title="仅完成深度分析的股票会显示此入口"
                    className="gap-1 border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium text-[11px] rounded-md hover:bg-amber-500/20 transition-colors"
                  >
                    <Sparkles size={11} />
                    深度报告
                  </Badge>
                </button>
              )}
            </div>
          </div>
        )}
      </CardHeader>

      <Separator />

      {/* Core numbers row */}
      {!isPortfolio && (
        <div className="grid grid-cols-1 gap-2 px-5 py-4 sm:grid-cols-2">
          {/* Target price */}
          <div className="flex flex-col items-center justify-center rounded-md bg-muted/30 px-2 py-3">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              目标价
            </span>
            <span className="mt-0.5 font-serif text-3xl font-bold text-foreground sm:text-2xl">
              {analysis.targetPrice ? formatPriceWithCurrency(analysis.targetPrice, targetCurrency) : '—'}
            </span>
          </div>
          {/* Action - short label */}
          <div className="flex flex-col items-center justify-center rounded-md bg-muted/30 px-2 py-3">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              操作建议
            </span>
            <span
              className={cn(
                'mt-0.5 font-serif text-2xl font-bold sm:text-xl',
                actionTextColor(analysis.action),
              )}
            >
              {analysis.action ? actionShortLabel(analysis.action) : '—'}
            </span>
          </div>
        </div>
      )}

      {isPortfolio && analysis.targetPrice && (
        <div className="px-5 pt-4">
          <div className="flex items-center gap-2">
            <Target className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">目标价</span>
            <span className="font-mono-nums text-sm font-semibold text-foreground">
              {formatPriceWithCurrency(analysis.targetPrice, targetCurrency)}
            </span>
          </div>
        </div>
      )}

      <CardContent className={cn('flex-1 space-y-4 pt-4', isPortfolio && 'pt-4')}>
        {/* Action suggestion - full-width on all screens */}
        {!isPortfolio && analysis.action && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <Target className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
              操作建议
            </div>
            <p className={cn(
              'whitespace-pre-wrap break-words text-sm font-medium leading-relaxed',
              actionTextColor(analysis.action),
            )}>
              {analysis.action}
            </p>
          </div>
        )}

        {/* Analysis conclusion section */}
        {analysis.analysis && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <Target className="h-3.5 w-3.5 text-primary" />
              {isPortfolio ? '策略观点' : '分析结论'}
            </div>
            <p
              className={cn(
                'whitespace-pre-wrap text-sm leading-relaxed text-foreground/80',
                isCollapsed && 'line-clamp-2',
              )}
            >
              {analysis.analysis}
            </p>
          </div>
        )}

        {/* Catalysts + Risks section */}
        {!isCollapsed &&
          (catalysts || risks || analysis.catalysts?.trim() || analysis.risks?.trim()) && (
          <>
            <Separator className="my-1" />
            <div className="grid gap-4 md:grid-cols-2">
              {displayCatalysts ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                    <TrendingUp className="h-3.5 w-3.5 text-success" />
                    关键催化剂
                  </div>
                  <ul className="space-y-1 text-sm">
                    {displayCatalysts.map((c, i) => (
                      <li key={i} className="flex gap-2 text-foreground/75">
                        <span className="font-mono-nums text-xs text-success shrink-0">
                          {i + 1}.
                        </span>
                        <span>{c}</span>
                      </li>
                    ))}
                    {hasDeepReport && catalysts && catalysts.length > 3 && (
                      <li className="text-xs text-muted-foreground">
                        还有 {catalysts.length - 3} 条催化剂，查看深度报告了解更多
                      </li>
                    )}
                  </ul>
                </div>
              ) : analysis.catalysts?.trim() ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                    <TrendingUp className="h-3.5 w-3.5 text-success" />
                    关键催化剂
                  </div>
                  <p className="text-sm text-foreground/75">
                    {hasDeepReport && analysis.catalysts.length > 150
                      ? analysis.catalysts.slice(0, 150) + '...'
                      : analysis.catalysts}
                  </p>
                </div>
              ) : null}

              {displayRisks ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                    <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                    风险提示
                  </div>
                  <ul className="space-y-1 text-sm">
                    {displayRisks.map((r, i) => (
                      <li key={i} className="flex gap-2 text-foreground/75">
                        <span className="font-mono-nums text-xs text-destructive shrink-0">
                          {i + 1}.
                        </span>
                        <span>{r}</span>
                      </li>
                    ))}
                    {hasDeepReport && risks && risks.length > 3 && (
                      <li className="text-xs text-muted-foreground">
                        还有 {risks.length - 3} 条风险提示，查看深度报告了解更多
                      </li>
                    )}
                  </ul>
                </div>
              ) : analysis.risks?.trim() ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                    <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                    风险提示
                  </div>
                  <p className="text-sm text-foreground/75">
                    {hasDeepReport && analysis.risks.length > 150
                      ? analysis.risks.slice(0, 150) + '...'
                      : analysis.risks}
                  </p>
                </div>
              ) : null}
            </div>
          </>
        )}
      </CardContent>

      {!isPortfolio && (
        <div className="px-3 pb-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs text-muted-foreground"
            onClick={() => setExpanded((v: boolean) => !v)}
          >
            {expanded ? (
              <ChevronUp className="mr-1 h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="mr-1 h-3.5 w-3.5" />
            )}
            {expanded ? '收起' : '展开详情'}
          </Button>
        </div>
      )}

      {/* Deep report footer link */}
      {deepReportRunId && (
        <>
          <Separator />
          <div className="px-5 py-3">
            <button
              onClick={handleDeepReportClick}
              className="flex w-full items-center justify-between text-xs font-medium text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300 transition-colors"
            >
              <span className="flex items-center gap-1.5">
                <Sparkles size={12} />
                查看深度报告
              </span>
              <ChevronRight size={14} />
            </button>
          </div>
        </>
      )}
    </Card>
  );
}

export default AnalysisCard;
