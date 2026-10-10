import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';

import { QuoteService } from './quote.service';
import type { QuoteResponse, StockSearchResult } from '@shared/api.interface';

@Controller('api/quote')
export class QuoteController {
  constructor(private readonly quoteService: QuoteService) {}

  @Get('batch')
  async getBatchQuotes(
    @Query('symbols') symbols: string,
  ): Promise<{ items: QuoteResponse[] }> {
    if (!symbols || typeof symbols !== 'string') {
      throw new BadRequestException('symbols query parameter is required');
    }
    const symbolList = symbols.split(',').map((s: string) => s.trim()).filter(Boolean);
    if (symbolList.length === 0) {
      throw new BadRequestException('symbols query parameter cannot be empty');
    }
    const items = await this.quoteService.getBatchQuotes(symbolList);
    return { items };
  }

  @Get('search')
  @NeedLogin()
  async search(
    @Query('q') q: string,
    @Req() req: Request,
  ): Promise<{ items: StockSearchResult[] }> {
    if (!q || typeof q !== 'string' || q.trim().length === 0) {
      return { items: [] };
    }
    const { userId } = req.userContext;
    const items = await this.quoteService.searchStocks(q.trim(), userId);
    return { items };
  }

  @Get()
  async getQuote(
    @Query('symbol') symbol: string,
  ): Promise<QuoteResponse> {
    const result = await this.quoteService.getQuote(symbol);
    if (!result) {
      throw new NotFoundException(`Quote not found for symbol: ${symbol}`);
    }
    return result;
  }

  @Post('refresh')
  @NeedLogin()
  async refresh(@Req() req: Request): Promise<{ refreshed: number }> {
    const { userId } = req.userContext;
    const refreshed = await this.quoteService.batchRefreshPrices(userId);
    return { refreshed };
  }
}
