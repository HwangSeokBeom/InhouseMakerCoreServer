import { Module } from '@nestjs/common';

import { AuditLogService } from '../common/audit-log.service';
import { PublicThrottleGuard } from '../common/guards/public-throttle.guard';
import { GroupModule } from '../groups/groups.module';
import { NotificationModule } from '../notifications/notifications.module';
import { PublicRecruitingController } from './public-recruiting.controller';
import { RecruitingController } from './recruiting.controller';
import { RecruitingService } from './recruiting.service';

@Module({
  imports: [GroupModule, NotificationModule],
  controllers: [PublicRecruitingController, RecruitingController],
  providers: [RecruitingService, AuditLogService, PublicThrottleGuard],
})
export class RecruitingModule {}
