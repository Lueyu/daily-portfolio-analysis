import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { logger } from '@lark-apaas/client-toolkit/logger';

export async function fetchDashboard(baseCurrency: string = 'USD') {
  const response = await axiosForBackend({
    url: `/api/portfolio/dashboard/overview?baseCurrency=${encodeURIComponent(baseCurrency)}`,
    method: 'GET',
  });
  return response.data;
}

export async function fetchDailyPl(days: number = 30, baseCurrency: string = 'USD') {
  const response = await axiosForBackend({
    url: `/api/portfolio/dashboard/daily-pl?days=${days}&baseCurrency=${encodeURIComponent(baseCurrency)}`,
    method: 'GET',
  });
  return response.data;
}

export async function fetchHoldings() {
  const response = await axiosForBackend({
    url: '/api/portfolio/holdings',
    method: 'GET',
  });
  return response.data.items;
}

export async function createHolding(data: unknown) {
  const response = await axiosForBackend({
    url: '/api/portfolio/holdings',
    method: 'POST',
    data,
  });
  return response.data;
}

export async function updateHolding(id: string, data: unknown) {
  const response = await axiosForBackend({
    url: `/api/portfolio/holdings/${id}`,
    method: 'PATCH',
    data,
  });
  return response.data;
}

export async function deleteHolding(id: string) {
  await axiosForBackend({
    url: `/api/portfolio/holdings/${id}`,
    method: 'DELETE',
  });
}

export async function fetchWatchlist() {
  const response = await axiosForBackend({
    url: '/api/portfolio/watchlist',
    method: 'GET',
  });
  return response.data.items;
}

export async function createWatchItem(data: unknown) {
  const response = await axiosForBackend({
    url: '/api/portfolio/watchlist',
    method: 'POST',
    data,
  });
  return response.data;
}

export async function updateWatchItem(id: string, data: unknown) {
  const response = await axiosForBackend({
    url: `/api/portfolio/watchlist/${id}`,
    method: 'PATCH',
    data,
  });
  return response.data;
}

export async function deleteWatchItem(id: string) {
  await axiosForBackend({
    url: `/api/portfolio/watchlist/${id}`,
    method: 'DELETE',
  });
}

export async function fetchGroups() {
  const response = await axiosForBackend({
    url: '/api/portfolio/groups',
    method: 'GET',
  });
  return response.data.items;
}

export async function createGroup(data: unknown) {
  const response = await axiosForBackend({
    url: '/api/portfolio/groups',
    method: 'POST',
    data,
  });
  return response.data;
}

export async function updateGroup(id: string, data: unknown) {
  const response = await axiosForBackend({
    url: `/api/portfolio/groups/${id}`,
    method: 'PATCH',
    data,
  });
  return response.data;
}

export async function deleteGroup(id: string) {
  await axiosForBackend({
    url: `/api/portfolio/groups/${id}`,
    method: 'DELETE',
  });
}

export async function fetchAnalysis(date?: string) {
  const url = date
    ? `/api/portfolio/analysis?date=${date}`
    : '/api/portfolio/analysis';
  const response = await axiosForBackend({ url, method: 'GET' });
  return response.data.items;
}

export async function fetchAnalysisDates() {
  const response = await axiosForBackend({
    url: '/api/portfolio/analysis/dates',
    method: 'GET',
  });
  const items = response.data.items || [];
  return items.map((item: { date: string }) => item.date).filter(Boolean);
}

export async function fetchTransactions(params?: { ticker?: string; limit?: number }) {
  const query = new URLSearchParams();
  if (params?.ticker) query.set('ticker', params.ticker);
  if (params?.limit) query.set('limit', String(params.limit));
  const qs = query.toString();
  const response = await axiosForBackend({
    url: `/api/portfolio/transactions${qs ? `?${qs}` : ''}`,
    method: 'GET',
  });
  return response.data.items;
}

