import { Controller, Get, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { NeedLogin } from '../../common/platform';
import { SystemUpdateService } from './system-update.service';

@NeedLogin()
@Controller('api/system/update')
export class SystemUpdateController {
  constructor(private readonly updates: SystemUpdateService) {}

  @Get()
  status(@Req() request: Request) {
    return this.updates.status(request.userContext.userId);
  }

  @Post()
  start(@Req() request: Request) {
    return this.updates.start(request.userContext.userId);
  }
}
