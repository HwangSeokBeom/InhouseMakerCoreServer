import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  GroupRole,
  MatchStatus,
  ParticipationStatus,
  ResultStatus,
  UserStatus,
} from '@prisma/client';

import { AppErrorCode, AppException } from '../common/app.exception';
import { AuthenticatedUser } from '../common/interfaces/authenticated-request.interface';
import { PrismaService } from '../prisma/prisma.service';
import {
  InhouseHistoryQueryDto,
  InhouseHistoryResponseDto,
  InviteUserSearchItemDto,
  InviteUserSearchQueryDto,
  InviteUserSearchResponseDto,
  MeResponseDto,
  UserProfileResponseDto,
  UserStatsQueryDto,
  UserStatsResponseDto,
  UpdateMyProfileDto,
} from './dto/profile.dto';

@Injectable()
export class UsersService {
  private readonly historyReadLogger = new Logger('HistoryReadDebug');
  private readonly historyConsistencyLogger = new Logger('HistoryConsistencyDebug');
  private readonly historyVisibleMatchStatuses: MatchStatus[] = [
    MatchStatus.RESULT_PENDING,
    MatchStatus.CONFIRMED,
    MatchStatus.CLOSED,
    MatchStatus.DISPUTED,
  ];
  private readonly completedHistoryMatchStatuses: MatchStatus[] = [
    MatchStatus.CONFIRMED,
    MatchStatus.CLOSED,
    MatchStatus.DISPUTED,
  ];
  private readonly joinedParticipationStatuses: ParticipationStatus[] = [
    ParticipationStatus.ACCEPTED,
    ParticipationStatus.LOCKED_IN,
  ];

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

