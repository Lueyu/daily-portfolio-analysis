import { Receipt, Plus } from 'lucide-react';
import type { Transaction } from '@shared/api.interface';
import {
  formatPrice,
  formatShares,
  formatCurrency,
  formatDate,
  plClass,
  cn,
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
import { Trash2 } from 'lucide-react';

interface TransactionListProps {
  loading: boolean;
  error: string | null;
  transactions: Transaction[];
  onAdd: () => void;
  onDelete: (id: string) => void;
}

export default function TransactionList({
  loading,
  error,
  transactions,
  onAdd,
  onDelete,
}: TransactionListProps) {
  const buyTotal = transactions
    .filter((t) => t.txType === 'Buy')
    .reduce(
      (sum, t) =>
        sum +
        parseFloat(t.shares) * parseFloat(t.price) +
        parseFloat(t.fees || '0'),
      0
    );
  const sellTotal = transactions
    .filter((t) => t.txType === 'Sell')
    .reduce(
      (sum, t) =>
        sum +
        parseFloat(t.shares) * parseFloat(t.price) -
        parseFloat(t.fees || '0'),
      0
    );

  if (loading) {
    return (
      <Card className="md:hidden">
        <CardContent className="p-4 space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <div className="p-8 text-center text-destructive text-sm md:hidden">
        {error}
      </div>
    );
  }

  if (transactions.length === 0) {
    return (
      <div className="md:hidden">
        <Empty>
          <EmptyMedia variant="icon">
            <Receipt />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>暂无交易记录</EmptyTitle>
            <EmptyDescription>
              点击「添加交易」开始记录
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" onClick={onAdd}>
              <Plus className="size-4" />
              添加交易
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  return (
    <div className="md:hidden space-y-3">
      {transactions.map((t) => {
        const amount =
          parseFloat(t.shares) * parseFloat(t.price) +
          (t.txType === 'Buy'
            ? parseFloat(t.fees || '0')
            : -parseFloat(t.fees || '0'));
        return (
          <Card key={t.id}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono-nums font-bold text-primary">
                      {t.ticker}
                    </span>
                    <Badge
                      className={cn(
                        t.txType === 'Buy'
                          ? 'bg-primary/10 text-primary'
                          : 'bg-muted text-muted-foreground',
                        'text-[10px]'
                      )}
                      variant="outline"
                    >
                      {t.txType === 'Buy' ? '买入' : '卖出'}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 font-mono-nums">
                    {formatDate(t.txDate)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div
                    className="font-mono-nums text-lg font-semibold text-foreground"
                  >
                    <span className="text-muted-foreground">
                      {t.txType === 'Buy' ? '-' : '+'}
                    </span>
                    {formatCurrency(amount)}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => onDelete(t.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 mt-3 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">股数</div>
                  <div className="font-mono-nums">
                    {formatShares(t.shares)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">价格</div>
                  <div className="font-mono-nums">
                    {formatPrice(t.price)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">手续费</div>
                  <div className="font-mono-nums">
                    {formatCurrency(t.fees || '0')}
                  </div>
                </div>
              </div>

              {t.notes && (
                <div className="mt-3 pt-3 border-t text-xs text-muted-foreground">
                  {t.notes}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
