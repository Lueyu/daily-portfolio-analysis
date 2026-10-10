/**
 * Agent module.
 *
 * Wires the LLM-agent feature: imports `SnapshotsModule` (so the agent can
 * upsert/list snapshots), exposes `AgentController`, and provides `AgentService`.
 */
import { Module } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { SnapshotsModule } from '../snapshots/snapshots.module';

/** NestJS module definition for the agent feature. */
@Module({
  imports: [SnapshotsModule],
  controllers: [AgentController],
  providers: [AgentService],
})
export class AgentModule {}
