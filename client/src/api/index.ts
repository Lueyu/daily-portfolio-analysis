/** Portfolio HTTP client. Local coding-agent requests live in dev-agent.ts. */
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { logger } from '@lark-apaas/client-toolkit/logger';

/**
 * Fetch the dashboard aggregate overview (totals, allocation, etc.).
 * @param baseCurrency - ISO currency code all amounts are converted into; defaults to USD.
 * @returns The overview payload as returned by the backend.
 */
export async function fetchDashboard(baseCurrency: string = 'USD') {
  const response = await axiosForBackend({
    url: `/api/portfolio/dashboard/overview?baseCurrency=${encodeURIComponent(baseCurrency)}`,
    method: 'GET',
  });
  return response.data;
}

/**
 * Fetch the daily portfolio P/L series used by the Dashboard charts.
 * @param days - Number of trailing trading days to return; defaults to 30.
 * @param baseCurrency - ISO currency code for converted amounts; defaults to USD.
 * @returns The daily P/L series payload.
 */
export async function fetchDailyPl(days: number = 30, baseCurrency: string = 'USD') {
  const response = await axiosForBackend({
    url: `/api/portfolio/dashboard/daily-pl?days=${days}&baseCurrency=${encodeURIComponent(baseCurrency)}`,
    method: 'GET',
  });
  return response.data;
}

/**
 * Fetch all open holdings.
 * @returns The `items` array from the paginated holdings response.
 */
export async function fetchHoldings() {
  const response = await axiosForBackend({
    url: '/api/portfolio/holdings',
    method: 'GET',
  });
  return response.data.items;
}

/**
 * Create a new holding.
 * @param data - Holding fields (ticker, shares, cost basis, currency, etc.).
 * @returns The created holding record.
 */
export async function createHolding(data: unknown) {
  const response = await axiosForBackend({
    url: '/api/portfolio/holdings',
    method: 'POST',
    data,
  });
  return response.data;
}

/**
 * Update an existing holding (partial PATCH).
 * @param id - Holding primary key.
 * @param data - Fields to update.
 * @returns The updated holding record.
 */
export async function updateHolding(id: string, data: unknown) {
  const response = await axiosForBackend({
    url: `/api/portfolio/holdings/${id}`,
    method: 'PATCH',
    data,
  });
  return response.data;
}

/**
 * Delete a holding by id.
 * @param id - Holding primary key.
 */
export async function deleteHolding(id: string) {
  await axiosForBackend({
    url: `/api/portfolio/holdings/${id}`,
    method: 'DELETE',
  });
}

/**
 * Fetch all watchlist items.
 * @returns The `items` array from the paginated watchlist response.
 */
export async function fetchWatchlist() {
  const response = await axiosForBackend({
    url: '/api/portfolio/watchlist',
    method: 'GET',
  });
  return response.data.items;
}

/**
 * Create a new watchlist item.
 * @param data - Watch fields (ticker, notes, target price, etc.).
 * @returns The created watch record.
 */
export async function createWatchItem(data: unknown) {
  const response = await axiosForBackend({
    url: '/api/portfolio/watchlist',
    method: 'POST',
    data,
  });
  return response.data;
}

/**
 * Update an existing watchlist item (partial PATCH).
 * @param id - Watch record primary key.
 * @param data - Fields to update.
 * @returns The updated watch record.
 */
export async function updateWatchItem(id: string, data: unknown) {
  const response = await axiosForBackend({
    url: `/api/portfolio/watchlist/${id}`,
    method: 'PATCH',
    data,
  });
  return response.data;
}

/**
 * Delete a watchlist item by id.
 * @param id - Watch record primary key.
 */
export async function deleteWatchItem(id: string) {
  await axiosForBackend({
    url: `/api/portfolio/watchlist/${id}`,
    method: 'DELETE',
  });
}

/**
 * Fetch all grouping buckets used to organize holdings.
 * @returns The `items` array from the paginated groups response.
 */
export async function fetchGroups() {
  const response = await axiosForBackend({
    url: '/api/portfolio/groups',
    method: 'GET',
  });
  return response.data.items;
}

/**
 * Create a new group.
 * @param data - Group fields (name, color, etc.).
 * @returns The created group record.
 */
export async function createGroup(data: unknown) {
  const response = await axiosForBackend({
    url: '/api/portfolio/groups',
    method: 'POST',
    data,
  });
  return response.data;
}

