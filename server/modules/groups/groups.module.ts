/**
 * Groups module.
 *
 * Wires the portfolio-groups feature: exposes `GroupsController` and provides
 * `GroupsService`.
 */
import { Module } from '@nestjs/common';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';

/** NestJS module definition for the groups feature. */
@Module({
  controllers: [GroupsController],
  providers: [GroupsService],
})
export class GroupsModule {}
