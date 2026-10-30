import { Global, Module } from '@nestjs/common';
import { LlmService } from '../multi-agent/llm.service';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

@Global()
@Module({
  controllers: [SettingsController],
  providers: [SettingsService, LlmService],
  exports: [SettingsService],
})
export class SettingsModule {}
