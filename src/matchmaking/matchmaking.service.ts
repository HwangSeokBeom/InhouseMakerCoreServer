import { BadRequestException, Injectable } from '@nestjs/common';
import { MatchStatus, Position, ResultStatus, TeamSide } from '@prisma/client';

import { MatchesService } from '../matches/matches.service';
import { PowerService } from '../power/power.service';
import { PrismaService } from '../prisma/prisma.service';
import { toPrismaJson } from '../common/prisma-json.util';
import {
  AutoBalanceDto,
  BalancePreviewDto,
  MatchmakingCandidatesResponseDto,
  RerollDto,
} from './dto/matchmaking.dto';
import {
  AlgorithmPlayer,
  MatchHistoryContext,
  MatchmakingAlgorithmService,
  PairHistorySummary,
} from './matchmaking-algorithm.service';

@Injectable()
export class MatchmakingService {
  private readonly recentHistoryWindow = 8;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly matchesService: MatchesService,
    private readonly powerService: PowerService,
    private readonly algorithmService: MatchmakingAlgorithmService,
  ) {}

  async autoBalance(
    requesterUserId: string,
    matchId: string,
    dto: AutoBalanceDto,
  ): Promise<MatchmakingCandidatesResponseDto> {
    await this.matchesService.assertMatchHostOrCaptain(matchId, requesterUserId);
    return this.generateAndPersistCandidates(matchId, dto.lockedPlayerIds ?? [], []);
  }

  async reroll(
    requesterUserId: string,
    matchId: string,
    dto: RerollDto,
  ): Promise<MatchmakingCandidatesResponseDto> {
    await this.matchesService.assertMatchHostOrCaptain(matchId, requesterUserId);
    return this.generateAndPersistCandidates(
      matchId,
      dto.lockedPlayerIds ?? [],
      dto.excludeCandidateIds ?? [],
    );
  }

  previewBalance(dto: BalancePreviewDto): MatchmakingCandidatesResponseDto {
    if (dto.players.length !== 10) {
      throw new BadRequestException('Balance preview requires exactly 10 players.');
    }

    const normalizedUserIds = dto.players.map((player) => player.userId.trim());
    if (new Set(normalizedUserIds).size !== normalizedUserIds.length) {
      throw new BadRequestException('Balance preview players must have unique user IDs.');
    }

    const players: AlgorithmPlayer[] = dto.players.map((player) => ({
      userId: player.userId.trim(),
      nickname: player.nickname.trim(),
      primaryPosition: player.primaryPosition ?? null,
      secondaryPosition: player.secondaryPosition ?? null,
      isFillAvailable: player.isFillAvailable ?? true,
      overallPower: Number(player.overallPower),
      lanePower: this.normalizeLanePower(player.overallPower, player.lanePower),
      sameTeamPreferenceUserIds: this.toStringArray(player.sameTeamPreferenceUserIds),
      avoidTeamPreferenceUserIds: this.toStringArray(player.avoidTeamPreferenceUserIds),
      lockedTeamSide: player.lockedTeamSide ?? null,
      lockedRole: player.lockedRole ?? null,
    }));

    const candidates = this.algorithmService.generateCandidates(
      players,
      dto.excludeCandidateIds ?? [],
      {
        recentWindowSize: 0,
        matchesAnalyzed: 0,
        sameTeamPairHistory: {},
      },
    );

    if (candidates.length === 0) {
      throw new BadRequestException(
        'No valid balance preview candidates were found. Check role coverage and locked assignments.',
      );
    }

    return { candidates };
  }

  private async generateAndPersistCandidates(
    matchId: string,
    lockedPlayerIds: string[],
    excludedCandidateIds: string[],
  ): Promise<MatchmakingCandidatesResponseDto> {
    const match = await this.matchesService.getMatchWithPlayers(matchId);

    if (match.players.length !== 10) {
      throw new BadRequestException('Auto-balance requires exactly 10 players.');
    }

    const userIds = match.players.map((player) => player.userId);
    const powerMap = await this.powerService.getPowerMapForUsers(userIds);
    const historyContext = await this.buildMatchHistoryContext(
      match.groupId,
      matchId,
      userIds,
    );

    const players: AlgorithmPlayer[] = match.players.map((player) => ({
      userId: player.userId,
      nickname: player.user.nickname,
      primaryPosition: player.user.primaryPosition,
      secondaryPosition: player.user.secondaryPosition,
      isFillAvailable: player.user.isFillAvailable,
      overallPower: powerMap.get(player.userId)?.overallPower ?? 50,
      lanePower: powerMap.get(player.userId)?.lanePower ?? this.defaultLanePower(50),
      sameTeamPreferenceUserIds: this.toStringArray(player.sameTeamPreferencesJson),
      avoidTeamPreferenceUserIds: this.toStringArray(player.avoidTeamPreferencesJson),
      lockedTeamSide: lockedPlayerIds.includes(player.userId) ? player.teamSide : null,
      lockedRole: lockedPlayerIds.includes(player.userId) ? player.assignedRole : null,
    }));

    const candidates = this.algorithmService.generateCandidates(
      players,
      excludedCandidateIds,
      historyContext,
    );

    if (candidates.length === 0) {
      throw new BadRequestException(
        'No valid team split was found. Check locked players and position coverage.',
      );
    }

    await this.prismaService.inhouseMatch.update({
      where: { id: matchId },
      data: {
        candidatesJson: toPrismaJson(candidates),
        balanceMode: candidates[0].type,
      },
    });

    return { candidates };
  }

  private defaultLanePower(overallPower: number): Record<string, number> {
    return {
      [Position.TOP]: overallPower,
      [Position.JUNGLE]: overallPower,
      [Position.MID]: overallPower,
      [Position.ADC]: overallPower,
      [Position.SUPPORT]: overallPower,
    };
  }

  private normalizeLanePower(
    overallPower: number,
    lanePower?: Record<string, number> | null,
  ): Record<string, number> {
    const defaults = this.defaultLanePower(overallPower);

    if (!lanePower) {
      return defaults;
    }

    return {
      [Position.TOP]: Number(lanePower[Position.TOP] ?? defaults[Position.TOP]),
      [Position.JUNGLE]: Number(lanePower[Position.JUNGLE] ?? defaults[Position.JUNGLE]),
      [Position.MID]: Number(lanePower[Position.MID] ?? defaults[Position.MID]),
      [Position.ADC]: Number(lanePower[Position.ADC] ?? defaults[Position.ADC]),
      [Position.SUPPORT]: Number(lanePower[Position.SUPPORT] ?? defaults[Position.SUPPORT]),
    };
  }

  private toStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  }

  private async buildMatchHistoryContext(
    groupId: string,
    matchId: string,
    userIds: string[],
  ): Promise<MatchHistoryContext> {
    const currentUserIds = new Set(userIds);
    const recentMatches = await this.prismaService.inhouseMatch.findMany({
      where: {
        groupId,
        id: { not: matchId },
        status: {
          in: [MatchStatus.CONFIRMED, MatchStatus.CLOSED],
        },
        result: {
          is: {
            resultStatus: ResultStatus.CONFIRMED,
          },
        },
        players: {
          some: {
            userId: { in: userIds },
            teamSide: {
              in: [TeamSide.A, TeamSide.B],
            },
          },
        },
      },
      include: {
        players: {
          select: {
            userId: true,
            teamSide: true,
          },
        },
      },
      orderBy: [{ scheduledAt: 'desc' }, { createdAt: 'desc' }],
      take: this.recentHistoryWindow,
    });

    const sameTeamPairHistory: Record<string, PairHistorySummary> = {};

    recentMatches.forEach((recentMatch, index) => {
      const recencyWeight = Math.max(0.35, 1.35 - index * 0.15);

      for (const teamSide of [TeamSide.A, TeamSide.B]) {
        const teamUserIds = recentMatch.players
          .filter(
            (player) =>
              player.teamSide === teamSide && currentUserIds.has(player.userId),
          )
          .map((player) => player.userId);

        if (teamUserIds.length < 2) {
          continue;
        }

        for (let leftIndex = 0; leftIndex < teamUserIds.length; leftIndex += 1) {
          for (let rightIndex = leftIndex + 1; rightIndex < teamUserIds.length; rightIndex += 1) {
            const [leftUserId, rightUserId] = [teamUserIds[leftIndex], teamUserIds[rightIndex]].sort();
            const key = `${leftUserId}:${rightUserId}`;
            const summary = sameTeamPairHistory[key] ?? {
              userIds: [leftUserId, rightUserId] as [string, string],
              sameTeamMatches: 0,
              weightedSameTeamScore: 0,
              recentMatchIds: [],
            };

            summary.sameTeamMatches += 1;
            summary.weightedSameTeamScore += recencyWeight;
            summary.recentMatchIds = [...summary.recentMatchIds, recentMatch.id].slice(0, 5);
            sameTeamPairHistory[key] = summary;
          }
        }
      }
    });

    return {
      recentWindowSize: this.recentHistoryWindow,
      matchesAnalyzed: recentMatches.length,
      sameTeamPairHistory,
    };
  }
}
