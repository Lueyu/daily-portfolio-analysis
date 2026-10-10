/**
 * Alpha-picks module.
 *
 * Wires the alpha-picks feature: exposes `AlphaPicksController` and provides
 * `AlphaPicksService`.
 */
import { Module } from '@nestjs/common';
import { AlphaPicksController } from './alpha-picks.controller';
import { AlphaPicksService } from './alpha-picks.service';

/** NestJS module definition for the alpha-picks feature. */
@Module({
  controllers: [AlphaPicksController],
  providers: [AlphaPicksService],
})
export class AlphaPicksModule {}
