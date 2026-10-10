import { Controller, Get, Post, Patch, Delete, Body, Param, Query, Req } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';
import { TransactionsService } from './transactions.service';
import type { Transaction, CreateTransactionDto, ReconcileResult } from '@shared/api.interface';

@NeedLogin()
@Controller('api/portfolio/transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Get()
  async list(
    @Req() req: Request,
    @Query('ticker') ticker?: string,
    @Query('limit') limit?: string,
  ): Promise<{ items: Transaction[] }> {
    const { userId } = req.userContext;
    const limitNum = limit ? Math.min(parseInt(limit, 10), 500) : 100;
    const items = await this.transactionsService.list(userId, ticker, limitNum);
    return { items };
  }

  @Get(':id')
  async getById(@Req() req: Request, @Param('id') id: string): Promise<Transaction> {
    const { userId } = req.userContext;
    return this.transactionsService.getById(userId, id);
  }

  @Post()
  async create(@Req() req: Request, @Body() dto: CreateTransactionDto): Promise<Transaction> {
    const { userId } = req.userContext;
    return this.transactionsService.create(userId, dto);
  }

  @Patch(':id')
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: Partial<CreateTransactionDto>,
  ): Promise<Transaction> {
    const { userId } = req.userContext;
    return this.transactionsService.update(userId, id, dto);
  }

  @Delete(':id')
  async remove(@Req() req: Request, @Param('id') id: string): Promise<void> {
    const { userId } = req.userContext;
    return this.transactionsService.remove(userId, id);
  }

  @Post('reconcile')
  async reconcile(@Req() req: Request): Promise<ReconcileResult> {
    const { userId } = req.userContext;
    return this.transactionsService.reconcileAll(userId);
  }

  @Post('auto-deposit-buy')
  async createWithAutoDeposit(
    @Req() req: Request,
    @Body() dto: CreateTransactionDto,
  ): Promise<Transaction> {
    const { userId } = req.userContext;
    return this.transactionsService.createWithAutoDeposit(userId, dto);
  }
}
