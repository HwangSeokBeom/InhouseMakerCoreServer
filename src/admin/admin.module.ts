import { Module } from '@nestjs/common';

import { AuditLogService } from '../common/audit-log.service';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  controllers: [AdminController],
  providers: [AdminService, AuditLogService],
  exports: [AdminService],
})
export class AdminModule {}
