import { Injectable, NotFoundException } from '@nestjs/common';
import { NotificationStatus, NotificationType } from '@prisma/client';

import { QueueService } from '../queue/queue.service';
import { PrismaService } from '../prisma/prisma.service';
import { toPrismaJson } from '../common/prisma-json.util';
import {
  NotificationListResponseDto,
  NotificationQueryDto,
  NotificationReadAllResponseDto,
  NotificationReadResponseDto,
} from './dto/notification.dto';
import { NoopNotificationDeliveryProvider } from './notification-delivery.provider';

interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  payload?: unknown;
  relatedEntityType?: string;
  relatedEntityId?: string;
}

@Injectable()
export class NotificationService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly queueService: QueueService,
    private readonly notificationDeliveryProvider: NoopNotificationDeliveryProvider,
  ) {}

  async createMany(inputs: CreateNotificationInput[]): Promise<void> {
    if (inputs.length === 0) {
      return;
    }

    for (const input of inputs) {
      const notification = await this.prismaService.notification.create({
        data: {
          userId: input.userId,
          type: input.type,
          title: input.title,
          body: input.body,
          payloadJson: input.payload === undefined ? undefined : toPrismaJson(input.payload),
          relatedEntityType: input.relatedEntityType,
          relatedEntityId: input.relatedEntityId,
        },
      });

      await this.queueService.enqueueNotification(notification.id);
    }
  }

  async listForUser(
    userId: string,
    query: NotificationQueryDto,
  ): Promise<NotificationListResponseDto> {
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;

    const where = {
      userId,
      ...(query.type ? { type: query.type } : {}),
      ...(query.isRead === undefined
        ? {}
        : query.isRead
          ? { readAt: { not: null as Date | null } }
          : { readAt: null }),
    };

    const [items, unreadCount, totalCount] = await Promise.all([
      this.prismaService.notification.findMany({
        where,
        orderBy: [{ readAt: 'desc' }, { createdAt: 'desc' }],
        skip: offset,
        take: limit,
      }),
      this.prismaService.notification.count({
        where: {
          userId,
          readAt: null,
        },
      }),
      this.prismaService.notification.count({ where }),
    ]);

    const nextOffset = offset + items.length < totalCount ? offset + items.length : null;

    return {
      items: items.map((item) => ({
        id: item.id,
        type: item.type,
        title: item.title,
        body: item.body,
        status: item.status,
        isRead: Boolean(item.readAt),
        payload: (item.payloadJson as Record<string, unknown> | null) ?? null,
        relatedEntityType: item.relatedEntityType,
        relatedEntityId: item.relatedEntityId,
        readAt: item.readAt?.toISOString() ?? null,
        sentAt: item.sentAt?.toISOString() ?? null,
        createdAt: item.createdAt.toISOString(),
      })),
      unreadCount,
      pagination: {
        limit,
        offset,
        hasMore: nextOffset !== null,
        nextOffset,
      },
    };
  }

  async markRead(
    userId: string,
    notificationId: string,
  ): Promise<NotificationReadResponseDto> {
    const notification = await this.prismaService.notification.findFirst({
      where: {
        id: notificationId,
        userId,
      },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found.');
    }

    const readAt = notification.readAt ?? new Date();
    const updated = await this.prismaService.notification.update({
      where: { id: notificationId },
      data: {
        readAt,
        status: NotificationStatus.READ,
      },
    });

    return {
      id: updated.id,
      isRead: true,
      readAt: updated.readAt?.toISOString() ?? null,
    };
  }

  async markAllRead(userId: string): Promise<NotificationReadAllResponseDto> {
    const result = await this.prismaService.notification.updateMany({
      where: {
        userId,
        readAt: null,
      },
      data: {
        readAt: new Date(),
        status: NotificationStatus.READ,
      },
    });

    return {
      updatedCount: result.count,
    };
  }

  async dispatch(notificationId: string): Promise<void> {
    const notification = await this.prismaService.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found.');
    }

    if (
      notification.status === NotificationStatus.SENT ||
      notification.status === NotificationStatus.READ
    ) {
      return;
    }

    await this.notificationDeliveryProvider.deliver({
      id: notification.id,
      userId: notification.userId,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      payload: notification.payloadJson,
    });

    await this.markSent(notificationId);
  }

  async markSent(notificationId: string): Promise<void> {
    const notification = await this.prismaService.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found.');
    }

    await this.prismaService.notification.update({
      where: { id: notificationId },
      data: {
        status: notification.readAt ? NotificationStatus.READ : NotificationStatus.SENT,
        sentAt: notification.sentAt ?? new Date(),
      },
    });
  }
}
