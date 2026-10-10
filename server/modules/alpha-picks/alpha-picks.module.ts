import { Module } from '@nestjs/common';
import { AlphaPicksController } from './alpha-picks.controller';
import { AlphaPicksService } from './alpha-picks.service';

@Module({
  controllers: [AlphaPicksController],
  providers: [AlphaPicksService],
})
export class AlphaPicksModule {}
