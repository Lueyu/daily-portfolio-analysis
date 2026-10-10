import { Module } from '@nestjs/common';
import { MultiAgentController } from './multi-agent.controller';
import { MultiAgentService } from './multi-agent.service';
import { LlmService } from './llm.service';
import { EvidenceService } from './evidence.service';
import { PipelineService } from './pipeline.service';
import { PortfolioContextService } from './portfolio-context.service';
import { BatchService } from './batch.service';
import { QuoteModule } from '@server/modules/quote/quote.module';

@Module({
  imports: [QuoteModule],
  controllers: [MultiAgentController],
  providers: [
    MultiAgentService,
    LlmService,
    EvidenceService,
    PipelineService,
    PortfolioContextService,
    BatchService,
  ],
})
export class MultiAgentModule {}
