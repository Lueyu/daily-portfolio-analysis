/**
 * Holdings module.
 *
 * Wires the holdings feature: imports `QuoteModule` (needed for ticker market
 * detection), exposes `HoldingsController`, and provides/exports
 * `HoldingsService` so other feature modules can reuse holdings logic.
 */
import { Module } from '@nestjs/common';
import { HoldingsController } from './holdings.controller';
import { HoldingsService } from './holdings.service';
import { QuoteModule } from './../quote/quote.module';

/** NestJS module definition for the holdings feature. */
@Module({
  imports: [QuoteModule],
  controllers: [HoldingsController],
  providers: [HoldingsService],
  exports: [HoldingsService],
})
export class HoldingsModule {}
