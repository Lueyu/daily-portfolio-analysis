import { useState } from 'react';
import { ChevronRight, Briefcase, Plus, Eye } from 'lucide-react';
import type { Group, Market, Currency, AgentRating, AgentConfidence } from '@shared/api.interface';
import RatingBadge from '@/components/MultiAgent/RatingBadge';
import ConfidenceBadge from '@/components/MultiAgent/ConfidenceBadge';
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
import { Skeleton } from '@/components/ui/skeleton';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';

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

interface AiRatingInfo {
  rating: AgentRating;
  confidence: AgentConfidence;
  runId: string;
  bullSummary?: string | null;
  bearSummary?: string | null;
}

interface HoldingsMobileListProps {
  loading: boolean;
  error: string | null;
  holdings: DerivedHolding[];
  groups: Group[];
  onAdd: () => void;
  onDetail: (h: DerivedHolding) => void;
  aiRatings?: Record<string, AiRatingInfo>;
  onViewAiAnalysis?: (ticker: string, runId: string) => void;
}

export default function HoldingsMobileList({
  loading,
  error,
  holdings,
  groups,
  onAdd,
  onDetail,
  aiRatings,
  onViewAiAnalysis,
}: HoldingsMobileListProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const groupName = (id: string | null) =>
    groups.find((g) => g.id === id)?.name ?? '未分组';

  const hasAnyAiRating = Object.keys(aiRatings ?? {}).length > 0;

  if (loading) {
    return (
      <div className="md:hidden space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-4 space-y-3">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-8 w-32" />
              <div className="grid grid-cols-2 gap-3">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 text-center text-destructive text-sm md:hidden">
        {error}
      </div>
    );
  }

  if (holdings.length === 0) {
    return (
      <div className="md:hidden">
        <Empty>
          <EmptyMedia variant="icon">
            <Briefcase />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>暂无持仓</EmptyTitle>
            <EmptyDescription>
              点击右上角「添加持仓」开始记录
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
    );
  }

  return (
    <div className="md:hidden space-y-3">
      {holdings.map((h) => (
        <Card key={h.id} className="overflow-hidden">
          <button
            className="w-full text-left"
            onClick={() => setExpanded(expanded === h.id ? null : h.id)}
          >
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono-nums font-bold text-primary text-lg">
                      {h.ticker}
                    </span>
                    {h.rating && (
                      <Badge
                        className={cn(
                          ratingColor(h.rating),
                          'text-[10px]'
                        )}
                        variant="outline"
                      >
                        {h.rating}
                      </Badge>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground mt-0.5 truncate max-w-[200px]">
                    {h.company ?? '—'}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono-nums text-xl font-semibold">
                    {formatPriceWithCurrency(h.currentPrice, h.currency)}
                  </div>
                  <div
                    className={cn(
                      'font-mono-nums text-sm font-medium',
                      plClass(h.returnPct)
                    )}
                  >
                    {formatPercent(h.returnPct)}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">股数</span>
                  <span className="font-mono-nums">
                    {formatShares(h.shares)}
                  </span>
                </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">市值</span>
                    <span className="font-mono-nums">
                      {formatCurrencyWithCurrency(h.marketValue, h.currency)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">成本</span>
                    <span className="font-mono-nums">
                      {formatCurrencyWithCurrency(h.cost, h.currency)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">浮盈亏</span>
                    <span
                      className={cn(
                        'font-mono-nums font-medium',
                        plClass(h.pl)
                      )}
                    >
                      {formatCurrencyWithCurrency(h.pl, h.currency)}
                    </span>
                  </div>
              </div>

              {expanded === h.id && (
                <div className="mt-3 pt-3 border-t space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">买入价</span>
                    <span className="font-mono-nums">
                      {formatPriceWithCurrency(h.buyPrice, h.currency)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">操作建议</span>
                    <span>
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
                    </span>
                  </div>
                  {hasAnyAiRating && (
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">AI 评级</span>
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
                  </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">分组</span>
                    <span className="text-xs">{groupName(h.groupId)}</span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full mt-2"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDetail(h);
                    }}
                  >
                    查看详情
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
              )}
            </CardContent>
          </button>
        </Card>
      ))}
    </div>
  );
}
