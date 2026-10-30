import { Body, Controller, Delete, Get, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { NeedLogin } from '../../common/platform';
import type {
  IntegrationSettings,
  IntegrationTestResult,
  UpdateFinancialIntegrationRequest,
  UpdateLlmIntegrationRequest,
} from '@shared/api.interface';
import { LlmService } from '../multi-agent/llm.service';
import { SettingsService } from './settings.service';

@NeedLogin()
@Controller('api/settings/integrations')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly llm: LlmService,
  ) {}

  @Get()
  get(@Req() req: Request): Promise<IntegrationSettings> {
    return this.settings.getSettings(req.userContext.userId);
  }

  @Put('llm')
  saveLlm(
    @Req() req: Request,
    @Body() body: UpdateLlmIntegrationRequest,
  ): Promise<IntegrationSettings> {
    return this.settings.saveLlm(req.userContext.userId, body);
  }

  @Delete('llm')
  clearLlm(@Req() req: Request): Promise<IntegrationSettings> {
    return this.settings.clearLlm(req.userContext.userId);
  }

  @Post('llm/test')
  async testLlm(@Req() req: Request): Promise<IntegrationTestResult> {
    try {
      const response = await this.llm.chatFast(
        [{ role: 'user', content: 'Reply with OK only.' }],
        req.userContext.userId,
      );
      return response.content.trim()
        ? { ok: true, message: 'The model returned a response.' }
        : { ok: false, message: 'The model returned an empty response.' };
    } catch {
      return {
        ok: false,
        message: 'Could not reach the model. Check the API URL, key, model and server network.',
      };
    }
  }

  @Put('financial')
  saveFinancial(
    @Req() req: Request,
    @Body() body: UpdateFinancialIntegrationRequest,
  ): Promise<IntegrationSettings> {
    return this.settings.saveFinancial(req.userContext.userId, body);
  }

  @Delete('financial')
  clearFinancial(@Req() req: Request): Promise<IntegrationSettings> {
    return this.settings.clearFinancial(req.userContext.userId);
  }

  @Post('financial/test')
  testFinancial(@Req() req: Request): Promise<IntegrationTestResult> {
    return this.settings.testFinancial(req.userContext.userId);
  }
}
