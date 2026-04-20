import {
  ReportReason,
  ReportStatus,
  ReportTargetType,
  UserStatus,
} from '@prisma/client';

import { ReportsService } from '../src/reports/reports.service';

describe('ReportsService', () => {
  const prismaService = {
    user: {
      findFirst: jest.fn(),
    },
    recruitingPost: {
      findFirst: jest.fn(),
    },
    report: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
  } as any;

  let service: ReportsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ReportsService(prismaService);
  });

  it('creates a user report for an existing active target user', async () => {
    const now = new Date('2026-04-20T01:00:00.000Z');
    prismaService.user.findFirst.mockResolvedValue({ id: 'target-user' });
    prismaService.report.findFirst.mockResolvedValue(null);
    prismaService.report.create.mockResolvedValue({
      id: 'report-1',
      reporterUserId: 'reporter-user',
      targetType: ReportTargetType.USER,
      targetId: 'target-user',
      reason: ReportReason.HARASSMENT,
      detail: 'abusive chat',
      status: ReportStatus.PENDING,
      createdAt: now,
      updatedAt: now,
    });

    const response = await service.createReport('reporter-user', {
      targetType: ReportTargetType.USER,
      targetId: 'target-user',
      reason: ReportReason.HARASSMENT,
      detail: 'abusive chat',
    });

    expect(prismaService.user.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'target-user',
        status: UserStatus.ACTIVE,
      },
      select: { id: true },
    });
    expect(prismaService.report.create).toHaveBeenCalledWith({
      data: {
        reporterUserId: 'reporter-user',
        targetType: ReportTargetType.USER,
        targetId: 'target-user',
        reason: ReportReason.HARASSMENT,
        detail: 'abusive chat',
        status: ReportStatus.PENDING,
      },
    });
    expect(response).toMatchObject({
      id: 'report-1',
      status: ReportStatus.PENDING,
      createdAt: now.toISOString(),
    });
  });

  it('rejects reporting yourself', async () => {
    await expect(
      service.createReport('same-user', {
        targetType: ReportTargetType.USER,
        targetId: 'same-user',
        reason: ReportReason.OTHER,
        detail: 'self',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'REPORT_SELF_NOT_ALLOWED',
      }),
    });
  });

  it('creates a recruiting post report when the post exists', async () => {
    const now = new Date('2026-04-20T02:00:00.000Z');
    prismaService.recruitingPost.findFirst.mockResolvedValue({ id: 'post-1' });
    prismaService.report.findFirst.mockResolvedValue(null);
    prismaService.report.create.mockResolvedValue({
      id: 'report-2',
      reporterUserId: 'reporter-user',
      targetType: ReportTargetType.RECRUITMENT,
      targetId: 'post-1',
      reason: ReportReason.SPAM,
      detail: null,
      status: ReportStatus.PENDING,
      createdAt: now,
      updatedAt: now,
    });

    await expect(
      service.createReport('reporter-user', {
        targetType: ReportTargetType.RECRUITMENT,
        targetId: 'post-1',
        reason: ReportReason.SPAM,
      }),
    ).resolves.toMatchObject({
      id: 'report-2',
      targetType: ReportTargetType.RECRUITMENT,
    });
  });

  it('rejects duplicate reports within the recent abuse window', async () => {
    prismaService.user.findFirst.mockResolvedValue({ id: 'target-user' });
    prismaService.report.findFirst.mockResolvedValue({
      id: 'recent-report',
      createdAt: new Date('2026-04-20T01:00:00.000Z'),
    });

    await expect(
      service.createReport('reporter-user', {
        targetType: ReportTargetType.USER,
        targetId: 'target-user',
        reason: ReportReason.SPAM,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'REPORT_RECENT_DUPLICATE',
      }),
    });
  });
});
