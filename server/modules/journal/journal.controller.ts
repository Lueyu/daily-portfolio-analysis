import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  Req,
} from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';
import { JournalService } from './journal.service';
import type {
  JournalEntry,
  CreateJournalDto,
  ListResponse,
} from '@shared/api.interface';

@NeedLogin()
@Controller('api/portfolio/journal')
export class JournalController {
  constructor(private readonly journalService: JournalService) {}

  @Get()
  async list(
    @Req() req: Request,
    @Query('date') date?: string,
  ): Promise<ListResponse<JournalEntry>> {
    const { userId } = req.userContext;
    return this.journalService.list(userId, date);
  }

  @Get('latest')
  async latest(@Req() req: Request): Promise<JournalEntry | null> {
    const { userId } = req.userContext;
    return this.journalService.latest(userId);
  }

  @Post()
  async upsert(
    @Req() req: Request,
    @Body() dto: CreateJournalDto,
  ): Promise<JournalEntry> {
    const { userId } = req.userContext;
    return this.journalService.upsert(userId, dto);
  }

  @Delete(':id')
  async remove(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    const { userId } = req.userContext;
    return this.journalService.remove(userId, id);
  }
}
