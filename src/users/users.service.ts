import { HttpStatus, Injectable } from '@nestjs/common';
import { MatchStatus, ResultStatus } from '@prisma/client';

import { AppErrorCode, AppException } from '../common/app.exception';
import { AuthenticatedUser } from '../common/interfaces/authenticated-request.interface';
import { PrismaService } from '../prisma/prisma.service';
import {
  InhouseHistoryQueryDto,
  InhouseHistoryResponseDto,
  MeResponseDto,
  UserProfileResponseDto,
  UserStatsQueryDto,
  UserStatsResponseDto,
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
      throw new AppException(
        HttpStatus.NOT_FOUND,
        AppErrorCode.USER_NOT_FOUND,
        'User not found.',
        {
          userId,
        },
      );
    }

    return {
      id: user.id,
      email: user.email,
      nickname: user.nickname,
      status: user.status,
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

  async getUserProfile(
    requesterUserId: string,
    targetUserId: string,
  ): Promise<UserProfileResponseDto> {
    await this.assertCanAccessUserScopedResource(requesterUserId, targetUserId);

    const user = await this.prismaService.user.findUnique({
      where: { id: targetUserId },
      include: {
        powerProfile: {
          select: {
            overallPower: true,
          },
        },
      },
    });

    if (!user) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        AppErrorCode.USER_NOT_FOUND,
        'User not found.',
        {
          userId: targetUserId,
        },
      );
    }

    return {
      id: user.id,
      userId: user.id,
      nickname: user.nickname,
      primaryPosition: user.primaryPosition,
      mainPosition: user.primaryPosition,
      secondaryPosition: user.secondaryPosition,
      isFillAvailable: user.isFillAvailable,
      recentPower: user.powerProfile?.overallPower ?? null,
      profileVisible: true,
      styleTags: this.parseStringArray(user.styleTags),
      mannerScore: user.mannerScore,
      noshowCount: user.noshowCount,
    };
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
            group: {
              select: {
                id: true,
                name: true,
              },
            },
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
          id: stat.matchId,
          matchId: stat.matchId,
          canonicalMatchId: stat.matchId,
          groupId: stat.match.groupId,
          groupName: stat.match.group?.name ?? null,
          title: stat.match.title ?? null,
          status: stat.match.status,
          scheduledAt: stat.match.scheduledAt?.toISOString() ?? stat.createdAt.toISOString(),
          role: stat.role,
          teamSide: stat.teamSide,
          result: didWin ? 'WIN' : 'LOSE',
          kda: `${stat.kills}/${stat.deaths}/${stat.assists}`,
          deltaMmr: didWin ? 18 * confidenceMultiplier : -18 * confidenceMultiplier,
          winningTeam: stat.match.result?.winningTeam ?? null,
          resultStatus: stat.match.result?.resultStatus ?? null,
        };
      }),
    };
  }

  async getUserStats(
    currentUser: AuthenticatedUser,
    targetUserId: string,
    query: UserStatsQueryDto,
  ): Promise<UserStatsResponseDto> {
    await this.assertCanAccessUserScopedResource(
      currentUser.userId,
      targetUserId,
      query.groupId,
    );

    const [stats, powerProfile] = await Promise.all([
      this.prismaService.inhousePlayerStat.findMany({
        where: {
          userId: targetUserId,
          match: {
            ...(query.groupId ? { groupId: query.groupId } : {}),
            result: {
              is: {
                resultStatus: ResultStatus.CONFIRMED,
              },
            },
          },
        },
        include: {
          match: {
            include: {
              result: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prismaService.playerPowerProfile.findUnique({
        where: { userId: targetUserId },
      }),
    ]);

    const totalGames = stats.length;
    const wins = stats.filter((stat) => stat.match.result?.winningTeam === stat.teamSide).length;
    const losses = totalGames - wins;
    const recentForm = stats.slice(0, 5).map((stat) =>
      stat.match.result?.winningTeam === stat.teamSide ? 'W' : 'L',
    );
    const positionCounts = stats.reduce<Record<string, number>>((acc, stat) => {
      acc[stat.role] = (acc[stat.role] ?? 0) + 1;
      return acc;
    }, {});
    const mainPositions = Object.entries(positionCounts)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 2)
      .map(([position, games]) => ({
        position: position as any,
        games,
      }));
    const currentPower = powerProfile?.overallPower ?? 0;
    const powerDelta = Number((currentPower - (powerProfile?.basePower ?? currentPower)).toFixed(2));
    const groupRank = query.groupId
      ? await this.resolveGroupRank(query.groupId, targetUserId)
      : null;

    return {
      userId: targetUserId,
      totalGames,
      wins,
      losses,
      winRate: totalGames > 0 ? Number((wins / totalGames).toFixed(4)) : 0,
      recentForm,
      mainPositions,
      powerTrendSummary: {
        direction: powerDelta > 2 ? 'UP' : powerDelta < -2 ? 'DOWN' : 'STABLE',
        delta: powerDelta,
      },
      currentPower,
      groupRank,
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
      throw new AppException(
        HttpStatus.FORBIDDEN,
        AppErrorCode.GROUP_ACCESS_FORBIDDEN,
        'You are not allowed to access this user without a shared inhouse group.',
        {
          requesterUserId,
          targetUserId,
          groupId: groupId ?? null,
        },
      );
    }
  }

  private async ensureUserExists(userId: string): Promise<void> {
    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!user) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        AppErrorCode.USER_NOT_FOUND,
        'User not found.',
        {
          userId,
        },
      );
    }
  }

  private parseStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  }

  private async resolveGroupRank(
    groupId: string,
    targetUserId: string,
  ): Promise<number | null> {
    const members = await this.prismaService.groupMember.findMany({
      where: { groupId },
      include: {
        user: {
          include: {
            powerProfile: true,
          },
        },
      },
    });

    const ranked = [...members]
      .sort(
        (left, right) =>
          (right.user.powerProfile?.overallPower ?? 0) - (left.user.powerProfile?.overallPower ?? 0),
      )
      .map((member) => member.userId);

    const index = ranked.indexOf(targetUserId);
    return index >= 0 ? index + 1 : null;
  }
}
