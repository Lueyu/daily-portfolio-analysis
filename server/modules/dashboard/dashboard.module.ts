import { Module, forwardRef } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { FxModule } from '../fx/fx.module';
import { QuoteModule } from '../quote/quote.module';

@Module({
  imports: [forwardRef(() => FxModule), QuoteModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
