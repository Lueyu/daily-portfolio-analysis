/**
 * Analysis module.
 *
 * Wires the stock-research-note feature: exposes `AnalysisController` and provides
 * `AnalysisService`.
 */
import { Module } from '@nestjs/common';
import { AnalysisController } from './analysis.controller';
import { AnalysisService } from './analysis.service';

/** NestJS module definition for the analysis-notes feature. */
@Module({
  controllers: [AnalysisController],
  providers: [AnalysisService],
})
export class AnalysisModule {}
