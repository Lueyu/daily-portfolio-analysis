import {
  ChevronDown,
  ChevronUp,
  Briefcase,
  Plus,
  Eye,
} from 'lucide-react';
import {
  formatShares,
  formatPercent,
  plClass,
  ratingColor,
  actionColor,
  cn,
  formatPriceWithCurrency,
  formatCurrencyWithCurrency,
} from '@/utils/format';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import type { Group, Market, Currency, AgentRating, AgentConfidence } from '@shared/api.interface';
import RatingBadge from '@/components/MultiAgent/RatingBadge';
import ConfidenceBadge from '@/components/MultiAgent/ConfidenceBadge';

type SortKey =
  | 'ticker'
  | 'company'
  | 'buyPrice'
  | 'currentPrice'
  | 'shares'
  | 'marketValue'
  | 'cost'
  | 'pl'
  | 'returnPct';

interface DerivedHolding {
  id: string;
  ticker: string;
  company: string | null;
  buyPrice: string | null;
  currentPrice: string | null;
  shares: string;
  rating: string | null;
  action: string | null;
  groupId: string | null;
  market: Market;
  currency: Currency;
  marketValue: number;
  cost: number;
  pl: number;
  returnPct: number;
}

interface CashAccountRow {
  currency: Currency;
  balance: string;
}

interface AiRatingInfo {
  rating: AgentRating;
  confidence: AgentConfidence;
  runId: string;
  bullSummary?: string | null;
  bearSummary?: string | null;
}

interface HoldingsTableProps {
  loading: boolean;
  error: string | null;
  holdings: DerivedHolding[];
  groups: Group[];
  sortKey: SortKey;
  sortDir: 'asc' | 'desc';
  onSort: (key: SortKey) => void;
  onAdd: () => void;
  onDetail: (h: DerivedHolding) => void;
  cashAccounts: CashAccountRow[];
  aiRatings?: Record<string, AiRatingInfo>;
  onViewAiAnalysis?: (ticker: string, runId: string) => void;
}