/**
 * Fetch daily analysis snapshots, optionally filtered to a single date.
 * @param date - Optional `YYYY-MM-DD`; when omitted the latest snapshot is returned.
 * @returns The `items` array of analysis records.
 */
export async function fetchAnalysis(date?: string) {
  const url = date
    ? `/api/portfolio/analysis?date=${date}`
    : '/api/portfolio/analysis';
  const response = await axiosForBackend({ url, method: 'GET' });
  return response.data.items;
}

/**
 * Fetch the list of dates that have an analysis snapshot (used by date pickers).
 * @returns An array of `YYYY-MM-DD` strings, with falsy entries removed.
 */
export async function fetchAnalysisDates() {
  const response = await axiosForBackend({
    url: '/api/portfolio/analysis/dates',
    method: 'GET',
  });
  const items = response.data.items || [];
  return items.map((item: { date: string }) => item.date).filter(Boolean);
}

/**
 * Fetch transaction history with optional filters.
 * @param params - Optional filter object.
 * @param params.ticker - Restrict to a single ticker symbol.
 * @param params.limit - Maximum number of transactions to return.
 * @returns The `items` array of transaction records.
 */
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

/**
 * Create a buy/sell transaction.
 * @param data - Transaction fields (ticker, side, shares, price, date, etc.).
 * @returns The created transaction record.
 */
export async function createTransaction(data: unknown) {
  const response = await axiosForBackend({
    url: '/api/portfolio/transactions',
    method: 'POST',
    data,
  });
  return response.data;
}

/**
 * Create a buy transaction that automatically consumes a matching cash deposit.
 * The backend pairs the buy with an existing deposit to keep cash accounting
 * consistent; use this instead of `createTransaction` for funded purchases.
 * @param data - Buy transaction fields plus deposit linkage hints.
 * @returns The created transaction (and linked deposit) record.
 */
export async function createTransactionWithAutoDeposit(data: unknown) {
  const response = await axiosForBackend({
    url: '/api/portfolio/transactions/auto-deposit-buy',
    method: 'POST',
    data,
  });
  return response.data;
}

/**
 * Re-run reconciliation between transactions, holdings and cash accounts.
 * Corrects drift caused by manual edits; typically triggered by an admin action.
 * @returns The reconciliation result summary.
 */
export async function reconcileTransactions() {
  const response = await axiosForBackend({
    url: '/api/portfolio/transactions/reconcile',
    method: 'POST',
  });
  return response.data;
}

/**
 * Fetch the realized P&L summary aggregated across all closed positions.
 * @returns The summary payload (total realized gain/loss, win rate, etc.).
 */
export async function fetchRealizedPlSummary() {
  const response = await axiosForBackend({
    url: '/api/portfolio/closed/summary',
    method: 'GET',
  });
  return response.data;
}

/**
 * Manually create a closed position (e.g. imported from a broker statement).
 * @param data - Closed-position fields (ticker, buy/sell dates, realized P/L, etc.).
 * @returns The created closed-position record.
 */
export async function createClosed(data: unknown) {
  const response = await axiosForBackend({
    url: '/api/portfolio/closed',
    method: 'POST',
    data,
  });
  return response.data;
}

/**
 * Fetch journal entries, optionally filtered to a single date.
 * @param date - Optional `YYYY-MM-DD`; when omitted the latest entries are returned.
 * @returns The `items` array of journal records.
 */
export async function fetchJournal(date?: string) {
  const url = date
    ? `/api/portfolio/journal?date=${date}`
    : '/api/portfolio/journal';
  const response = await axiosForBackend({ url, method: 'GET' });
  return response.data.items;
}

/**
 * Fetch historical portfolio snapshots used by long-range equity curves.
 * @param limit - Optional maximum number of snapshots to return (newest first).
 * @returns The `items` array of snapshot records.
 */
export async function fetchSnapshots(limit?: number) {
  const url = limit
    ? `/api/portfolio/snapshots?limit=${limit}`
    : '/api/portfolio/snapshots';
  const response = await axiosForBackend({ url, method: 'GET' });
  return response.data.items;
}

/**
 * Fetch cash accounts and their balances.
 * @returns The `items` array of cash-account records.
 */
