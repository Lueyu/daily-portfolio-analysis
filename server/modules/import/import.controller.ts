/**
 * @file server/modules/import/import.controller.ts
 * @description Import API: commit mapped rows, OCR extraction, history.
 *
 * CSV parsing and column mapping happen client-side (papaparse); the server
 * only receives normalized rows and applies validation + persistence.
 */
import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { NeedLogin } from '../../common/platform/need-login.decorator';
import { ImportService } from './import.service';
import { OcrService } from './ocr.service';
import type { ImportCommitDto, OcrExtractDto } from '@shared/api.interface';

@Controller('api/import')
export class ImportController {
  constructor(
    private readonly imports: ImportService,
    private readonly ocr: OcrService,
  ) {}

  /** Create holdings from mapped/extracted rows (source-tagged). */
  @NeedLogin()
  @Post('commit')
  async commit(@Req() req: Request, @Body() dto: ImportCommitDto) {
    return this.imports.commit(req.userContext.userId, dto);
  }

  /** Extract holdings rows from a broker screenshot via the user's LLM key. */
  @NeedLogin()
  @Post('ocr/extract')
  async ocrExtract(@Req() req: Request, @Body() dto: OcrExtractDto) {
    return this.ocr.extract(dto);
  }

  /** Recent import history for the caller. */
  @NeedLogin()
  @Get('history')
  async history(@Req() req: Request, @Query('limit') limit?: string) {
    return this.imports.history(req.userContext.userId, limit ? Number(limit) : undefined);
  }
}
