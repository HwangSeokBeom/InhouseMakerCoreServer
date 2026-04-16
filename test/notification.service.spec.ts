import { NotificationStatus, NotificationType } from '@prisma/client';

import { NotificationService } from '../src/notifications/notification.service';

describe('NotificationService', () => {
  const prismaService = {
    notification: {
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
    },
  } as any;
  const queueService = {
    enqueueNotification: jest.fn(),
  } as any;
  const deliveryProvider = {
    deliver: jest.fn(),
  } as any;

  let service: NotificationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new NotificationService(prismaService, queueService, deliveryProvider);
  });

  it('marks a single notification as read idempotently', async () => {
    prismaService.notification.findFirst.mockResolvedValue({
      id: 'n1',
      userId: 'u1',
      readAt: null,
    });
    prismaService.notification.update.mockImplementation(async ({ data }: any) => ({
      id: 'n1',
      readAt: data.readAt,
    }));

    const result = await service.markRead('u1', 'n1');

    expect(result.id).toBe('n1');
    expect(result.isRead).toBe(true);
    expect(prismaService.notification.update).toHaveBeenCalled();
  });

  it('marks all unread notifications as read', async () => {
    prismaService.notification.updateMany.mockResolvedValue({ count: 3 });

    await expect(service.markAllRead('u1')).resolves.toEqual({ updatedCount: 3 });
    expect(prismaService.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'u1', readAt: null },
      }),
    );
  });

  it('lists notifications with unread count and pagination', async () => {
    prismaService.notification.findMany.mockResolvedValue([
      {
        id: 'n1',
        userId: 'u1',
        type: NotificationType.RESULT_CONFIRMED,
        title: 'Done',
        body: 'Result confirmed',
        status: NotificationStatus.SENT,
        payloadJson: { matchId: 'm1' },
        relatedEntityType: 'match_result',
        relatedEntityId: 'r1',
        sentAt: new Date('2026-04-12T10:00:00Z'),
        readAt: null,
        createdAt: new Date('2026-04-12T10:00:00Z'),
      },
    ]);
    prismaService.notification.count
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);

    const result = await service.listForUser('u1', { limit: 1, offset: 0 });

    expect(result.unreadCount).toBe(2);
    expect(result.pagination.hasMore).toBe(false);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        id: 'n1',
        isRead: false,
      }),
    );
  });
});
