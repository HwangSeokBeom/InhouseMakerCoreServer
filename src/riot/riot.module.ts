import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';

import { AuditLogService } from '../common/audit-log.service';
import { RiotController } from './riot.controller';
import { RiotApiClient } from './riot-api.client';
import { RiotProcessor } from './riot.processor';
import { RiotService } from './riot.service';

@Module({
  imports: [HttpModule],
  controllers: [RiotController],
  providers: [RiotApiClient, RiotService, RiotProcessor, AuditLogService],
  exports: [RiotApiClient, RiotService],
})
export class RiotModule {}
