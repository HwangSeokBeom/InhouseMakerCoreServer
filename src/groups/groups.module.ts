import { Module } from '@nestjs/common';

import { AuditLogService } from '../common/audit-log.service';
import { PublicThrottleGuard } from '../common/guards/public-throttle.guard';
import { UserModule } from '../users/users.module';
import { GroupsController } from './groups.controller';
import { PublicGroupsController } from './public-groups.controller';
import { GroupsService } from './groups.service';

@Module({
  imports: [UserModule],
  controllers: [PublicGroupsController, GroupsController],
  providers: [GroupsService, AuditLogService, PublicThrottleGuard],
  exports: [GroupsService],
})
export class GroupModule {}
