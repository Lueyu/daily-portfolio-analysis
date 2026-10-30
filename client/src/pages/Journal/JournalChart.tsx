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
import { useTranslation } from 'react-i18next';

/** Props for {@link JournalChart}. */
interface JournalChartProps {
  snapshots: Snapshot[];
  loading: boolean;
}

/**
 * Render the daily-P/L bar + account-value line chart.
 */
export function JournalChart({ snapshots, loading }: JournalChartProps) {
  const { t } = useTranslation();
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
      grid: { top: 42, right: 54, bottom: 40, left: 54 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
      },
      legend: {
        data: [t('journal.dailyPl'), t('journal.accountNav')],
        top: 4,
        left: 'center',
        orient: 'horizontal',
        itemGap: 16,
        textStyle: { fontSize: 12, color: '#78828c' },
      },
      xAxis: {
        type: 'category',
        data: dates,
        axisLabel: { fontSize: 10, color: '#78828c', interval: 'auto' },
        axisLine: { lineStyle: { color: 'rgba(120,130,140,0.38)' } },
        axisTick: { show: false },
      },
      yAxis: [
        {
          type: 'value',
          axisLabel: {
            fontSize: 10,
            color: '#78828c',
            formatter: (v: number) =>
              Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v),
          },
          splitLine: { lineStyle: { color: 'rgba(120,130,140,0.24)', type: 'dashed' } },
        },
        {
          type: 'value',
          axisLabel: {
            fontSize: 10,
            color: '#78828c',
            formatter: (v: number) =>
              Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v),
          },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: t('journal.dailyPl'),
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
          name: t('journal.accountNav'),
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
  }, [snapshots, t]);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between pb-3">
        <CardTitle className="font-serif text-lg">{t('ui.journal.chartTitle')}</CardTitle>
        <span className="text-xs text-muted-foreground">{t('ui.journal.last30Days')}</span>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[300px] w-full" />
        ) : snapshots.length === 0 ? (
          <Empty className="py-16">
            <EmptyContent>
              <EmptyTitle>{t('ui.journal.noSnapshots')}</EmptyTitle>
              <EmptyDescription>{t('ui.journal.chartEmptyHint')}</EmptyDescription>
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
