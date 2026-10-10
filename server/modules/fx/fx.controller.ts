import {
  Controller,
  Get,
  Post,
  Query,
  NotFoundException,
} from '@nestjs/common';

import { FxService } from './fx.service';
import type { FxRate } from '@shared/api.interface';

interface ListResponse<T> {
  items: T[];
}

@Controller('api/fx')
export class FxController {
  constructor(private readonly fxService: FxService) {}

  @Get('latest')
  async getLatest(
    @Query('base') base: string,
    @Query('quote') quote: string,
  ): Promise<{ rate: string }> {
    const rate = await this.fxService.getLatestRate(base, quote);
    if (rate === null) {
      throw new NotFoundException(`Exchange rate not found for ${base}/${quote}`);
    }
    return { rate };
  }

  @Get('list')
  async getList(@Query('date') date: string): Promise<ListResponse<FxRate>> {
    const items = await this.fxService.getRatesForDate(date);
    return { items };
  }

  @Post('refresh')
  async refresh(): Promise<{ updated: number }> {
    const updated = await this.fxService.refreshRates();
    return { updated };
  }
}
