import { Module } from '@nestjs/common';

import { AuditLogService } from '../common/audit-log.service';
import { GroupModule } from '../groups/groups.module';
import { MatchesController } from './matches.controller';
import { MatchesService } from './matches.service';

@Module({
  imports: [GroupModule],
  controllers: [MatchesController],
  providers: [MatchesService, AuditLogService],
  exports: [MatchesService],
})
export class MatchModule {}
