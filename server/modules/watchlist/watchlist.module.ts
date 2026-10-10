/**
 * Watchlist module.
 *
 * Wires the watchlist feature: imports `QuoteModule` (for ticker market
 * detection), exposes `WatchlistController`, and provides `WatchlistService`.
 */
import { Module } from '@nestjs/common';
import { WatchlistController } from './watchlist.controller';
import { WatchlistService } from './watchlist.service';
import { QuoteModule } from './../quote/quote.module';

/** NestJS module definition for the watchlist feature. */
@Module({
  imports: [QuoteModule],
  controllers: [WatchlistController],
  providers: [WatchlistService],
})
export class WatchlistModule {}
