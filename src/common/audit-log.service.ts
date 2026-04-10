import { Injectable } from '@nestjs/common';

import { toPrismaJson } from './prisma-json.util';
import { PrismaService } from '../prisma/prisma.service';

interface CreateAuditLogInput {
  userId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  meta?: unknown;
}

@Injectable()
export class AuditLogService {
  constructor(private readonly prismaService: PrismaService) {}

  create(input: CreateAuditLogInput): Promise<unknown> {
    return this.prismaService.auditLog.create({
      data: {
        userId: input.userId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        beforeJson: input.before === undefined ? undefined : toPrismaJson(input.before),
        afterJson: input.after === undefined ? undefined : toPrismaJson(input.after),
        metaJson: input.meta === undefined ? undefined : toPrismaJson(input.meta),
      },
    });
  }
}
