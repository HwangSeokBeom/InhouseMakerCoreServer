import { Module } from '@nestjs/common';

import { PublicThrottleGuard } from '../common/guards/public-throttle.guard';
import { GroupsController } from './groups.controller';
import { PublicGroupsController } from './public-groups.controller';
import { GroupsService } from './groups.service';

@Module({
  controllers: [PublicGroupsController, GroupsController],
  providers: [GroupsService, PublicThrottleGuard],
  exports: [GroupsService],
})
export class GroupModule {}
