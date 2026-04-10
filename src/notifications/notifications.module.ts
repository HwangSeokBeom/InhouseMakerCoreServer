import { Module } from '@nestjs/common';

import { NotificationProcessor } from './notification.processor';
import { NotificationService } from './notification.service';

@Module({
  providers: [NotificationService, NotificationProcessor],
  exports: [NotificationService],
})
export class NotificationModule {}