export default function HoldingsTable({
  loading,
  error,
  holdings,
  groups,
  sortKey,
  sortDir,
  onSort,
  onAdd,
  onDetail,
  cashAccounts,
  aiRatings,
  onViewAiAnalysis,
}: HoldingsTableProps) {
  const SortIcon = ({ column }: { column: SortKey }) => {
    if (sortKey !== column)
      return <ChevronDown className="size-3 opacity-30" />;
    return sortDir === 'asc' ? (
      <ChevronUp className="size-3" />
    ) : (
      <ChevronDown className="size-3" />
    );
  };

  const groupName = (id: string | null) =>
    groups.find((g) => g.id === id)?.name ?? '未分组';

  const mvByCurrency = holdings.reduce<Record<string, number>>((acc, h) => {
    acc[h.currency] = (acc[h.currency] ?? 0) + h.marketValue;
    return acc;
  }, {});

  const cashByCurrency = cashAccounts.reduce<Record<string, number>>(
    (acc, c) => {
      acc[c.currency] = (acc[c.currency] ?? 0) + parseFloat(c.balance || '0');
      return acc;
    },
    {}
  );

  const currencyLabel: Record<string, string> = {
    USD: '美股',
    HKD: '港股',
    CNY: 'A股',
  };

  const sortedCurrencies = Object.keys(mvByCurrency).sort();
  const hasCash = Object.keys(cashByCurrency).length > 0;
  const hasAnyAiRating = Object.keys(aiRatings ?? {}).length > 0;

  return (
    <Card className="hidden md:block">
      <CardContent className="p-0">
        {loading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : error ? (
          <div className="p-12 text-center text-destructive text-sm">
            {error}
          </div>
        ) : holdings.length === 0 ? (
          <div className="p-12">
            <Empty>
              <EmptyMedia variant="icon">
                <Briefcase />
              </EmptyMedia>
              <EmptyHeader>
                <EmptyTitle>暂无持仓</EmptyTitle>
                <EmptyDescription>
                  点击右上角「添加持仓」开始记录你的投资组合
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button size="sm" onClick={onAdd}>
                  <Plus className="size-4" />
                  添加持仓
                </Button>
              </EmptyContent>
            </Empty>
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead
                    className="cursor-pointer select-none"
                    onClick={() => onSort('ticker')}
                  >
                    <span className="flex items-center gap-1">
                      代码
                      <SortIcon column="ticker" />
                    </span>
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none"
                    onClick={() => onSort('company')}
                  >
                    <span className="flex items-center gap-1">
                      公司
                      <SortIcon column="company" />
                    </span>
                  </TableHead>
                  <TableHead
                    className="text-right cursor-pointer select-none"
                    onClick={() => onSort('buyPrice')}
                  >
                    <span className="flex items-center gap-1 justify-end">
                      买入价
                      <SortIcon column="buyPrice" />
                    </span>
                  </TableHead>
                  <TableHead
                    className="text-right cursor-pointer select-none"
                    onClick={() => onSort('currentPrice')}
                  >
                    <span className="flex items-center gap-1 justify-end">
                      现价
                      <SortIcon column="currentPrice" />
                    </span>
                  </TableHead>
                  <TableHead
                    className="text-right cursor-pointer select-none"
                    onClick={() => onSort('shares')}
                  >
                    <span className="flex items-center gap-1 justify-end">
                      股数
                      <SortIcon column="shares" />
                    </span>
                  </TableHead>
                  <TableHead
                    className="text-right cursor-pointer select-none"
                    onClick={() => onSort('marketValue')}
                  >
                    <span className="flex items-center gap-1 justify-end">
                      市值
                      <SortIcon column="marketValue" />
                    </span>
                  </TableHead>
                  <TableHead
                    className="text-right cursor-pointer select-none"
                    onClick={() => onSort('cost')}
                  >
                    <span className="flex items-center gap-1 justify-end">
                      成本
                      <SortIcon column="cost" />
                    </span>
                  </TableHead>
                  <TableHead
                    className="text-right cursor-pointer select-none"
                    onClick={() => onSort('pl')}
                  >
                    <span className="flex items-center gap-1 justify-end">
                      浮盈亏
                      <SortIcon column="pl" />
                    </span>
                  </TableHead>
                  <TableHead
                    className="text-right cursor-pointer select-none"
                    onClick={() => onSort('returnPct')}
                  >
                    <span className="flex items-center gap-1 justify-end">
                      收益率
                      <SortIcon column="returnPct" />
                    </span>
                  </TableHead>
                  <TableHead>评级</TableHead>
                  {hasAnyAiRating && <TableHead>AI 评级</TableHead>}
                  <TableHead>操作</TableHead>
                  <TableHead>分组</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {holdings.map((h) => (
                  <TableRow
                    key={h.id}
                    className="cursor-pointer"
                    onClick={() => onDetail(h)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-mono-nums font-semibold text-primary">
                          {h.ticker}
                        </span>
                        <Badge
                          variant="outline"
                          className="h-4 px-1 text-[10px] font-normal"
                        >
                          {h.market || 'US'}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[180px] truncate">
                      {h.company ?? '—'}
                    </TableCell>
                    <TableCell className="text-right font-mono-nums">
                      {formatPriceWithCurrency(h.buyPrice, h.currency)}
                    </TableCell>
                    <TableCell className="text-right font-mono-nums font-medium">
                      {formatPriceWithCurrency(h.currentPrice, h.currency)}
                    </TableCell>
                    <TableCell className="text-right font-mono-nums">
                      {formatShares(h.shares)}
                    </TableCell>
                    <TableCell className="text-right font-mono-nums">
                      {formatCurrencyWithCurrency(h.marketValue, h.currency)}
                    </TableCell>
                    <TableCell className="text-right font-mono-nums">
                      {formatCurrencyWithCurrency(h.cost, h.currency)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right font-mono-nums font-medium',
                        plClass(h.pl)
                      )}
                    >
                      {formatCurrencyWithCurrency(h.pl, h.currency)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right font-mono-nums font-medium',
                        plClass(h.returnPct)
                      )}
                    >
                      {formatPercent(h.returnPct)}
                    </TableCell>
                    <TableCell>
                      {h.rating ? (
                        <Badge
                          className={cn(ratingColor(h.rating))}
                          variant="outline"
                        >
                          {h.rating}
                        </Badge>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    {hasAnyAiRating && (
                      <TableCell>
                        {aiRatings?.[h.ticker] ? (
                          <div className="flex items-center gap-1.5">
                            <RatingBadge
                              rating={aiRatings[h.ticker].rating}
                              size="sm"
                            />
                            <ConfidenceBadge
                              confidence={aiRatings[h.ticker].confidence}
                              size="sm"
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-6"
                              onClick={(e) => {
                                e.stopPropagation();
                                onViewAiAnalysis?.(h.ticker, aiRatings[h.ticker].runId);
                              }}
                            >
                              <Eye className="size-3.5 text-muted-foreground" />
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground/70">暂无评级</span>
                        )}
                      </TableCell>
                    )}
                    <TableCell>
                      {h.action ? (
                        <Badge
                          className={cn(actionColor(h.action))}
                          variant="outline"
                        >
                          {h.action}
                        </Badge>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {groupName(h.groupId)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {(sortedCurrencies.length > 0 || hasCash) && (
              <div className="px-4 py-3 border-t text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                {sortedCurrencies.length > 0 && (
                  <span className="flex items-center gap-1.5">
                    <span className="font-medium">市值小计</span>
                    {sortedCurrencies.map((cur, i) => (
                      <span key={cur} className="font-mono-nums">
                        {i > 0 && <span className="mx-1">·</span>}
                        {currencyLabel[cur] ?? cur}{' '}
                        {formatCurrencyWithCurrency(mvByCurrency[cur], cur)}
                      </span>
                    ))}
                  </span>
                )}
                {hasCash && (
                  <span className="flex items-center gap-1.5">
                    <span className="font-medium">现金</span>
                    {Object.keys(cashByCurrency)
                      .sort()
                      .map((cur, i) => (
                        <span key={cur} className="font-mono-nums">
                          {i > 0 && <span className="mx-1">·</span>}
                          {currencyLabel[cur] ?? cur}{' '}
                          {formatCurrencyWithCurrency(cashByCurrency[cur], cur)}
                        </span>
                      ))}
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