export async function fetchCashAccounts() {
  const response = await axiosForBackend({
    url: '/api/cash',
    method: 'GET',
  });
  return response.data.items;
}

/**
 * List multi-agent research runs with optional filters and pagination.
 * @param params - Optional filter object.
 * @param params.ticker - Restrict to a single ticker.
 * @param params.status - Filter by run status (queued/running/done/failed).
 * @param params.runMode - Filter by run mode (e.g. quick/deep).
 * @param params.from - ISO start date for the run window.
 * @param params.to - ISO end date for the run window.
 * @param params.limit - Page size.
 * @param params.offset - Page offset.
 * @returns The paginated runs response.
 */
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

/**
 * Fetch a single multi-agent run by id (including its staged outputs).
 * @param id - Run primary key.
 * @returns The run record.
 */
export async function getAgentRun(id: string) {
  const response = await axiosForBackend({
    url: `/api/multi-agent/runs/${id}`,
    method: 'GET',
  });
  return response.data;
}

/**
 * Submit a human reviewer's decision on a pending run.
 * @param id - Run primary key.
 * @param data - Decision payload.
 * @param data.decision - The chosen decision (e.g. approve/reject/modify).
 * @param data.note - Optional reviewer note.
 * @param data.modifiedRating - Optional override rating object.
 * @param data.applyToHoldings - Whether to apply the decision to current holdings.
 * @param data.syncToAnalysis - Whether to sync the decision into the analysis snapshot.
 * @returns The updated run record.
 */
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

/**
 * Fetch the latest published rating for one or more tickers.
 * @param tickers - Optional ticker list; when omitted the backend returns all latest ratings.
 * @returns A map/list of latest ratings.
 */
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

/**
 * Fetch all strategy rules.
 * Normalizes two possible response shapes (bare array or `{ items }`) into an array.
 * @returns The list of strategy-rule records.
 */
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

/**
 * Create a new strategy rule.
 * @param data - Rule fields (name, conditions, action, sort order, etc.).
 * @returns The created rule record.
 */
export async function createStrategyRule(data: Record<string, unknown>) {
  const response = await axiosForBackend({
    url: '/api/multi-agent/strategy-rules',
    method: 'POST',
    data,
  });
  return response.data;
}

/**
 * Update an existing strategy rule (partial PATCH).
 * @param id - Rule primary key.
 * @param data - Fields to update.
 * @returns The updated rule record.
 */
export async function updateStrategyRule(id: string, data: Record<string, unknown>) {
  const response = await axiosForBackend({
    url: `/api/multi-agent/strategy-rules/${id}`,
    method: 'PATCH',
    data,
  });
  return response.data;
}

/**
 * Delete a strategy rule by id.
 * @param id - Rule primary key.
 * @returns The delete result.
 */
export async function deleteStrategyRule(id: string) {
  const response = await axiosForBackend({
    url: `/api/multi-agent/strategy-rules/${id}`,
    method: 'DELETE',
  });
  return response.data;
}

/**
 * Persist a new ordering of strategy rules after drag-and-drop.
 * @param items - Array of `{ id, sort }` pairs reflecting the desired order.
 * @returns The reorder result.
 */
export async function reorderStrategyRules(items: Array<{ id: string; sort: number }>) {
  const response = await axiosForBackend({
    url: '/api/multi-agent/strategy-rules/reorder',
    method: 'POST',
    data: { items },
  });
  return response.data;
}

/**
 * Reset strategy rules back to the system default set.
 * Destructive: overrides any user-customized rules.
 * @returns The reset result.
 */
export async function resetStrategyRules() {
  const response = await axiosForBackend({
    url: '/api/multi-agent/strategy-rules/reset-default',
    method: 'POST',
  });
  return response.data;
}

/**
 * Fetch the versioned deep-research report generated for a completed run.
 * The DeepReportPage renders this structured, versioned LLM output.
 * @param runId - Run primary key.
 * @returns The deep-report payload.
 */
export async function getDeepReport(runId: string) {
  const response = await axiosForBackend({
    url: `/api/multi-agent/deep-report/${runId}`,
    method: 'GET',
  });
  return response.data;
}

/**
 * Search stocks by ticker or name (autocomplete source).
 * @param q - Free-text query; empty/whitespace returns no results immediately.
 * @returns The `items` array of matching instruments, or `[]` on an empty query.
 */
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

export { logger };
export * from './dev-agent';
