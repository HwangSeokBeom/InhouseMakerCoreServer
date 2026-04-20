import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

export interface BlockVisibility {
  isBlockedByMe: boolean;
  isBlockedUser: boolean;
  canInteract: boolean;
  visible: boolean;
}

@Injectable()
export class BlockVisibilityPolicy {
  constructor(private readonly prismaService?: PrismaService) {}

  buildVisibleUserWhere(viewerUserId: string): Prisma.UserWhereInput {
    return {
      AND: [
        {
          blockedByUsers: {
            none: {
              userId: viewerUserId,
            },
          },
        },
        {
          blockedUsers: {
            none: {
              targetUserId: viewerUserId,
            },
          },
        },
      ],
    };
  }

  buildVisibleAuthorWhere(viewerUserId: string): Prisma.UserWhereInput {
    return this.buildVisibleUserWhere(viewerUserId);
  }

  async resolveVisibility(
    viewerUserId: string,
    targetUserId: string,
  ): Promise<BlockVisibility> {
    if (viewerUserId === targetUserId) {
      return {
        isBlockedByMe: false,
        isBlockedUser: false,
        canInteract: true,
        visible: true,
      };
    }

    if (!this.prismaService) {
      return {
        isBlockedByMe: false,
        isBlockedUser: false,
        canInteract: true,
        visible: true,
      };
    }

    const [blockedByMe, blockedUser] = await Promise.all([
      this.prismaService.userBlock.findUnique({
        where: {
          userId_targetUserId: {
            userId: viewerUserId,
            targetUserId,
          },
        },
        select: { id: true },
      }),
      this.prismaService.userBlock.findUnique({
        where: {
          userId_targetUserId: {
            userId: targetUserId,
            targetUserId: viewerUserId,
          },
        },
        select: { id: true },
      }),
    ]);
    const isBlockedByMe = Boolean(blockedByMe);
    const isBlockedUser = Boolean(blockedUser);
    const canInteract = !isBlockedByMe && !isBlockedUser;

    return {
      isBlockedByMe,
      isBlockedUser,
      canInteract,
      visible: canInteract,
    };
  }
}
