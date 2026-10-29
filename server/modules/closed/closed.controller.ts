/**
 * Closed positions controller.
 *
 * Exposes endpoints for realized (closed-out) positions under
 * `/api/portfolio/closed`. Requires login on every route (`@NeedLogin()` at the
 * class level). Includes a summary endpoint that aggregates realized P&L by ticker
 * and currency.
 */
import { Controller, Get, Post, Patch, Delete, Body, Param, Req } from '@nestjs/common';
import { NeedLogin } from '../../common/platform';
import type { Request } from 'express';
import { ClosedService } from './closed.service';
import type { ClosedPosition, CreateClosedDto, RealizedPlSummary } from '@shared/api.interface';

/**
 * REST controller for closed positions. Delegates to `ClosedService`.
 */
@NeedLogin()
@Controller('api/portfolio/closed')
export class ClosedController {
  constructor(private readonly closedService: ClosedService) {}

  /**
   * Returns an aggregated realized P&L summary (by currency and per ticker).
   *
   * @param req Authenticated request carrying `req.userContext.userId`.
   */
  @Get('summary')
  async getSummary(@Req() req: Request): Promise<RealizedPlSummary> {
    const { userId } = req.userContext;
    return this.closedService.getRealizedSummary(userId);
  }

  /**
   * Lists all closed positions for the user, most recently closed first.
   *
   * @param req Authenticated request.
   */
  @Get()
  async list(@Req() req: Request): Promise<{ items: ClosedPosition[] }> {
    const { userId } = req.userContext;
    const items = await this.closedService.list(userId);
    return { items };
  }

  /**
   * Manually creates a closed-position record.
   *
   * @param req Authenticated request.
   * @param dto Create payload.
   */
  @Post()
  async create(@Req() req: Request, @Body() dto: CreateClosedDto): Promise<ClosedPosition> {
    const { userId } = req.userContext;
    return this.closedService.create(userId, dto);
  }

  /**
   * Partially updates an owned closed position.
   *
   * @param req Authenticated request.
   * @param id  Closed-position primary key.
   * @param dto Partial update payload.
   */
  @Patch(':id')
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: Partial<CreateClosedDto>,
  ): Promise<ClosedPosition> {
    const { userId } = req.userContext;
    return this.closedService.update(userId, id, dto);
  }

  /**
   * Deletes an owned closed position.
   *
   * @param req Authenticated request.
   * @param id  Closed-position primary key.
   */
  @Delete(':id')
  async remove(@Req() req: Request, @Param('id') id: string): Promise<void> {
    const { userId } = req.userContext;
    return this.closedService.remove(userId, id);
  }
}
