/**
 * @file pages/Dashboard/DailyPlChart.tsx
 * @description ECharts dual-axis chart: account equity line + daily P/L bars.
 *
 * Left Y-axis = account net value (line, area gradient); right Y-axis = daily
 * P/L (green/red bars). Bars are colored by sign (green = gain, red = loss).
 * Tooltip shows both series with adaptive currency symbol.
 */
import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';

/** Props for {@link DailyPlChart}. */
interface DailyPlChartProps {
  /** Daily series: date, account value, daily P/L, daily P/L percent. */
  data: Array<{ date: string; accountValue: string; dailyPl: string; dailyPct: string }>;
  /** Base currency code for axis labels / tooltip; defaults to USD. */
  baseCurrency?: string;
}

/** Currency symbol lookup used by axis/tooltip formatting. */
const CURRENCY_SYMBOL: Record<string, string> = {
  USD: '$',
  HKD: 'HK$',
  CNY: '¥',
};

/**
 * Render the dual-axis daily P/L chart.
 * @param props - See {@link DailyPlChartProps}.
 */
export default function DailyPlChart({ data, baseCurrency = 'USD' }: DailyPlChartProps) {
  const symbol = CURRENCY_SYMBOL[baseCurrency.toUpperCase()] || '$';

  const option = useMemo(() => {
    if (data.length === 0) return {};
    // X-axis labels show MM-DD (year dropped) to save horizontal space.
    const dates = data.map((d) => d.date.slice(5));
    const accountValues = data.map((d) => Number(d.accountValue) || 0);
    const dailyPls = data.map((d) => Number(d.dailyPl) || 0);

    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        formatter: (params: { name: string; seriesName: string; value: number }[]) => {
          if (!params || params.length === 0) return '';
          const parts = [`<strong>${params[0].name}</strong>`];
          for (const p of params) {
            if (p.seriesName === '账户净值') {
              parts.push(`账户净值: <strong>${symbol}${p.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>`);
            } else {
              const sign = p.value >= 0 ? '+' : '';
              const color = p.value >= 0 ? '#16a34a' : '#dc2626';
              parts.push(`日盈亏: <strong style="color:${color}">${sign}${symbol}${p.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>`);
            }
          }
          return parts.join('<br/>');
        },
      },
      legend: {
        data: ['账户净值', '日盈亏'],
        top: 0,
        right: 10,
        textStyle: { fontSize: 11, color: '#64748b' },
      },
      grid: { top: 40, right: 50, bottom: 40, left: 60 },
      xAxis: {
        type: 'category',
        data: dates,
        axisLabel: { fontSize: 10, color: '#94a3b8', rotate: data.length > 20 ? 45 : 0 },
        axisLine: { lineStyle: { color: '#e2e8f0' } },
        axisTick: { show: false },
      },
      yAxis: [
        {
          type: 'value',
          name: '净值',
          nameTextStyle: { fontSize: 10, color: '#94a3b8' },
          axisLabel: {
            fontSize: 10,
            color: '#94a3b8',
            formatter: (val: number) => {
              if (Math.abs(val) >= 1e6) return `${(val / 1e6).toFixed(1)}M`;
              if (Math.abs(val) >= 1e3) return `${(val / 1e3).toFixed(0)}k`;
              return val.toFixed(0);
            },
          },
          splitLine: { lineStyle: { color: '#f1f5f9', type: 'dashed' } },
        },
        {
          type: 'value',
          name: '日盈亏',
          nameTextStyle: { fontSize: 10, color: '#94a3b8' },
          axisLabel: {
            fontSize: 10,
            color: '#94a3b8',
            formatter: (val: number) => {
              if (Math.abs(val) >= 1e3) return `${(val / 1e3).toFixed(0)}k`;
              return val.toFixed(0);
            },
          },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: '账户净值',
          type: 'line',
          yAxisIndex: 0,
          data: accountValues,
          smooth: true,
          symbol: 'none',
          lineStyle: { color: '#14504A', width: 2 },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(20, 80, 74, 0.15)' },
                { offset: 1, color: 'rgba(20, 80, 74, 0)' },
              ],
            },
          },
        },
        {
          name: '日盈亏',
          type: 'bar',
          yAxisIndex: 1,
          data: dailyPls.map((v) => ({
            value: v,
            itemStyle: {
              color: v >= 0 ? '#16a34a' : '#dc2626',
              borderRadius: [3, 3, 0, 0],
            },
          })),
          barWidth: Math.max(4, Math.min(14, 300 / data.length)),
        },
      ],
    };
  }, [data, symbol]);

  if (data.length === 0) {
    return (
      <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
        暂无净值数据
      </div>
    );
  }

  return (
    <ReactECharts
      option={option}
      style={{ height: 280, width: '100%' }}
      notMerge
      lazyUpdate
    />
  );
}
