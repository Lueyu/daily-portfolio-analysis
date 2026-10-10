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
import NotFound from './pages/NotFound/NotFound';

const RoutesComponent = () => {
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
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

export default RoutesComponent;
