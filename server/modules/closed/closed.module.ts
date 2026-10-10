/**
 * Closed positions module.
 *
 * Wires the realized-P&L feature: exposes `ClosedController` and provides/exports
 * `ClosedService` so reconciliation (in transactions) can reuse it.
 */
import { Module } from '@nestjs/common';
import { ClosedController } from './closed.controller';
import { ClosedService } from './closed.service';

/** NestJS module definition for the closed-positions feature. */
@Module({
  controllers: [ClosedController],
  providers: [ClosedService],
  exports: [ClosedService],
})
export class ClosedModule {}
