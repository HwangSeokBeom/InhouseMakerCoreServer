import { BadRequestException, HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MatchStatus, ParticipationStatus, Position, ResultStatus, TeamSide } from '@prisma/client';

import { AppErrorCode, AppException } from '../common/app.exception';
import { toPrismaJson } from '../common/prisma-json.util';
import { MatchesService } from '../matches/matches.service';
import { PowerService } from '../power/power.service';
import { PrismaService } from '../prisma/prisma.service';
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
  private readonly logger = new Logger(MatchmakingService.name);
  private readonly groupLiveLogger = new Logger('GroupLiveDebug');
  private readonly recentHistoryWindow = 8;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly matchesService: MatchesService,
    private readonly powerService: PowerService,
    private readonly algorithmService: MatchmakingAlgorithmService,
    @Optional() private readonly configService?: ConfigService,
  ) {}

  async autoBalance(
    requesterUserId: string,
    matchId: string,
    dto: AutoBalanceDto,
  ): Promise<MatchmakingCandidatesResponseDto> {
    await this.matchesService.assertMatchHostOrCaptain(matchId, requesterUserId);
    return this.generateAndPersistCandidates(matchId, dto.lockedPlayerIds ?? [], [], {
      excludedCombinationKeys: dto.excludePreviousCombinationKeys ?? [],
      tiebreakSeed: null,
    });
  }

  async reroll(
    requesterUserId: string,
    matchId: string,
    dto: RerollDto,
  ): Promise<MatchmakingCandidatesResponseDto> {
    await this.matchesService.assertMatchHostOrCaptain(matchId, requesterUserId);
    const match = await this.matchesService.getMatchWithPlayers(matchId);
    const previousCandidates = Array.isArray(match.candidatesJson)
      ? (match.candidatesJson as Array<Record<string, unknown>>)
      : [];
    const autoExcludedCandidateIds = previousCandidates
      .map((candidate) => candidate.candidateId)
      .filter((candidateId): candidateId is string => typeof candidateId === 'string');
    const autoExcludedCombinationKeys =
      dto.excludePreviousCombination === false
        ? []
        : previousCandidates
            .map((candidate) => candidate.combinationKey)
            .filter(
              (combinationKey): combinationKey is string =>
                typeof combinationKey === 'string',
            );

    return this.generateAndPersistCandidates(
      matchId,
      dto.lockedPlayerIds ?? [],
      [...autoExcludedCandidateIds, ...(dto.excludeCandidateIds ?? [])],
      {
        excludedCombinationKeys: [
          ...autoExcludedCombinationKeys,
          ...(dto.excludePreviousCombinationKeys ?? []),
        ],
        tiebreakSeed: dto.regenerateNonce ?? null,
      },
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
      {
        excludedCombinationKeys: dto.excludePreviousCombinationKeys ?? [],
        tiebreakSeed: null,
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
    options: {
      excludedCombinationKeys: string[];
      tiebreakSeed: string | null;
    },
  ): Promise<MatchmakingCandidatesResponseDto> {
    const match = await this.matchesService.getMatchWithPlayers(matchId);
    const seededParticipantsIncluded = match.players.some((player) =>
      this.isSeededTestParticipant(player.user?.email ?? null, player.user?.powerProfile?.breakdownJson),
    );

    this.groupLiveLogger.log(
      `[GroupLiveDebug] groupId=${match.groupId} memberCount=${match.players.length} source=live seededParticipantsIncluded=${seededParticipantsIncluded}`,
    );

    if (match.players.length !== 10) {
      const diagnostics = this.buildMatchmakingDiagnostics(
        match,
        new Map(),
        lockedPlayerIds,
      );
      this.logAutoBalanceFailure(matchId, diagnostics);
      throw this.createAutoBalanceException(
        '자동 팀 생성은 참가자 10명이 필요해요.',
        diagnostics,
      );
    }

    const userIds = match.players.map((player) => player.userId);
    const powerMap = await this.powerService.getPowerMapForUsers(userIds);
    const diagnostics = this.buildMatchmakingDiagnostics(
      match,
      powerMap,
      lockedPlayerIds,
    );

    if (!diagnostics.isReady) {
      this.logAutoBalanceFailure(matchId, diagnostics);
      throw this.createAutoBalanceException(
        '자동 팀 생성을 시작할 수 없어요. 참가자 상태를 확인해주세요.',
        diagnostics,
      );
    }

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
      options,
    );

    if (candidates.length === 0) {
      const failureDiagnostics = {
        ...diagnostics,
        failureReason: this.resolveCandidateFailureReason(
          players,
          excludedCandidateIds,
          historyContext,
          options,
          lockedPlayerIds,
        ),
      };
      this.logAutoBalanceFailure(matchId, failureDiagnostics);
      throw this.createAutoBalanceException(
        '추천 조합을 만들 수 없어요. 참가자와 포지션 정보를 확인해주세요.',
        failureDiagnostics,
      );
    }

    await this.prismaService.inhouseMatch.update({
      where: { id: matchId },
      data: {
        candidatesJson: toPrismaJson(candidates),
        balanceMode: candidates[0].type,
      },
    });

    return {
      candidates,
      ...(this.isDebugRuntime()
        ? {
            meta: this.toMatchmakingMeta(diagnostics),
            debug: {
              history: historyContext,
              excludedCandidateIds,
              excludedCombinationKeys: options.excludedCombinationKeys,
            },
          }
        : {}),
    };
  }

  private buildMatchmakingDiagnostics(
    match: Awaited<ReturnType<MatchesService['getMatchWithPlayers']>>,
    powerMap: Map<string, { overallPower: number; lanePower: Record<string, number> }>,
    lockedPlayerIds: string[],
  ) {
    const userIds = match.players.map((player) => player.userId);
    const acceptedPlayerCount = match.players.filter(
      (player) =>
        player.participationStatus === ParticipationStatus.ACCEPTED ||
        player.participationStatus === ParticipationStatus.LOCKED_IN,
    ).length;
    const duplicateUserIds = [...new Set(
      userIds.filter((userId, index) => userIds.indexOf(userId) !== index),
    )];
    const matchUserIdSet = new Set(userIds);
    const lockedPlayerIdsNotInMatch = lockedPlayerIds.filter(
      (userId) => !matchUserIdSet.has(userId),
    );
    const lockedPlayersMissingAssignment = match.players
      .filter(
        (player) =>
          lockedPlayerIds.includes(player.userId) &&
          (!player.teamSide || !player.assignedRole),
      )
      .map((player) => player.userId);
    const missingPowerProfileUserIds = match.players
      .filter((player) => !powerMap.has(player.userId))
      .map((player) => player.userId);
    const missingPrimaryPositionUserIds = match.players
      .filter((player) => !player.user.primaryPosition)
      .map((player) => player.userId);
    const positionCoverage = this.buildPositionCoverage(match.players);
    const blockingReasons = [
      ...(match.players.length !== 10 ? ['PLAYER_COUNT_NOT_10'] : []),
      ...(acceptedPlayerCount !== 10 ? ['PARTICIPANTS_NOT_ACCEPTED'] : []),
      ...(duplicateUserIds.length > 0 ? ['DUPLICATE_PLAYERS'] : []),
      ...(lockedPlayerIdsNotInMatch.length > 0 ? ['LOCKED_PLAYER_NOT_FOUND'] : []),
      ...(lockedPlayersMissingAssignment.length > 0
        ? ['LOCKED_PLAYER_ASSIGNMENT_MISSING']
        : []),
    ];

    return {
      isReady: blockingReasons.length === 0,
      blockingReasons,
      requiredPlayerCount: 10,
      playerCount: match.players.length,
      acceptedPlayerCount,
      duplicateUserIds,
      lockedPlayerIds,
      lockedPlayerIdsNotInMatch,
      lockedPlayersMissingAssignment,
      missingPowerProfileUserIds,
      missingPrimaryPositionUserIds,
      positionCoverage,
    };
  }

  private buildPositionCoverage(
    players: Awaited<ReturnType<MatchesService['getMatchWithPlayers']>>['players'],
  ): Record<string, { primary: number; secondary: number; fillAvailable: number }> {
    return [
      Position.TOP,
      Position.JUNGLE,
      Position.MID,
      Position.ADC,
      Position.SUPPORT,
    ].reduce<Record<string, { primary: number; secondary: number; fillAvailable: number }>>(
      (acc, role) => {
        acc[role] = {
          primary: players.filter((player) => player.user.primaryPosition === role).length,
          secondary: players.filter((player) => player.user.secondaryPosition === role).length,
          fillAvailable: players.filter((player) => player.user.isFillAvailable).length,
        };
        return acc;
      },
      {},
    );
  }

  private resolveCandidateFailureReason(
    players: AlgorithmPlayer[],
    excludedCandidateIds: string[],
    historyContext: MatchHistoryContext,
    options: {
      excludedCombinationKeys: string[];
      tiebreakSeed: string | null;
    },
    lockedPlayerIds: string[],
  ): string {
    const withoutExclusions = this.algorithmService.generateCandidates(
      players,
      [],
      historyContext,
      {
        excludedCombinationKeys: [],
        tiebreakSeed: options.tiebreakSeed,
      },
    );

    if (
      withoutExclusions.length > 0 &&
      (excludedCandidateIds.length > 0 || options.excludedCombinationKeys.length > 0)
    ) {
      return 'ALL_CANDIDATES_EXCLUDED';
    }

    if (lockedPlayerIds.length > 0) {
      const unlockedPlayers = players.map((player) => ({
        ...player,
        lockedTeamSide: null,
        lockedRole: null,
      }));
      const unlockedCandidates = this.algorithmService.generateCandidates(
        unlockedPlayers,
        [],
        historyContext,
        {
          excludedCombinationKeys: [],
          tiebreakSeed: options.tiebreakSeed,
        },
      );

      if (unlockedCandidates.length > 0) {
        return 'LOCKED_ASSIGNMENT_CONFLICT';
      }
    }

    return 'NO_VALID_ROLE_ASSIGNMENT';
  }

  private createAutoBalanceException(
    message: string,
    diagnostics: Record<string, unknown>,
  ): AppException {
    return new AppException(
      HttpStatus.BAD_REQUEST,
      AppErrorCode.MATCH_BALANCE_INVALID,
      message,
      this.isDebugRuntime()
        ? {
            ...this.toMatchmakingMeta(diagnostics),
            debug: diagnostics,
          }
        : this.toMatchmakingMeta(diagnostics),
    );
  }

  private toMatchmakingMeta(diagnostics: Record<string, unknown>): Record<string, unknown> {
    return {
      requiredPlayerCount: diagnostics.requiredPlayerCount,
      playerCount: diagnostics.playerCount,
      acceptedPlayerCount: diagnostics.acceptedPlayerCount,
      blockingReasons: diagnostics.blockingReasons,
      failureReason: diagnostics.failureReason ?? null,
      missingPowerProfileCount: Array.isArray(diagnostics.missingPowerProfileUserIds)
        ? diagnostics.missingPowerProfileUserIds.length
        : 0,
      missingPrimaryPositionCount: Array.isArray(diagnostics.missingPrimaryPositionUserIds)
        ? diagnostics.missingPrimaryPositionUserIds.length
        : 0,
      positionCoverage: diagnostics.positionCoverage,
    };
  }

  private logAutoBalanceFailure(
    matchId: string,
    diagnostics: Record<string, unknown>,
  ): void {
    this.logger.warn(
      `auto_balance_unavailable ${JSON.stringify({
        matchId,
        ...this.toMatchmakingMeta(diagnostics),
      })}`,
    );
  }

  private isDebugRuntime(): boolean {
    const nodeEnv = (this.configService?.get<string>('NODE_ENV') ?? process.env.NODE_ENV ?? 'development').toLowerCase();
    const appEnv = (this.configService?.get<string>('APP_ENV') ?? process.env.APP_ENV ?? '').toLowerCase();

    return nodeEnv === 'development' || nodeEnv === 'test' || appEnv === 'local' || appEnv === 'test' || appEnv === 'development';
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

  private isSeededTestParticipant(
    email: string | null,
    breakdownJson: unknown,
  ): boolean {
    const normalizedEmail = email?.trim().toLowerCase() ?? '';
    if (
      normalizedEmail.startsWith('dev_mock_') ||
      normalizedEmail.endsWith('@inhouse.local')
    ) {
      return true;
    }

    const breakdown =
      breakdownJson && typeof breakdownJson === 'object'
        ? (breakdownJson as Record<string, unknown>)
        : null;
    const inhouse =
      breakdown?.inhouse && typeof breakdown.inhouse === 'object'
        ? (breakdown.inhouse as Record<string, unknown>)
        : null;

    return inhouse?.source === 'dev_group_fill';
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
