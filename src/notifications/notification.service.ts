import { Injectable, NotFoundException } from '@nestjs/common';
import { NotificationStatus, NotificationType } from '@prisma/client';

import { QueueService } from '../queue/queue.service';
import { PrismaService } from '../prisma/prisma.service';
import { toPrismaJson } from '../common/prisma-json.util';

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
  ) {}

  async createMany(inputs: CreateNotificationInput[]): Promise<void> {
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
        status: NotificationStatus.SENT,
        sentAt: new Date(),
      },
    });
  }
}
