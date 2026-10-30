import { Global, Module } from '@nestjs/common';
import { LlmService } from '../multi-agent/llm.service';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { QuoteModule } from '../quote/quote.module';
import { ModelConnectionsService } from './model-connections.service';
import { ModelConnectionsController } from './model-connections.controller';

@Global()
@Module({
  imports: [QuoteModule],
  controllers: [SettingsController, ModelConnectionsController],
  providers: [SettingsService, LlmService, ModelConnectionsService],
  exports: [SettingsService],
})
export class SettingsModule {}
