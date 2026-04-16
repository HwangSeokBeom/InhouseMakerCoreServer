import { ForbiddenException } from '@nestjs/common';

import { AdminService } from '../src/admin/admin.service';

describe('AdminService', () => {
  const prismaService = {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    auditLog: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    inhouseMatchResult: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    recruitingPost: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  } as any;
  const auditLogService = {
    create: jest.fn(),
  } as any;

  let service: AdminService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AdminService(prismaService, auditLogService);
  });

  it('rejects admin endpoints for non-admin users', async () => {
    prismaService.user.findUnique.mockResolvedValue({ isAdmin: false });

    await expect(service.listUsers('u1', {})).rejects.toBeInstanceOf(ForbiddenException);
  });
});
