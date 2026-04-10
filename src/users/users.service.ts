import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MatchStatus, ResultStatus } from '@prisma/client';

import { AuthenticatedUser } from '../common/interfaces/authenticated-request.interface';
import { PrismaService } from '../prisma/prisma.service';
import {
  InhouseHistoryQueryDto,
  InhouseHistoryResponseDto,
  MeResponseDto,
  UpdateMyProfileDto,
} from './dto/profile.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prismaService: PrismaService) {}

  async getMe(userId: string): Promise<MeResponseDto> {
    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    return {
      id: user.id,
      email: user.email,
      nickname: user.nickname,
      primaryPosition: user.primaryPosition,
      secondaryPosition: user.secondaryPosition,
      isFillAvailable: user.isFillAvailable,
      styleTags: this.parseStringArray(user.styleTags),
      mannerScore: user.mannerScore,
      noshowCount: user.noshowCount,
    };
  }

  async updateMyProfile(
    userId: string,
    dto: UpdateMyProfileDto,
  ): Promise<MeResponseDto> {
    await this.ensureUserExists(userId);

    await this.prismaService.user.update({
      where: { id: userId },
      data: {
        nickname: dto.nickname,
        primaryPosition: dto.primaryPosition,
        secondaryPosition: dto.secondaryPosition,
        isFillAvailable: dto.isFillAvailable,
        styleTags: dto.styleTags,
      },
    });

    return this.getMe(userId);
  }

  async getInhouseHistory(
    currentUser: AuthenticatedUser,
    targetUserId: string,
    query: InhouseHistoryQueryDto,
  ): Promise<InhouseHistoryResponseDto> {
    await this.assertCanAccessUserScopedResource(
      currentUser.userId,
      targetUserId,
      query.groupId,
    );

    const stats = await this.prismaService.inhousePlayerStat.findMany({
      where: {
        userId: targetUserId,
        match: {
          ...(query.groupId ? { groupId: query.groupId } : {}),
          status: {
            in: [MatchStatus.CONFIRMED, MatchStatus.CLOSED, MatchStatus.DISPUTED],
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: query.limit ?? 20,
      include: {
        match: {
          include: {
            result: true,
          },
        },
      },
    });

    return {
      items: stats.map((stat) => {
        const didWin = stat.match.result?.winningTeam === stat.teamSide;
        const confidenceMultiplier =
          stat.match.result?.resultStatus === ResultStatus.CONFIRMED
            ? 1
            : stat.match.result?.resultStatus === ResultStatus.PARTIAL
              ? 0.5
              : 0;

        return {
          matchId: stat.matchId,
          scheduledAt: stat.match.scheduledAt?.toISOString() ?? stat.createdAt.toISOString(),
          role: stat.role,
          teamSide: stat.teamSide,
          result: didWin ? 'WIN' : 'LOSE',
          kda: `${stat.kills}/${stat.deaths}/${stat.assists}`,
          deltaMmr: didWin ? 18 * confidenceMultiplier : -18 * confidenceMultiplier,
        };
      }),
    };
  }

  async assertCanAccessUserScopedResource(
    requesterUserId: string,
    targetUserId: string,
    groupId?: string,
  ): Promise<void> {
    if (requesterUserId === targetUserId) {
      return;
    }

    const sharedGroupCount = groupId
      ? await this.prismaService.groupMember.count({
          where: {
            groupId,
            userId: { in: [requesterUserId, targetUserId] },
          },
        })
      : await this.prismaService.inhouseGroup.count({
          where: {
            members: {
              some: {
                userId: requesterUserId,
              },
            },
            AND: {
              members: {
                some: {
                  userId: targetUserId,
                },
              },
            },
          },
        });

    if ((groupId && sharedGroupCount < 2) || (!groupId && sharedGroupCount < 1)) {
      throw new ForbiddenException(
        'You can only access another user if you share the same inhouse group.',
      );
    }
  }

  private async ensureUserExists(userId: string): Promise<void> {
    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }
  }

  private parseStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  }
}