export async function createTransaction(data: unknown) {
  const response = await axiosForBackend({
    url: '/api/portfolio/transactions',
    method: 'POST',
    data,
  });
  return response.data;
}

export async function createTransactionWithAutoDeposit(data: unknown) {
  const response = await axiosForBackend({
    url: '/api/portfolio/transactions/auto-deposit-buy',
    method: 'POST',
    data,
  });
  return response.data;
}

export async function reconcileTransactions() {
  const response = await axiosForBackend({
    url: '/api/portfolio/transactions/reconcile',
    method: 'POST',
  });
  return response.data;
}

export async function fetchClosed() {
  const response = await axiosForBackend({
    url: '/api/portfolio/closed',
    method: 'GET',
  });
  return response.data.items;
}

export async function fetchRealizedPlSummary() {
  const response = await axiosForBackend({
    url: '/api/portfolio/closed/summary',
    method: 'GET',
  });
  return response.data;
}

export async function createClosed(data: unknown) {
  const response = await axiosForBackend({
    url: '/api/portfolio/closed',
    method: 'POST',
    data,
  });
  return response.data;
}

export async function fetchJournal(date?: string) {
  const url = date
    ? `/api/portfolio/journal?date=${date}`
    : '/api/portfolio/journal';
  const response = await axiosForBackend({ url, method: 'GET' });
  return response.data.items;
}

export async function fetchSnapshots(limit?: number) {
  const url = limit
    ? `/api/portfolio/snapshots?limit=${limit}`
    : '/api/portfolio/snapshots';
  const response = await axiosForBackend({ url, method: 'GET' });
  return response.data.items;
}

export async function fetchAlphaPicks() {
  const response = await axiosForBackend({
    url: '/api/portfolio/alpha-picks',
    method: 'GET',
  });
  return response.data.items;
}

export async function fetchCashAccounts() {
  const response = await axiosForBackend({
    url: '/api/cash',
    method: 'GET',
  });
  return response.data.items;
}

export async function batchUpdatePrices(items: { ticker: string; price: number }[]) {
  const response = await axiosForBackend({
    url: '/api/portfolio/holdings/prices',
    method: 'PATCH',
    data: { items },
  });
  return response.data;
}

export async function batchUpdateWatchPrices(items: { ticker: string; price: number }[]) {
  const response = await axiosForBackend({
    url: '/api/portfolio/watchlist/prices',
    method: 'PATCH',
    data: { items },
  });
  return response.data;
}

export async function fetchAgentState() {
  const response = await axiosForBackend({
    url: '/api/agent/state',
    method: 'GET',
  });
  return response.data;
}

export async function fetchAgentHistory() {
  const response = await axiosForBackend({
    url: '/api/agent/history',
    method: 'GET',
  });
  return response.data;
}

export async function getAgentRuns(params?: {
  ticker?: string;
  status?: string;
  runMode?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}) {
  const query = new URLSearchParams();
  if (params?.ticker) query.set('ticker', params.ticker);
  if (params?.status) query.set('status', params.status);
  if (params?.runMode) query.set('runMode', params.runMode);
  if (params?.from) query.set('from', params.from);
  if (params?.to) query.set('to', params.to);
  if (params?.limit !== undefined) query.set('limit', String(params.limit));
  if (params?.offset !== undefined) query.set('offset', String(params.offset));
  const qs = query.toString();
  const response = await axiosForBackend({
    url: `/api/multi-agent/runs${qs ? `?${qs}` : ''}`,
    method: 'GET',
  });
  return response.data;
}

export async function getAgentRun(id: string) {
  const response = await axiosForBackend({
    url: `/api/multi-agent/runs/${id}`,
    method: 'GET',
  });
  return response.data;
}

export async function createAgentRun(data: {
  ticker: string;
  tickerName?: string;
  market?: string;
  triggerType: string;
  runMode?: string;
}) {
  const response = await axiosForBackend({
    url: '/api/multi-agent/runs',
    method: 'POST',
    data,
  });
  return response.data;
}

