/**
 * Quote module.
 *
 * Wires market-data features: imports the Axios `HttpModule` for upstream quote
 * calls, exposes `QuoteController`, and provides/exports `QuoteService` so other
 * feature modules (holdings, watchlist) can reuse ticker market detection.
 */
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { QuoteController } from './quote.controller';
import { QuoteService } from './quote.service';

/** NestJS module definition for the quote/market-data feature. */
@Module({
  imports: [HttpModule],
  controllers: [QuoteController],
  providers: [QuoteService],
  exports: [QuoteService],
})
export class QuoteModule {}
