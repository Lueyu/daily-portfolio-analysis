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

@Module({
  imports: [
    PlatformModule.forRoot(),
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