export async function startAgentRun(id: string) {
  const response = await axiosForBackend({
    url: `/api/multi-agent/runs/${id}/start`,
    method: 'POST',
  });
  return response.data;
}

export async function getAgentRunStatus(id: string) {
  const response = await axiosForBackend({
    url: `/api/multi-agent/runs/${id}/status`,
    method: 'GET',
  });
  return response.data;
}

export async function submitHumanDecision(
  id: string,
  data: {
    decision: string;
    note?: string;
    modifiedRating?: Record<string, unknown>;
    applyToHoldings?: boolean;
    syncToAnalysis?: boolean;
  },
) {
  const response = await axiosForBackend({
    url: `/api/multi-agent/runs/${id}/human-decision`,
    method: 'POST',
    data,
  });
  return response.data;
}

export async function batchAgentRuns(data: {
  scope: string;
  tiered: boolean;
  tickers?: string[];
}) {
  const response = await axiosForBackend({
    url: '/api/multi-agent/runs/batch',
    method: 'POST',
    data,
  });
  return response.data;
}

export async function dailyBatchAgentRuns() {
  const response = await axiosForBackend({
    url: '/api/multi-agent/daily-batch',
    method: 'POST',
  });
  return response.data;
}

export async function getLatestRatings(tickers?: string[]) {
  const query = new URLSearchParams();
  if (tickers && tickers.length > 0) query.set('tickers', tickers.join(','));
  const qs = query.toString();
  const response = await axiosForBackend({
    url: `/api/multi-agent/latest-ratings${qs ? `?${qs}` : ''}`,
    method: 'GET',
  });
  return response.data;
}

export async function getStrategyRules() {
  const response = await axiosForBackend({
    url: '/api/multi-agent/strategy-rules',
    method: 'GET',
  });
  const data = response.data;
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  return [];
}

export async function createStrategyRule(data: Record<string, unknown>) {
  const response = await axiosForBackend({
    url: '/api/multi-agent/strategy-rules',
    method: 'POST',
    data,
  });
  return response.data;
}

export async function updateStrategyRule(id: string, data: Record<string, unknown>) {
  const response = await axiosForBackend({
    url: `/api/multi-agent/strategy-rules/${id}`,
    method: 'PATCH',
    data,
  });
  return response.data;
}

export async function deleteStrategyRule(id: string) {
  const response = await axiosForBackend({
    url: `/api/multi-agent/strategy-rules/${id}`,
    method: 'DELETE',
  });
  return response.data;
}

export async function reorderStrategyRules(items: Array<{ id: string; sort: number }>) {
  const response = await axiosForBackend({
    url: '/api/multi-agent/strategy-rules/reorder',
    method: 'POST',
    data: { items },
  });
  return response.data;
}

export async function resetStrategyRules() {
  const response = await axiosForBackend({
    url: '/api/multi-agent/strategy-rules/reset-default',
    method: 'POST',
  });
  return response.data;
}

export async function getDeepReport(runId: string) {
  const response = await axiosForBackend({
    url: `/api/multi-agent/deep-report/${runId}`,
    method: 'GET',
  });
  return response.data;
}

export async function generateSampleDeepReport(runId: string) {
  const response = await axiosForBackend({
    url: `/api/multi-agent/runs/${runId}/generate-sample-deep-report`,
    method: 'POST',
  });
  return response.data;
}

export async function searchStocks(q: string) {
  if (!q || !q.trim()) return [];
  const response = await axiosForBackend({
    url: `/api/quote/search?q=${encodeURIComponent(q.trim())}`,
    method: 'GET',
  });
  const data = response.data;
  if (data && Array.isArray(data.items)) return data.items;
  return [];
}

export async function getPortfolioContext() {
  const response = await axiosForBackend({
    url: '/api/multi-agent/portfolio-context',
    method: 'GET',
  });
  return response.data;
}

export { logger };
