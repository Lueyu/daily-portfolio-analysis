/**
 * FX module.
 *
 * Wires the exchange-rate feature: imports the Axios `HttpModule`, exposes
 * `FxController`, and provides/exports `FxService` (used for multi-currency
 * conversions across the portfolio).
 */
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { FxController } from './fx.controller';
import { FxService } from './fx.service';

/** NestJS module definition for the FX/rates feature. */
@Module({
  imports: [HttpModule],
  controllers: [FxController],
  providers: [FxService],
  exports: [FxService],
})
export class FxModule {}
