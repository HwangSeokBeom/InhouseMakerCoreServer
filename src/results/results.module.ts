import { Module } from '@nestjs/common';

import { MatchModule } from '../matches/matches.module';
import { NotificationModule } from '../notifications/notifications.module';
import { AuditLogService } from '../common/audit-log.service';
import { ResultConfirmationPolicyService } from './result-confirmation-policy.service';
import { ResultsController } from './results.controller';
import { ResultsProcessor } from './results.processor';
import { ResultsService } from './results.service';

@Module({
  imports: [MatchModule, NotificationModule],
  controllers: [ResultsController],
  providers: [
    ResultsService,
    ResultsProcessor,
    AuditLogService,
    ResultConfirmationPolicyService,
  ],
  exports: [ResultsService, ResultConfirmationPolicyService],
})
export class ResultModule {}
