import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { resolveAppUrl } from '@lark-apaas/client-toolkit/utils/resolveAppUrl';
import { logger } from '@lark-apaas/client-toolkit/logger';

declare global {
  interface Window {
    __pt?: PortfolioTerminalAPI;
  }
}

interface PortfolioTerminalAPI {
  getState: () => Promise<unknown>;
  getHistory: () => Promise<unknown>;
  saveDailyAnalysis: (date: string, items: unknown[]) => Promise<unknown>;
  applyHoldingRatings: (items: unknown[]) => Promise<unknown>;
  addWatchItems: (items: unknown[]) => Promise<unknown>;
  removeWatchItems: (tickers: string[]) => Promise<unknown>;
  saveJournal: (data: unknown) => Promise<unknown>;
  getJournal: (date?: string) => Promise<unknown>;
  saveSnapshot: (data: unknown) => Promise<unknown>;
  getSnapshots: (limit?: number) => Promise<unknown>;
  saveDeepReport: (input: unknown) => Promise<unknown>;
  getStrategyRules: () => Promise<unknown>;
  getLatestDeepReport: (ticker: string) => Promise<unknown>;
  listDeepReports: () => Promise<unknown>;
  getMarketStatus?: () => {
    utcNow: string;
    markets: Record<string, {
      phase: string;
      timezone: string;
      localTime: string;
      weekday: number;
      nextRefresh: number;
      lastUpdated: Date | null;
      error: boolean;
      tickerCount: number;
    }>;
  };
}

export function initAgentAPI() {
  if (typeof window === 'undefined') return;

  const api: PortfolioTerminalAPI = {
    async getState() {
      try {
        const response = await axiosForBackend.get('/api/agent/state');
        return response.data;
      } catch (error) {
        logger.error('agent getState failed', error);
        throw error;
      }
    },

    async getHistory() {
      try {
        const response = await axiosForBackend.get('/api/agent/history');
        return response.data;
      } catch (error) {
        logger.error('agent getHistory failed', error);
        throw error;
      }
    },

    async saveDailyAnalysis(date: string, items: unknown[]) {
      try {
        const response = await axiosForBackend.post('/api/agent/daily-analysis', {
          date,
          items,
        });
        return response.data;
      } catch (error) {
        logger.error('agent saveDailyAnalysis failed', error);
        throw error;
      }
    },

    async applyHoldingRatings(items: unknown[]) {
      try {
        const response = await axiosForBackend.post('/api/agent/holding-ratings', {
          items,
        });
        return response.data;
      } catch (error) {
        logger.error('agent applyHoldingRatings failed', error);
        throw error;
      }
    },

    async addWatchItems(items: unknown[]) {
      try {
        const response = await axiosForBackend.post('/api/agent/watch-items/add', {
          items,
        });
        return response.data;
      } catch (error) {
        logger.error('agent addWatchItems failed', error);
        throw error;
      }
    },

    async removeWatchItems(tickers: string[]) {
      try {
        const response = await axiosForBackend.post(
          '/api/agent/watch-items/remove',
          { tickers }
        );
        return response.data;
      } catch (error) {
        logger.error('agent removeWatchItems failed', error);
        throw error;
      }
    },

    async saveJournal(data: unknown) {
      try {
        const response = await axiosForBackend.post('/api/agent/journal', data);
        return response.data;
      } catch (error) {
        logger.error('agent saveJournal failed', error);
        throw error;
      }
    },

    async getJournal(date?: string) {
      try {
        const url = date
          ? `/api/agent/journal?date=${date}`
          : '/api/agent/journal';
        const response = await axiosForBackend.get(url);
        return response.data;
      } catch (error) {
        logger.error('agent getJournal failed', error);
        throw error;
      }
    },

    async saveSnapshot(data: unknown) {
      try {
        const response = await axiosForBackend.post('/api/agent/snapshot', data);
        return response.data;
      } catch (error) {
        logger.error('agent saveSnapshot failed', error);
        throw error;
      }
    },

    async getSnapshots(limit?: number) {
      try {
        const url = limit
          ? `/api/agent/snapshots?limit=${limit}`
          : '/api/agent/snapshots';
        const response = await axiosForBackend.get(url);
        return response.data;
      } catch (error) {
        logger.error('agent getSnapshots failed', error);
        throw error;
      }
    },

    async saveDeepReport(input: unknown) {
      try {
        const response = await axiosForBackend.post('/api/agent/deep-report', input);
        const data = response.data;
        const url = resolveAppUrl(`/analysis/deep-report/${data.runId}`);
        return { ...data, url };
      } catch (error) {
        logger.error('agent saveDeepReport failed', error);
        throw error;
      }
    },

    async getStrategyRules() {
      try {
        const response = await axiosForBackend.get('/api/agent/strategy-rules');
        return response.data;
      } catch (error) {
        logger.error('agent getStrategyRules failed', error);
        throw error;
      }
    },

    async getLatestDeepReport(ticker: string) {
      try {
        const response = await axiosForBackend.get(
          `/api/agent/deep-report/latest?ticker=${ticker}`,
        );
        const data = response.data;
        if (data && data.runId) {
          const url = resolveAppUrl(`/analysis/deep-report/${data.runId}`);
          return { ...data, url };
        }
        return data;
      } catch (error) {
        logger.error('agent getLatestDeepReport failed', error);
        throw error;
      }
    },

    async listDeepReports() {
      try {
        const response = await axiosForBackend.get('/api/agent/deep-reports');
        const items = Array.isArray(response.data) ? response.data : [];
        return items.map((item: { runId: string }) => ({
          ...item,
          url: resolveAppUrl(`/analysis/deep-report/${item.runId}`),
        }));
      } catch (error) {
        logger.error('agent listDeepReports failed', error);
        throw error;
      }
    },
  };

  const existing = window.__pt ?? {};
  window.__pt = { ...existing, ...api };
  logger.info('Portfolio Terminal agent API initialized');
}
