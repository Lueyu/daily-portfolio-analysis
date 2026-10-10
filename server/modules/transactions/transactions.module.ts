/**
 * Transactions module.
 *
 * Wires the bookkeeping feature: imports `HoldingsModule` and `ClosedModule`
 * (derived-state modules), exposes `TransactionsController`, and provides/exports
 * `TransactionsService` so reconciliation logic can be reused elsewhere.
 */
import { Module } from '@nestjs/common';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';
import { HoldingsModule } from '../holdings/holdings.module';
import { ClosedModule } from '../closed/closed.module';

/** NestJS module definition for the transactions/bookkeeping feature. */
@Module({
  imports: [HoldingsModule, ClosedModule],
  controllers: [TransactionsController],
  providers: [TransactionsService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
