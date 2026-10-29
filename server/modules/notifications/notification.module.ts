/**
 * @file server/modules/notifications/notification.module.ts
 * @description Notification wiring: exports NotificationService so the
 * paper-trading engine (and future features) can fan out events.
 */
import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';

@Module({
  imports: [HttpModule],
  controllers: [NotificationController],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
