/**
 * @file dev-agent.module.ts
 * @description Wiring for the local Coding-Agent console.
 *
 * The config is read once from the environment and provided via a token; the
 * reader and runner are injectables that depend on it, and the service ties
 * them together. The whole module is dev-only and is imported before the SPA
 * fallback ViewModule.
 */
import { Module } from '@nestjs/common';
import { DevAgentController } from './dev-agent.controller';
import { DevSettingsController } from './dev-settings.controller';
import { DevAgentService } from './dev-agent.service';
import { TaskArtifactReader } from './task-artifact.reader';
import {
  AGENT_PROCESS_RUNNER,
  ChildProcessRunner,
} from './agent-process.runner';
import { DEV_AGENT_CONFIG, loadDevAgentConfig } from './dev-agent.config';

@Module({
  controllers: [DevAgentController, DevSettingsController],
  providers: [
    {
      provide: DEV_AGENT_CONFIG,
      useFactory: () => loadDevAgentConfig(),
    },
    TaskArtifactReader,
    ChildProcessRunner,
    { provide: AGENT_PROCESS_RUNNER, useExisting: ChildProcessRunner },
    DevAgentService,
  ],
})
export class DevAgentModule {}
