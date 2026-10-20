/**
 * @file dev-agent.module.ts
 * @description Wiring for the local Coding-Agent console.
 *
 * The service is built from config read once at startup. The heavy pieces
 * (process runner, artifact reader) are constructed in the factory because
 * they depend on absolute paths derived from the environment, not on other
 * Nest providers.
 */
import { Module } from '@nestjs/common';
import { DevAgentController } from './dev-agent.controller';
import { DevAgentService } from './dev-agent.service';
import { TaskArtifactReader } from './task-artifact.reader';
import { ChildProcessRunner } from './agent-process.runner';
import { loadDevAgentConfig } from './dev-agent.config';

@Module({
  controllers: [DevAgentController],
  providers: [
    {
      provide: DevAgentService,
      useFactory: () => {
        const config = loadDevAgentConfig();
        return new DevAgentService(
          config,
          new TaskArtifactReader(config.tasksDir),
          new ChildProcessRunner(config),
        );
      },
    },
  ],
})
export class DevAgentModule {}
