import { HttpStatus, Injectable } from '@nestjs/common';
import { UserStatus } from '@prisma/client';

import { AppErrorCode, AppException } from '../common/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { BlockListResponseDto, BlockUserResponseDto } from './dto/blocks.dto';

@Injectable()
export class BlocksService {
  constructor(private readonly prismaService: PrismaService) {}

  async blockUser(
    requesterUserId: string,
    targetUserId: string,
  ): Promise<BlockUserResponseDto> {
    if (requesterUserId === targetUserId) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        AppErrorCode.BLOCK_SELF_NOT_ALLOWED,
        'You cannot block yourself.',
        {
          targetUserId,
        },
      );
    }

    await this.ensureActiveUser(targetUserId);

    const block = await this.prismaService.userBlock.upsert({
      where: {
        userId_targetUserId: {
          userId: requesterUserId,
          targetUserId,
        },
      },
      create: {
        userId: requesterUserId,
        targetUserId,
      },
      update: {},
    });

    return {
      targetUserId,
      blocked: true,
      createdAt: block.createdAt.toISOString(),
    };
  }

  async unblockUser(
    requesterUserId: string,
    targetUserId: string,
  ): Promise<BlockUserResponseDto> {
    if (requesterUserId === targetUserId) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        AppErrorCode.BLOCK_SELF_NOT_ALLOWED,
        'You cannot unblock yourself.',
        {
          targetUserId,
        },
      );
    }

    await this.prismaService.userBlock.deleteMany({
      where: {
        userId: requesterUserId,
        targetUserId,
      },
    });

    return {
      targetUserId,
      blocked: false,
      createdAt: null,
    };
  }

  async listMyBlocks(requesterUserId: string): Promise<BlockListResponseDto> {
    const blocks = await this.prismaService.userBlock.findMany({
      where: {
        userId: requesterUserId,
      },
      include: {
        targetUser: {
          select: {
            id: true,
            nickname: true,
            profileImageUrl: true,
            status: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return {
      items: blocks.map((block) => ({
        id: block.targetUser.id,
        userId: block.targetUser.id,
        nickname: block.targetUser.nickname,
        profileImageUrl: block.targetUser.profileImageUrl,
        status: block.targetUser.status,
        blockedAt: block.createdAt.toISOString(),
      })),
    };
  }

  private async ensureActiveUser(targetUserId: string): Promise<void> {
    const user = await this.prismaService.user.findFirst({
      where: {
        id: targetUserId,
        status: UserStatus.ACTIVE,
      },
      select: {
        id: true,
      },
    });

    if (!user) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        AppErrorCode.BLOCK_TARGET_NOT_FOUND,
        'Target user not found.',
        {
          targetUserId,
        },
      );
    }
  }
}
