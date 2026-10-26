/** Operator settings: local-only requests, secrets travel through stdin. */
import type { Request } from 'express';
import {
  BadRequestException, Body, Controller, ForbiddenException, Get, Inject, Post,
  Put, Req, ServiceUnavailableException, UsePipes, ValidationPipe,
} from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import type { DevAgentSettingsInput } from '@shared/api.interface';
import { AGENT_PROCESS_RUNNER, type AgentProcessRunner } from './agent-process.runner';
import { DEV_AGENT_CONFIG, type DevAgentConfig } from './dev-agent.config';

export function assertLocalSettingsRequest(request: Pick<Request, 'socket' | 'headers'>): void {
  const isLocal = (host: string): boolean => ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host.toLowerCase());
  const remote: string = (request.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
  if (!isLocal(remote)) throw new ForbiddenException('设置仅允许从本机访问');
  try {
    if (!isLocal(new URL(`http://${request.headers.host ?? ''}`).hostname)) throw new Error();
    if (request.headers.origin && !isLocal(new URL(request.headers.origin).hostname)) throw new Error();
    if (request.headers['sec-fetch-site'] === 'cross-site') throw new Error();
  } catch { throw new ForbiddenException('拒绝跨站配置请求'); }
}

class SettingsInputDto implements DevAgentSettingsInput {
  @IsOptional() @IsObject()
  models?: DevAgentSettingsInput['models'];

  @IsOptional() @IsObject()
  mcp?: DevAgentSettingsInput['mcp'];
}

class SettingsTestDto {
  @IsString() @IsIn(['primary', 'vision', 'mcp'])
  target!: 'primary' | 'vision' | 'mcp';

  @IsOptional() @IsString() @MaxLength(64)
  server?: string;
}

@Controller('api/dev/settings')
@NeedLogin()
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true }))
export class DevSettingsController {
  constructor(
    @Inject(DEV_AGENT_CONFIG) private readonly config: DevAgentConfig,
    @Inject(AGENT_PROCESS_RUNNER) private readonly runner: AgentProcessRunner,
  ) {}

  private check(request: Request): void {
    if (!this.config.enabled) throw new ServiceUnavailableException('本地 Coding Agent 未启用');
    assertLocalSettingsRequest(request);
  }

  private async command(args: string[], input?: DevAgentSettingsInput): Promise<Record<string, unknown>> {
    const stdin: string | undefined = input === undefined ? undefined : JSON.stringify(input);
    if (stdin && Buffer.byteLength(stdin) > 262144) throw new BadRequestException('配置请求超过 256 KB');
    const result = await this.runner.exec(args, { stdin, timeoutMs: args[0] === 'settings-test' ? 90000 : 30000 });
    let payload: Record<string, unknown>;
    try {
      if (result.returnCode !== 0) throw new Error();
      payload = JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '') as Record<string, unknown>;
    } catch { throw new BadRequestException('设置命令执行失败，请检查 Agent 配置与运行环境'); }
    if (payload.ok === false && args[0] !== 'settings-test') {
      throw new BadRequestException(typeof payload.message === 'string' ? payload.message : '配置不合法');
    }
    return payload;
  }

  @Get()
  read(@Req() request: Request) {
    this.check(request);
    return this.command(['settings']);
  }

  @Put()
  save(@Req() request: Request, @Body() input: SettingsInputDto) {
    this.check(request);
    return this.command(['settings-save'], input);
  }

  @Post('test')
  test(@Req() request: Request, @Body() input: SettingsTestDto) {
    this.check(request);
    return this.command(['settings-test', '--target', input.target,
      ...(input.server ? ['--server', input.server] : [])]);
  }
}
