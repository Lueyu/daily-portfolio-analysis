/**
 * Agent gateway module.
 *
 * Wires the service-to-service API for the Python agent. It imports
 * `HoldingsModule` to reuse the existing owner-scoped `HoldingsService`, exposes
 * `AgentGatewayController` (mounted on `/openapi/agent-gateway`), and provides
 * the `AgentGatewayGuard` that validates the shared `x-agent-token`.
 */
import { Module } from '@nestjs/common';

import { AgentGatewayController } from './agent-gateway.controller';
import { AgentGatewayGuard } from '../../common/guards/agent-gateway.guard';
import { HoldingsModule } from '../holdings/holdings.module';

/** NestJS module for the service-to-service agent gateway. */
@Module({
  imports: [HoldingsModule],
  controllers: [AgentGatewayController],
  providers: [AgentGatewayGuard],
})
export class AgentGatewayModule {}
