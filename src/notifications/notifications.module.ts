import { Module } from '@nestjs/common';

import { NoopNotificationDeliveryProvider } from './notification-delivery.provider';
import { NotificationProcessor } from './notification.processor';
import { NotificationService } from './notification.service';
import { NotificationsController } from './notifications.controller';

@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationService,
    NotificationProcessor,
    NoopNotificationDeliveryProvider,
  ],
  exports: [NotificationService],
})
export class NotificationModule {}
