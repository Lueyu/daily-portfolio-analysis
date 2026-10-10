import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { Holding, Currency, QuoteResponse, Market } from '@shared/api.interface';
import {
  formatCurrencyWithCurrency,
  formatPercent,
  formatPriceWithCurrency,
  plClass,
  cn,
} from '@/utils/format';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty';

interface DailyPnLBreakdownProps {
  holdings: Holding[];
  quotes: Record<string, QuoteResponse>;
  baseCurrency: Currency;
  loading?: boolean;
}

function displayCompany(
  company: string | null | undefined,
  ticker: string,
): string {
  const name = (company ?? '').trim();
  if (!name) return '';
  const base = (s: string): string => s.split('.')[0].toUpperCase();
  if (base(name) === base(ticker)) return '';
  return name;
}

const MARKET_LABELS: Record<Market, string> = {
  US: '美股',
  HK: '港股',
  CN: 'A股',
};

export default function DailyPnLBreakdown({
  holdings,
  quotes,
  loading = false,
}: DailyPnLBreakdownProps) {
  const [showAll, setShowAll] = useState(false);

  const rows = useMemo(() => {
    const result = holdings
      .map((h) => {
        const quote = quotes[h.ticker];
        const shares = parseFloat(h.shares || '0');
        const change = quote && quote.change ? parseFloat(quote.change) : 0;
        const changePercent = quote && quote.changePercent
          ? parseFloat(quote.changePercent)
          : 0;
        const dailyPl = shares * change;
        return {
          ticker: h.ticker,
          company: displayCompany(h.company, h.ticker),
          market: h.market,
          currency: h.currency,
          shares,
          change,
          changePercent,
          dailyPl,
          hasQuote: !!quote,
        };
      })
      .filter((r) => r.hasQuote)
      .sort((a, b) => b.dailyPl - a.dailyPl);

    const totalAbs = result.reduce(
      (sum: number, r) => sum + Math.abs(r.dailyPl),
      0
    );

    return result.map((r) => ({
      ...r,
      contribution: totalAbs > 0 ? (r.dailyPl / totalAbs) * 100 : 0,
    }));
  }, [holdings, quotes]);

  const hasQuotes = Object.keys(quotes).length > 0;

  if (loading || !hasQuotes) {
    return (
      <div className="py-8 text-center text-xs text-muted-foreground">
        {holdings.length > 0 ? '行情加载中…' : '暂无持仓'}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <Empty className="py-8">
        <EmptyHeader>
          <EmptyTitle>暂无持仓</EmptyTitle>
          <EmptyDescription>添加持仓后这里将显示逐股盈亏明细</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const visibleRows = showAll ? rows : rows.slice(0, 10);
  const hasMore = rows.length > 10;

  return (
    <div className="space-y-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>股票</TableHead>
            <TableHead className="text-right">股数</TableHead>
            <TableHead className="text-right">当日涨跌</TableHead>
            <TableHead className="text-right">涨跌幅</TableHead>
            <TableHead className="text-right">当日盈亏</TableHead>
            <TableHead className="text-right">贡献占比</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleRows.map((r) => (
            <TableRow key={r.ticker}>
              <TableCell>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{r.ticker}</span>
                  <Badge
                    variant="outline"
                    className="h-4 px-1.5 text-[10px] font-normal text-muted-foreground"
                  >
                    {MARKET_LABELS[r.market] || r.market}
                  </Badge>
                  <span className="truncate text-xs text-muted-foreground">
                    {r.company || (
                      <span className="text-muted-foreground/60">—</span>
                    )}
                  </span>
                </div>
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums text-sm">
                {r.shares.toLocaleString('en-US', {
                  maximumFractionDigits: 4,
                })}
              </TableCell>
              <TableCell
                className={cn(
                  'text-right font-mono tabular-nums text-sm',
                  plClass(r.change)
                )}
              >
                {formatPriceWithCurrency(r.change, r.currency)}
              </TableCell>
              <TableCell
                className={cn(
                  'text-right font-mono tabular-nums text-sm',
                  plClass(r.changePercent)
                )}
              >
                {formatPercent(r.changePercent)}
              </TableCell>
              <TableCell
                className={cn(
                  'text-right font-mono tabular-nums text-sm font-medium',
                  plClass(r.dailyPl)
                )}
              >
                {formatCurrencyWithCurrency(r.dailyPl, r.currency)}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums text-sm text-muted-foreground">
                {formatPercent(r.contribution)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {hasMore && (
        <div className="flex justify-center pt-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowAll((v) => !v)}
            className="text-xs text-muted-foreground"
          >
            {showAll ? '收起' : `查看更多 (${rows.length - 10})`}
            <ChevronDown
              size={14}
              className={cn('transition-transform', showAll && 'rotate-180')}
            />
          </Button>
        </div>
      )}
    </div>
  );
}
