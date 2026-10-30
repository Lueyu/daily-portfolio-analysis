/**
 * Dashboard module.
 *
 * Wires the dashboard feature: imports `FxModule` (via `forwardRef`) and
 * `QuoteModule`, exposes `DashboardController`, and provides `DashboardService`.
 */
import { Module, forwardRef } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { FxModule } from '../fx/fx.module';
import { QuoteModule } from '../quote/quote.module';
import { MarketOverviewService } from './market-overview.service';

/** NestJS module definition for the dashboard feature. */
@Module({
  imports: [forwardRef(() => FxModule), QuoteModule],
  controllers: [DashboardController],
  providers: [DashboardService, MarketOverviewService],
})
export class DashboardModule {}
