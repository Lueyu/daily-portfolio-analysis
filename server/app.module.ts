/**
 * Root (application) module.
 *
 * Wires together the entire NestJS backend: it imports the shared platform
 * module and every feature module (holdings, watchlist, groups, analysis,
 * transactions, closed positions, journal, snapshots, alpha picks, dashboard,
 * LLM agent, cash accounts, quotes, FX, and multi-agent pipeline), and registers
 * `GlobalExceptionFilter` as the application-wide exception handler via
 * `APP_FILTER`. `ViewModule` must remain the last import because it provides the
 * SPA fallback routes.
 */
import { APP_FILTER } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { PlatformModule } from '@lark-apaas/fullstack-nestjs-core';

import { GlobalExceptionFilter } from './common/filters/exception.filter';
import { ViewModule } from './modules/view/view.module';
import { HoldingsModule } from './modules/holdings/holdings.module';
import { WatchlistModule } from './modules/watchlist/watchlist.module';
import { GroupsModule } from './modules/groups/groups.module';
import { AnalysisModule } from './modules/analysis/analysis.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
import { ClosedModule } from './modules/closed/closed.module';
import { JournalModule } from './modules/journal/journal.module';
import { SnapshotsModule } from './modules/snapshots/snapshots.module';
import { AlphaPicksModule } from './modules/alpha-picks/alpha-picks.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { AgentModule } from './modules/agent/agent.module';
import { CashAccountsModule } from './modules/cash-accounts/cash-accounts.module';
import { QuoteModule } from './modules/quote/quote.module';
import { FxModule } from './modules/fx/fx.module';
import { MultiAgentModule } from './modules/multi-agent/multi-agent.module';

/**
 * Root NestJS module. Aggregates all feature modules and installs the global
 * exception filter. Has no logic of its own; it exists purely for DI wiring.
 */
@Module({
  imports: [
    // Local dev opt-out for the service-to-service Python agent: set
    // DISABLE_CSRF=true to skip the browser double-token CSRF guard, because the
    // agent is not a browser and will authenticate with x-agent-token through
    // the agent gateway (added on Day 3). When unset (production) CSRF stays
    // enabled, so default behavior is unchanged.
    PlatformModule.forRoot({
      enableCsrf: process.env.DISABLE_CSRF !== 'true',
    }),
    // ====== @route-section: business-modules START ======
    HoldingsModule,
    WatchlistModule,
    GroupsModule,
    AnalysisModule,
    TransactionsModule,
    ClosedModule,
    JournalModule,
    SnapshotsModule,
    AlphaPicksModule,
    DashboardModule,
    AgentModule,
    CashAccountsModule,
    QuoteModule,
    FxModule,
    MultiAgentModule,
    // ====== @route-section: business-modules END ======

    // ⚠️ @route-order: last
    // ViewModule is the fallback route module, must be registered last.
    ViewModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
  ],
})
export class AppModule {}
