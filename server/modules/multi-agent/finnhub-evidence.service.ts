import { Injectable } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import type { EvidenceInput } from './evidence.service';

interface FinnhubMetricsResult {
  items: EvidenceInput[];
  hasValuation: boolean;
}

interface FinnhubArticle {
  headline?: unknown;
  summary?: unknown;
  source?: unknown;
  url?: unknown;
  datetime?: unknown;
}

const FINNHUB_API = 'https://api.finnhub.io/api/v1';
const MAX_NEWS_ITEMS = 5;

/** Only U.S. symbols are queried: Finnhub's company news covers North America. */
function isSupportedSymbol(ticker: string): boolean {
  const upper = ticker.toUpperCase().trim();
  return /^[A-Z][A-Z0-9.-]{0,19}$/.test(upper)
    && !/\.(HK|SH|SS|SZ|BJ)$/.test(upper);
}

function cleanText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function safeArticleUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

@Injectable()
export class FinnhubEvidenceService {
  constructor(private readonly settings: SettingsService) {}

  private async request(
    path: string,
    token: string,
    params: Record<string, string>,
  ): Promise<unknown> {
    const url = new URL(`${FINNHUB_API}${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    url.searchParams.set('token', token);
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload: unknown = await response.json();
      if (payload && typeof payload === 'object' && 'error' in payload) {
        throw new Error('Provider rejected the request');
      }
      return payload;
    } catch (error) {
      // Never forward a provider error containing the URL or the user's key.
      const status = error instanceof Error && /^HTTP \d+$/.test(error.message)
        ? error.message : 'request failed';
      throw new Error(`Finnhub ${status}`);
    }
  }

  async getMetrics(userId: string, ticker: string): Promise<FinnhubMetricsResult | null> {
    if (!isSupportedSymbol(ticker)) return null;
    const token = await this.settings.getFinnhubKey(userId);
    if (!token) return null;

    const raw = await this.request('/stock/metric', token, {
      symbol: ticker.toUpperCase(), metric: 'all',
    });
    const metric = raw && typeof raw === 'object' && 'metric' in raw
      ? raw.metric : null;
    if (!metric || typeof metric !== 'object') {
      return { items: [], hasValuation: false };
    }

    const fields: Array<[string, string]> = [
      ['peBasicExclExtraTTM', 'P/E (TTM, excluding extraordinary items)'],
      ['pbAnnual', 'P/B (annual)'],
      ['psTTM', 'P/S (TTM)'],
    ];
    const values: string[] = [];
    for (const [key, label] of fields) {
      const rawValue = (metric as Record<string, unknown>)[key];
      const numeric = typeof rawValue === 'number' ? rawValue : Number(rawValue);
      if (rawValue != null && Number.isFinite(numeric) && numeric > 0) {
        values.push(`${label}: ${numeric.toFixed(2)}`);
      }
    }
    if (values.length === 0) return { items: [], hasValuation: false };
    return {
      hasValuation: true,
      items: [{
        role: 'fundamental',
        evidenceType: 'financial',
        title: `${ticker.toUpperCase()} Finnhub valuation metrics`,
        content: values.join('; '),
        sourceName: 'Finnhub API',
        relevanceScore: 0.8,
      }],
    };
  }

  async getNews(userId: string, ticker: string): Promise<EvidenceInput[] | null> {
    if (!isSupportedSymbol(ticker)) return null;
    const token = await this.settings.getFinnhubKey(userId);
    if (!token) return null;

    const to = new Date();
    const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
    const raw = await this.request('/company-news', token, {
      symbol: ticker.toUpperCase(),
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
    });
    if (!Array.isArray(raw)) return [];

    return (raw as FinnhubArticle[])
      .filter((article) => cleanText(article.headline, 300).length > 0
        && typeof article.datetime === 'number'
        && Number.isFinite(article.datetime)
        && article.datetime * 1000 >= from.getTime()
        && article.datetime * 1000 <= to.getTime())
      .slice(0, MAX_NEWS_ITEMS)
      .map((article) => {
        const headline = cleanText(article.headline, 300);
        const summary = cleanText(article.summary, 500);
        const publisher = cleanText(article.source, 80);
        const publishedAt = new Date((article.datetime as number) * 1000).toISOString();
        return {
          role: 'news' as const,
          evidenceType: 'news' as const,
          title: headline,
          content: `Published: ${publishedAt}. ${publisher ? `Publisher: ${publisher}. ` : ''}${summary || 'Headline only; no article summary supplied.'}`,
          sourceUrl: safeArticleUrl(article.url),
          sourceName: 'Finnhub API',
          relevanceScore: 0.65,
        };
      });
  }
}
