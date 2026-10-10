import {
  Controller,
  Get,
  Post,
  Body,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';

import { CashAccountsService } from './cash-accounts.service';
import type { CashAccount, ListResponse } from '@shared/api.interface';

@Controller('api/cash')
@NeedLogin()
export class CashAccountsController {
  constructor(private readonly cashAccountsService: CashAccountsService) {}

  @Get()
  async findAll(@Req() req: Request): Promise<ListResponse<CashAccount>> {
    const { userId } = req.userContext;
    const items = await this.cashAccountsService.list(userId);
    return { items };
  }

  @Post('deposit')
  async deposit(
    @Body() body: { currency: string; amount: number; notes?: string },
    @Req() req: Request,
  ): Promise<CashAccount> {
    const { userId } = req.userContext;
    if (!body.currency) throw new BadRequestException('currency 不能为空');
    if (!body.amount || body.amount <= 0) throw new BadRequestException('amount 必须大于 0');
    return this.cashAccountsService.adjust(userId, body.currency, body.amount, body.notes);
  }

  @Post('withdraw')
  async withdraw(
    @Body() body: { currency: string; amount: number; notes?: string },
    @Req() req: Request,
  ): Promise<CashAccount> {
    const { userId } = req.userContext;
    if (!body.currency) throw new BadRequestException('currency 不能为空');
    if (!body.amount || body.amount <= 0) throw new BadRequestException('amount 必须大于 0');
    return this.cashAccountsService.adjust(userId, body.currency, -body.amount, body.notes);
  }
}
