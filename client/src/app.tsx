/**
 * @file app.tsx
 * @description Top-level route table for the React SPA.
 * Declares every browser route, wraps all feature pages inside the shared
 * <Layout> shell (navigation chrome + market-status badges), and performs
 * one-time setup of the embedded multi-agent bridge (`initAgentAPI`) on mount.
 *
 * Architecture: this module is imported by index.tsx (the createRoot entry)
 * and only owns routing — page components live under `pages/`, data access
 * under `api/`, and shared layout under `components/Layout.tsx`.
 */
import React, { useEffect } from 'react';
import { Route, Routes } from 'react-router-dom';
import { initAgentAPI } from './utils/agent-api';

import Layout from './components/Layout';
import DashboardPage from './pages/Dashboard/DashboardPage';
import HoldingsPage from './pages/Holdings/HoldingsPage';
import WatchlistPage from './pages/Watchlist/WatchlistPage';
import AnalysisPage from './pages/Analysis/AnalysisPage';
import DeepReportPage from './pages/Analysis/DeepReportPage';
import JournalPage from './pages/Journal/JournalPage';
import TransactionsPage from './pages/Transactions/TransactionsPage';
import StrategyRulesPage from './pages/StrategyRules/StrategyRulesPage';
import DevTasksPage from './pages/Dev/DevTasksPage';
import NotFound from './pages/NotFound/NotFound';

/**
 * Root route component.
 * Mounts the embedded agent API bridge once on first render, then renders the
 * route table. Nested routes share the <Layout> element; an unmatched path
 * (`*`) falls through to the NotFound page.
 *
 * @returns The React element tree for the whole application.
 */
const RoutesComponent = () => {
  // One-time side effect: expose the in-page agent bridge so the host
  // (Lark aPaaS container / embedded runtime) can call into this SPA.
  useEffect(() => {
    initAgentAPI();
  }, []);

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="holdings" element={<HoldingsPage />} />
        <Route path="watchlist" element={<WatchlistPage />} />
        <Route path="analysis" element={<AnalysisPage />} />
        <Route path="analysis/deep-report/:runId" element={<DeepReportPage />} />
        <Route path="journal" element={<JournalPage />} />
        <Route path="transactions" element={<TransactionsPage />} />
        <Route path="settings/rules" element={<StrategyRulesPage />} />
        <Route path="dev" element={<DevTasksPage />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

export default RoutesComponent;
