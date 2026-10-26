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
  Header,
  Param,
  Post,
  Query,
  StreamableFile,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { DevAgentService } from './dev-agent.service';
import {
  CreateDevTaskDto, RejectDevTaskDto, UndoDevChangeDto, RestoreDevCheckpointDto,
  DevAgentMessageDto, DevAgentExternalDecisionDto,
} from './dev-agent.types';

@Controller('api/dev')
@NeedLogin()
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidUnknownValues: true,
  }),
)
export class DevAgentController {
  constructor(private readonly dev: DevAgentService) {}

  @Get('health')
  health() {
    return this.dev.health();
  }

  @Get('capabilities')
  capabilities() {
    return this.dev.capabilities();
  }

  @Post('tasks/:id/messages')
  message(@Param('id') id: string, @Body() dto: DevAgentMessageDto) {
    return this.dev.sendMessage(id, dto.text);
  }

  @Post('tasks/:id/approvals/:requestId')
  decideExternal(@Param('id') id: string, @Param('requestId') requestId: string,
                 @Body() dto: DevAgentExternalDecisionDto) {
    return this.dev.decideExternal(id, requestId, dto.approve);
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

  @Get('tasks/:id/runtime')
  getRuntime(@Param('id') id: string, @Query('cursor') cursor?: string) {
    return this.dev.getRuntime(id, cursor === undefined ? 0 : Number(cursor));
  }

  @Get('tasks/:id/artifacts/:artifactId')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async getArtifact(@Param('id') id: string, @Param('artifactId') artifactId: string) {
    return new StreamableFile(await this.dev.getArtifact(id, artifactId), { type: 'image/png' });
  }

  @Post('tasks/:id/changes/undo')
  undoChange(@Param('id') id: string, @Body() dto: UndoDevChangeDto) {
    return this.dev.undoChange(id, dto);
  }

  @Post('tasks/:id/checkpoints/restore')
  restoreCheckpoint(@Param('id') id: string, @Body() dto: RestoreDevCheckpointDto) {
    return this.dev.restoreCheckpoint(id, dto);
  }

  @Post('tasks/:id/run')
  runTask(@Param('id') id: string) {
    return this.dev.startRun(id);
  }

  @Post('tasks/:id/approve')
  approveTask(@Param('id') id: string) {
    return this.dev.approve(id);
  }

  @Post('tasks/:id/stop')
  stopTask(@Param('id') id: string) {
    return this.dev.stop(id);
  }

  @Post('tasks/:id/reject')
  rejectTask(@Param('id') id: string, @Body() dto: RejectDevTaskDto) {
    return this.dev.reject(id, dto.reason);
  }
}
