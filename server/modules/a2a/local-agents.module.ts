import { Module } from '@nestjs/common';
import { LocalAgentsController } from './local-agents.controller';
import { LocalAgentsService } from './local-agents.service';

@Module({ controllers: [LocalAgentsController], providers: [LocalAgentsService], exports: [LocalAgentsService] })
export class LocalAgentsModule {}
