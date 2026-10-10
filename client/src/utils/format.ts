export function formatCurrency(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '$0.00';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '$0.00';
  const abs = Math.abs(num);
  let formatted: string;
  if (abs >= 1e9) {
    formatted = (num / 1e9).toFixed(2) + 'B';
  } else if (abs >= 1e6) {
    formatted = (num / 1e6).toFixed(2) + 'M';
  } else if (abs >= 1e3) {
    formatted = num.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } else {
    formatted = num.toFixed(2);
  }
  return '$' + formatted;
}

export function formatPrice(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '—';
  return '$' + num.toFixed(2);
}

export function formatPercent(
  value: string | number | null | undefined,
  digits = 2
): string {
  if (value === null || value === undefined || value === '') return '0.00%';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '0.00%';
  const sign = num > 0 ? '+' : '';
  return sign + num.toFixed(digits) + '%';
}

export function formatNumber(
  value: string | number | null | undefined,
  digits = 2
): string {
  if (value === null || value === undefined || value === '') return '0';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '0';
  return num.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatShares(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '0';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '0';
  return num.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

export function toDate(
  value: string | Date | null | undefined
): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'string') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function formatDate(
  value: string | Date | null | undefined
): string {
  const date = toDate(value);
  if (!date) return '—';
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

export function formatDateTime(
  value: string | Date | null | undefined
): string {
  const date = toDate(value);
  if (!date) return '—';
  const dateStr = date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const timeStr = date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${dateStr} ${timeStr}`;
}

export function formatTime(date: Date): string {
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function plClass(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num) || num === 0) return 'text-muted-foreground';
  return num > 0 ? 'text-success' : 'text-destructive';
}

export function ratingColor(rating: string | null | undefined): string {
  if (!rating) return 'bg-muted text-muted-foreground';
  switch (rating) {
    case 'Strong Buy':
    case 'Buy':
      return 'bg-muted text-success';
    case 'Hold':
      return 'bg-muted text-warning';
    case 'Sell':
    case 'Strong Sell':
      return 'bg-muted text-destructive';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

export function signalColor(signal: string | null | undefined): string {
  if (!signal) return 'bg-muted text-muted-foreground';
  switch (signal) {
    case '强烈买入':
    case '买入':
      return 'bg-muted text-success';
    case '观望':
      return 'bg-muted text-warning';
    case '回避':
      return 'bg-muted text-destructive';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

export function actionColor(action: string | null | undefined): string {
  if (!action) return 'bg-muted text-muted-foreground';
  switch (action) {
    case '加仓':
    case '买入':
      return 'bg-muted text-success';
    case '持有':
      return 'bg-muted text-warning';
    case '减仓':
    case '卖出':
      return 'bg-muted text-destructive';
    case '观望':
      return 'bg-muted text-foreground';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

export function formatCurrencyWithCode(
  value: string | number | null | undefined,
  currency: string = 'USD',
): string {
  if (value === null || value === undefined || value === '') return formatCurrencyWithCode('0', currency);
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return formatCurrencyWithCode('0', currency);
  const abs = Math.abs(num);
  let formatted: string;
  if (abs >= 1e9) {
    formatted = (num / 1e9).toFixed(2) + 'B';
  } else if (abs >= 1e6) {
    formatted = (num / 1e6).toFixed(2) + 'M';
  } else if (abs >= 1e3) {
    formatted = num.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } else {
    formatted = num.toFixed(2);
  }
  const cur = currency.toUpperCase();
  if (cur === 'CNY') return '¥' + formatted;
  if (cur === 'HKD') return 'HK$' + formatted;
  return '$' + formatted;
}

function currencySymbol(currency: string): string {
  const cur = currency.toUpperCase();
  if (cur === 'CNY') return 'CN¥';
  if (cur === 'HKD') return 'HK$';
  return '$';
}

export function formatPriceWithCurrency(
  value: string | number | null | undefined,
  currency: string = 'USD',
): string {
  if (value === null || value === undefined || value === '') return '—';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '—';
  return currencySymbol(currency) + num.toFixed(2);
}

export function formatCurrencyWithCurrency(
  value: string | number | null | undefined,
  currency: string = 'USD',
): string {
  if (value === null || value === undefined || value === '') {
    return formatCurrencyWithCurrency('0', currency);
  }
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return formatCurrencyWithCurrency('0', currency);
  const abs = Math.abs(num);
  let formatted: string;
  if (abs >= 1e9) {
    formatted = (num / 1e9).toFixed(2) + 'B';
  } else if (abs >= 1e6) {
    formatted = (num / 1e6).toFixed(2) + 'M';
  } else if (abs >= 1e3) {
    formatted = num.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } else {
    formatted = num.toFixed(2);
  }
  return currencySymbol(currency) + formatted;
}

export function cn(...classes: (string | undefined | false | null)[]): string {
  return classes.filter(Boolean).join(' ');
}
