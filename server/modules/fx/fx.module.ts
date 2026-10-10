import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { FxController } from './fx.controller';
import { FxService } from './fx.service';

@Module({
  imports: [HttpModule],
  controllers: [FxController],
  providers: [FxService],
  exports: [FxService],
})
export class FxModule {}
