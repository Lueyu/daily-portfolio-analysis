/**
 * Journal module.
 *
 * Wires the trading-journal feature: exposes `JournalController` and provides
 * `JournalService`.
 */
import { Module } from '@nestjs/common';
import { JournalController } from './journal.controller';
import { JournalService } from './journal.service';

/** NestJS module definition for the trading-journal feature. */
@Module({
  controllers: [JournalController],
  providers: [JournalService],
})
export class JournalModule {}
