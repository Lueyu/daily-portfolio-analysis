import { Module } from '@nestjs/common';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';
import { HoldingsModule } from '../holdings/holdings.module';
import { ClosedModule } from '../closed/closed.module';

@Module({
  imports: [HoldingsModule, ClosedModule],
  controllers: [TransactionsController],
  providers: [TransactionsService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
