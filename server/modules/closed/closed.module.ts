import { Module } from '@nestjs/common';
import { ClosedController } from './closed.controller';
import { ClosedService } from './closed.service';

@Module({
  controllers: [ClosedController],
  providers: [ClosedService],
  exports: [ClosedService],
})
export class ClosedModule {}
