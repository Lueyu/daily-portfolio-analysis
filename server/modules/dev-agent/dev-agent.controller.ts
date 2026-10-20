/**
 * @file dev-agent.controller.ts
 * @description HTTP surface for the local Coding-Agent console.
 *
 * Thin adapter over DevAgentService: all routes are under `/api/dev`, require
 * a logged-in session, and the only mutating commands are the whitelisted
 * agent subcommands. The feature is gated server-side; when disabled the data
 * endpoints return 503 while `/health` still reports the state.
 */
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { DevAgentService } from './dev-agent.service';
import { CreateDevTaskDto, RejectDevTaskDto } from './dev-agent.types';

@Controller('api/dev')
@NeedLogin()
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class DevAgentController {
  constructor(private readonly dev: DevAgentService) {}

  @Get('health')
  health() {
    return this.dev.health();
  }

  @Get('tasks')
  listTasks() {
    return this.dev.listTasks();
  }

  @Post('tasks')
  createTask(@Body() dto: CreateDevTaskDto) {
    return this.dev.createTask({
      title: dto.title,
      problem: dto.problem,
      acceptance: dto.acceptance.map((a) => ({
        id: a.id,
        kind: a.check,
        description: a.description,
        target: a.target ?? null,
      })),
      workdir: dto.workdir ?? null,
    });
  }

  @Get('tasks/:id')
  getTask(@Param('id') id: string) {
    return this.dev.getTask(id);
  }

  @Get('tasks/:id/iterations')
  getIterations(@Param('id') id: string) {
    return this.dev.getIterations(id);
  }

  @Get('tasks/:id/patches/:patchId')
  getPatch(@Param('id') id: string, @Param('patchId') patchId: string) {
    return this.dev.getPatch(id, patchId);
  }

  @Post('tasks/:id/run')
  runTask(@Param('id') id: string) {
    return this.dev.startRun(id);
  }

  @Post('tasks/:id/approve')
  approveTask(@Param('id') id: string) {
    return this.dev.approve(id);
  }

  @Post('tasks/:id/reject')
  rejectTask(@Param('id') id: string, @Body() dto: RejectDevTaskDto) {
    return this.dev.reject(id, dto.reason);
  }
}
