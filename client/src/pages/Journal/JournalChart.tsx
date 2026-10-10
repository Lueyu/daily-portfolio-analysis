/**
 * @file pages/Journal/JournalChart.tsx
 * @description Dual-axis ECharts for the journal page.
 *
 * Bars show daily P/L (left axis, green/red by sign); a smoothed area line
 * shows account value over time (right axis). Snapshots are sorted by date
 * ascending; invalid dates are filtered out.
 */
import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import type { Snapshot } from '@shared/api.interface';
import { toDate } from '@/utils/format';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Empty,
  EmptyContent,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty';

/** Props for {@link JournalChart}. */
interface JournalChartProps {
  snapshots: Snapshot[];
  loading: boolean;
}

/**
 * Render the daily-P/L bar + account-value line chart.
 */
export function JournalChart({ snapshots, loading }: JournalChartProps) {
  /** Build the ECharts option from snapshots; returns {} when there is no data. */
  const chartOption = useMemo(() => {
    const valid = snapshots.filter((s) => toDate(s.snapshotDate));
    if (valid.length === 0) return {};
    const sorted = [...valid]
      .sort((a, b) => new Date(a.snapshotDate).getTime() - new Date(b.snapshotDate).getTime());

    const dates = sorted.map((s) => {
      const d = new Date(s.snapshotDate);
      return `${d.getMonth() + 1}/${d.getDate()}`;
    });
    const dailyPl = sorted.map((s) => Number(s.dailyPl) || 0);
    const accountValues = sorted.map((s) => Number(s.accountValue) || 0);

    return {
      grid: { top: 40, right: 60, bottom: 40, left: 60 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
      },
      legend: {
        data: ['每日盈亏', '账户净值'],
        top: 0,
        right: 0,
        textStyle: { fontSize: 12, color: '#64748b' },
      },
      xAxis: {
        type: 'category',
        data: dates,
        axisLabel: { fontSize: 10, color: '#64748b', interval: 'auto' },
        axisLine: { lineStyle: { color: '#e2e8f0' } },
        axisTick: { show: false },
      },
      yAxis: [
        {
          type: 'value',
          name: '盈亏($)',
          nameTextStyle: { fontSize: 10, color: '#64748b' },
          axisLabel: {
            fontSize: 10,
            color: '#64748b',
            formatter: (v: number) =>
              Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v),
          },
          splitLine: { lineStyle: { color: '#f1f5f9', type: 'dashed' } },
        },
        {
          type: 'value',
          name: '净值($)',
          nameTextStyle: { fontSize: 10, color: '#64748b' },
          axisLabel: {
            fontSize: 10,
            color: '#64748b',
            formatter: (v: number) =>
              Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v),
          },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: '每日盈亏',
          type: 'bar',
          yAxisIndex: 0,
          data: dailyPl.map((v) => ({
            value: Number(v.toFixed(2)),
            itemStyle: {
              color: v >= 0 ? '#16a34a' : '#dc2626',
              borderRadius: [3, 3, 0, 0],
            },
          })),
          barWidth: '50%',
        },
        {
          name: '账户净值',
          type: 'line',
          yAxisIndex: 1,
          data: accountValues.map((v) => Number(v.toFixed(2))),
          smooth: true,
          symbol: 'circle',
          symbolSize: 5,
          lineStyle: { color: '#b8860b', width: 2 },
          itemStyle: { color: '#b8860b' },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(184, 134, 11, 0.15)' },
                { offset: 1, color: 'rgba(184, 134, 11, 0.02)' },
              ],
            },
          },
        },
      ],
    };
  }, [snapshots]);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between pb-3">
        <CardTitle className="font-serif text-lg">盈亏与净值走势</CardTitle>
        <span className="text-xs text-muted-foreground">最近 30 天</span>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[300px] w-full" />
        ) : snapshots.length === 0 ? (
          <Empty className="py-16">
            <EmptyContent>
              <EmptyTitle>暂无快照数据</EmptyTitle>
              <EmptyDescription>生成快照后这里将显示走势图表</EmptyDescription>
            </EmptyContent>
          </Empty>
        ) : (
          <ReactECharts
            option={chartOption}
            style={{ height: 300, width: '100%' }}
            notMerge
            lazyUpdate
          />
        )}
      </CardContent>
    </Card>
  );
}