  async searchInviteUsers(
    requesterUserId: string,
    query: InviteUserSearchQueryDto,
  ): Promise<InviteUserSearchResponseDto> {
    const items = await this.findInviteUsers(requesterUserId, query, {
      groupId: query.groupId,
      excludeExistingMembers: query.excludeExistingMembers,
    });

    return { items };
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

    const limit = query.limit ?? 20;
    const matchConditions = {
      ...(query.groupId ? { groupId: query.groupId } : {}),
      status: {
        in: this.historyVisibleMatchStatuses,
      },
    };
    const loggedConditions = {
      source: 'inhouse_player_stats',
      userId: targetUserId,
      groupId: query.groupId ?? null,
      matchStatusIn: this.historyVisibleMatchStatuses,
      resultStatus: 'not_filtered',
      playedAt: 'not_filtered',
      requiredProjection: 'inhouse_player_stats row for userId + matchId',
    };

    this.historyReadLogger.log(
      `[HistoryReadDebug] action=query_start userId=${targetUserId} limit=${limit}`,
    );
    this.historyReadLogger.log(
      `[HistoryReadDebug] action=query_conditions userId=${targetUserId} conditions=${JSON.stringify(loggedConditions)}`,
    );

    const stats = await this.prismaService.inhousePlayerStat.findMany({
      where: {
        userId: targetUserId,
        match: matchConditions,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
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

    this.historyReadLogger.log(
      `[HistoryReadDebug] action=query_result userId=${targetUserId} itemCount=${stats.length}`,
    );

    if (stats.length === 0) {
      await this.logHistoryEmptyReason(targetUserId, query.groupId);
    } else {
      for (const stat of stats) {
        const reason = this.resolveHistoryExclusionReason({
          hasStat: true,
          matchStatus: stat.match.status,
          playedAt: this.resolveHistoryPlayedAt(stat),
        });

        this.historyConsistencyLogger.log(
          reason === null
            ? `[HistoryConsistencyDebug] matchId=${stat.matchId} source=live includedInHistory=true userId=${targetUserId}`
            : `[HistoryConsistencyDebug] matchId=${stat.matchId} source=live includedInHistory=false reason=${reason} userId=${targetUserId}`,
        );
      }
    }

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

  private async logHistoryEmptyReason(
    userId: string,
    groupId?: string,
  ): Promise<void> {
    const groupCondition = groupId ? { groupId } : {};
    const [matchedCompleted, matchedParticipants, missingProjection, pendingStats] =
      await Promise.all([
        this.prismaService.inhousePlayerStat.count({
          where: {
            userId,
            match: {
              ...groupCondition,
              status: {
                in: this.completedHistoryMatchStatuses,
              },
            },
          },
        }),
        this.prismaService.inhouseMatchPlayer.count({
          where: {
            userId,
            participationStatus: {
              in: this.joinedParticipationStatuses,
            },
            match: {
              ...groupCondition,
              status: {
                in: this.historyVisibleMatchStatuses,
              },
            },
          },
        }),
        this.prismaService.inhouseMatchPlayer.count({
          where: {
            userId,
            participationStatus: {
              in: this.joinedParticipationStatuses,
            },
            match: {
              ...groupCondition,
              status: {
                in: this.historyVisibleMatchStatuses,
              },
              playerStats: {
                none: {
                  userId,
                },
              },
            },
          },
        }),
        this.prismaService.inhousePlayerStat.count({
          where: {
            userId,
            match: {
              ...groupCondition,
              status: MatchStatus.RESULT_PENDING,
            },
          },
        }),
      ]);

    this.historyReadLogger.log(
      `[HistoryReadDebug] action=query_empty_reason userId=${userId} matchedCompleted=${matchedCompleted} matchedParticipants=${matchedParticipants} missingProjection=${missingProjection} pendingStats=${pendingStats}`,
    );
  }

  private resolveHistoryExclusionReason(params: {
    hasStat: boolean;
    matchStatus: MatchStatus;
    playedAt: string | null;
  }): 'match_not_completed' | 'playedAt_null' | 'missingProjection' | null {
    if (!params.hasStat) {
      return 'missingProjection';
    }

    if (!this.historyVisibleMatchStatuses.includes(params.matchStatus)) {
      return 'match_not_completed';
    }

    if (params.playedAt === null) {
      return 'playedAt_null';
    }

    return null;
  }

  private resolveHistoryPlayedAt(stat: {
    createdAt: Date;
    match: {
      scheduledAt: Date | null;
      result: {
        confirmedAt?: Date | null;
        updatedAt?: Date | null;
      } | null;
    };
  }): string | null {
    return (
      stat.match.result?.confirmedAt?.toISOString() ??
      stat.match.result?.updatedAt?.toISOString() ??
      stat.match.scheduledAt?.toISOString() ??
      stat.createdAt.toISOString()
    );
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

  async findInviteUsers(
    requesterUserId: string,
    query: Pick<InviteUserSearchQueryDto, 'query' | 'limit'>,
    options: {
      groupId?: string;
      excludeExistingMembers?: boolean;
    } = {},
  ): Promise<InviteUserSearchItemDto[]> {
    const normalizedQuery = query.query.trim();
    const limit = query.limit ?? 20;
    const fetchLimit = Math.min(Math.max(limit * 5, 50), 100);

    const users = await this.prismaService.user.findMany({
      where: {
        status: UserStatus.ACTIVE,
        nickname: {
          contains: normalizedQuery,
          mode: 'insensitive',
        },
        ...(options.groupId && options.excludeExistingMembers
          ? {
              groupMemberships: {
                none: {
                  groupId: options.groupId,
                },
              },
            }
          : {}),
      },
      select: {
        id: true,
        nickname: true,
        primaryPosition: true,
        secondaryPosition: true,
        powerProfile: {
          select: {
            overallPower: true,
          },
        },
        riotAccounts: {
          where: {
            isPrimary: true,
          },
          select: {
            riotGameName: true,
            tagLine: true,
            region: true,
            profileIconId: true,
            summonerLevel: true,
          },
          take: 1,
        },
        ...(options.groupId
          ? {
              groupMemberships: {
                where: {
                  groupId: options.groupId,
                },
                select: {
                  role: true,
                },
                take: 1,
              },
            }
          : {}),
      },
      take: fetchLimit,
    });

    return users
      .map((user) => {
        const membership = 'groupMemberships' in user ? user.groupMemberships?.[0] ?? null : null;
        const riotAccount = user.riotAccounts[0] ?? null;
        const eligibility = this.resolveInviteEligibility(user.id === requesterUserId, membership !== null);
        return {
          id: user.id,
          userId: user.id,
          nickname: user.nickname,
          primaryPosition: user.primaryPosition,
          mainPosition: user.primaryPosition,
          secondaryPosition: user.secondaryPosition,
          recentPower: user.powerProfile?.overallPower ?? null,
          riotDisplayName: this.buildRiotDisplayName(
            riotAccount?.riotGameName ?? null,
            riotAccount?.tagLine ?? null,
          ),
          riotGameName: riotAccount?.riotGameName ?? null,
          tagLine: riotAccount?.tagLine ?? null,
          region: riotAccount?.region ?? null,
          profileIconId: riotAccount?.profileIconId ?? null,
          summonerLevel: riotAccount?.summonerLevel ?? null,
          profileImageUrl: null,
          isSelf: eligibility.isSelf,
          alreadyMember: options.groupId ? membership !== null : null,
          isAlreadyMember: eligibility.isAlreadyMember,
          isEligible: eligibility.isEligible,
          inviteBlockedReason: eligibility.inviteBlockedReason,
          memberRole: membership?.role ?? null,
          matchRank: this.resolveInviteSearchRank(user.nickname, normalizedQuery),
        };
      })
      .sort((left, right) => {
        if (left.matchRank !== right.matchRank) {
          return left.matchRank - right.matchRank;
        }

        return left.nickname.localeCompare(right.nickname, 'ko');
      })
      .slice(0, limit)
      .map(({ matchRank: _matchRank, ...item }) => item);
  }

  private parseStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  }

  private buildRiotDisplayName(
    riotGameName: string | null,
    tagLine: string | null,
  ): string | null {
    const normalizedGameName = riotGameName?.trim();
    if (!normalizedGameName) {
      return null;
    }

    const normalizedTagLine = tagLine?.trim();
    return normalizedTagLine ? `${normalizedGameName}#${normalizedTagLine}` : normalizedGameName;
  }

  private resolveInviteSearchRank(nickname: string, query: string): number {
    const normalizedNickname = nickname.trim().toLocaleLowerCase();
    const normalizedQuery = query.trim().toLocaleLowerCase();

    if (normalizedNickname === normalizedQuery) {
      return 0;
    }

    if (normalizedNickname.startsWith(normalizedQuery)) {
      return 1;
    }

    return 2;
  }

  private resolveInviteEligibility(
    isSelf: boolean,
    isAlreadyMember: boolean,
  ): {
    isSelf: boolean;
    isAlreadyMember: boolean;
    isEligible: boolean;
    inviteBlockedReason: string | null;
  } {
    if (isSelf) {
      return {
        isSelf,
        isAlreadyMember,
        isEligible: false,
        inviteBlockedReason: 'CANNOT_ADD_SELF',
      };
    }

    if (isAlreadyMember) {
      return {
        isSelf,
        isAlreadyMember,
        isEligible: false,
        inviteBlockedReason: 'ALREADY_MEMBER',
      };
    }

    return {
      isSelf,
      isAlreadyMember,
      isEligible: true,
      inviteBlockedReason: null,
    };
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
