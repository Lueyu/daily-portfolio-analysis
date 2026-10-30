import { Controller, Get, NotFoundException, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { NeedLogin } from '../../common/platform/need-login.decorator';
import { LocalAgentsService } from './local-agents.service';
import { LocalAgentError } from './local-agents.types';

@NeedLogin()
@Controller('api/settings/local-agents')
export class LocalAgentsController {
  constructor(private readonly agents: LocalAgentsService) {}
  @Get()
  async list(@Req() request: Request) { return { items: await this.agents.list(request.userContext.userId) }; }
  @Post(':id/test')
  async test(@Req() request: Request, @Param('id') id: string) {
    try { return await this.agents.test(request.userContext.userId, id); }
    catch (error) {
      if (error instanceof LocalAgentError && error.code === 'A2A_AGENT_NOT_FOUND') {
        throw new NotFoundException('Local agent not found');
      }
      const code = error instanceof LocalAgentError ? error.code : 'A2A_UNAVAILABLE';
      return { ok: false, code, message: code };
    }
  }
}
