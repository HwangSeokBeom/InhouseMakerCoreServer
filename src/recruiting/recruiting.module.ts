import { Module } from '@nestjs/common';

import { GroupModule } from '../groups/groups.module';
import { RecruitingController } from './recruiting.controller';
import { RecruitingService } from './recruiting.service';

@Module({
  imports: [GroupModule],
  controllers: [RecruitingController],
  providers: [RecruitingService],
})
export class RecruitingModule {}
