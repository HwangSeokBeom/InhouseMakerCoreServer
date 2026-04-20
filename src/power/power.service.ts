import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Position, ResultStatus, SnapshotType } from '@prisma/client';

import { toPrismaJson } from '../common/prisma-json.util';
import { PrismaService } from '../prisma/prisma.service';
import { RiotChampionSummaryService } from '../riot/riot-champion-summary.service';
import { UsersService } from '../users/users.service';
import { BasePowerCalculator } from './calculators/base-power.calculator';
import { FormScoreCalculator } from './calculators/form-score.calculator';
import {
  InhouseMmrCalculator,
  InhouseMmrStatInput,
} from './calculators/inhouse-mmr.calculator';
import { LanePowerCalculator } from './calculators/lane-power.calculator';
import { OverallPowerCalculator } from './calculators/overall-power.calculator';
import { StyleScoreCalculator } from './calculators/style-score.calculator';
import {
  buildPowerProfileDisplayScore,
  normalizeLanePower,
  normalizeStyleScores,
  resolveLaneAutoAssignment,
} from './power-profile.contract';
import { PowerProfileResponseDto } from './dto/power-profile.dto';
import { POWER_PROFILE_VERSION, POWER_ROLES, PowerRole } from './power.constants';

@Injectable()
export class PowerService {
  private readonly logger = new Logger(PowerService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly usersService: UsersService,
    private readonly riotChampionSummaryService: RiotChampionSummaryService,
    private readonly basePowerCalculator: BasePowerCalculator,
    private readonly formScoreCalculator: FormScoreCalculator,
    private readonly inhouseMmrCalculator: InhouseMmrCalculator,
    private readonly lanePowerCalculator: LanePowerCalculator,
    private readonly styleScoreCalculator: StyleScoreCalculator,
    private readonly overallPowerCalculator: OverallPowerCalculator,
  ) {}

  async getProfile(
    requesterUserId: string,
    userId: string,
  ): Promise<PowerProfileResponseDto> {
    await this.usersService.assertCanAccessUserScopedResource(requesterUserId, userId);

    let profile = await this.findProfileForResponse(userId);

    if (!profile) {
      throw new NotFoundException('Power profile not found.');
    }

    if (this.shouldRefreshProfile(profile)) {
      await this.recalculateProfile(userId);
      profile = await this.findProfileForResponse(userId);
    }

    if (!profile) {
      throw new NotFoundException('Power profile not found.');
    }

    return this.toResponse(profile);
  }

  async recalculateProfile(userId: string): Promise<void> {
    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
      include: {
        riotAccounts: {
          orderBy: [{ isPrimary: 'desc' }, { updatedAt: 'desc' }],
          include: {
            snapshots: {
              orderBy: { collectedAt: 'desc' },
              take: 50,
            },
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    const sourceAccount = user.riotAccounts[0];
    const rankedSnapshots =
      sourceAccount?.snapshots.filter((snapshot) => snapshot.snapshotType === SnapshotType.RANKED) ?? [];
    const latestRankedSnapshot = rankedSnapshots[0];
    const rankedSnapshot =
      latestRankedSnapshot &&
      this.basePowerCalculator.isCurrentRankSnapshot(
        latestRankedSnapshot.collectedAt,
        sourceAccount?.lastSyncedAt ?? null,
      )
        ? latestRankedSnapshot
        : null;
    const aggregateSnapshot = sourceAccount?.snapshots.find(
      (snapshot) => snapshot.snapshotType === SnapshotType.AGGREGATED,
    );
    const rankedMetrics = rankedSnapshot?.metricsJson as Record<string, unknown> | null;
    const aggregateMetrics = aggregateSnapshot?.metricsJson as Record<string, unknown> | null;

    const basePowerBreakdown = this.basePowerCalculator.calculateDetailed(
      {
        currentRankedSummary: rankedMetrics,
        rankedHistory: (rankedSnapshot ? rankedSnapshots.slice(1) : rankedSnapshots).map((snapshot) => ({
          collectedAt: snapshot.collectedAt,
          metricsJson: snapshot.metricsJson as Record<string, unknown> | null,
        })),
        lastSyncAt: sourceAccount?.lastSyncedAt ?? null,
      },
    );
    if (basePowerBreakdown.historicalFallbackApplied) {
      this.logPowerDebug(userId, 'current_season_missing', {
        apply_historical_fallback: true,
      });
    }
    for (const candidate of basePowerBreakdown.historicalCandidates) {
      this.logPowerDebug(userId, 'historical_weight', {
        season: candidate.seasonKey,
        queue: candidate.queueSource.toLowerCase(),
        value: candidate.decayedScore,
        weight: candidate.effectiveWeight,
        decay: candidate.recencyDecay,
      });
    }
    this.logPowerDebug(userId, 'fallback_penalty', {
      unrankedPenalty: basePowerBreakdown.unrankedPenalty,
      inactivePenalty: basePowerBreakdown.inactivePenalty,
      historicalAdjustment: basePowerBreakdown.historicalAdjustment,
      flexAdjustment: basePowerBreakdown.flexAdjustment,
      floorScore: basePowerBreakdown.floorScore,
    });
    const formScoreBreakdown = this.formScoreCalculator.calculateDetailed(
      aggregateMetrics,
    );
    const styleScores = this.styleScoreCalculator.calculate(
      aggregateMetrics,
    );
    const lanePowerBreakdown = this.lanePowerCalculator.calculateDetailed(
      basePowerBreakdown.score,
      aggregateMetrics,
      user.primaryPosition,
      user.secondaryPosition,
    );
    this.logPowerDebug(userId, 'lane_spread_adjustment', {
      before: lanePowerBreakdown.lanePowerBeforeSpread,
      after: lanePowerBreakdown.lanePower,
      multiplier: lanePowerBreakdown.spreadMultiplier,
    });

    const inhouseStats = await this.prismaService.inhousePlayerStat.findMany({
      where: {
        userId,
        statStatus: {
          in: [ResultStatus.PARTIAL, ResultStatus.CONFIRMED, ResultStatus.DISPUTED],
        },
      },
      include: {
        match: {
          include: {
            result: true,
            players: {
              include: {
                user: {
                  include: {
                    powerProfile: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    const seedRoleMmr = POWER_ROLES.reduce<Record<PowerRole, number>>((acc, role) => {
      acc[role] = this.powerToRating(lanePowerBreakdown.lanePower[role]);
      return acc;
    }, {} as Record<PowerRole, number>);
    const inhouseMmrBreakdown = this.inhouseMmrCalculator.calculate({
      userId,
      seedRoleMmr,
      primaryPosition: user.primaryPosition,
      secondaryPosition: user.secondaryPosition,
      stats: inhouseStats
        .filter((stat) => stat.match.result && stat.match.result.winningTeam !== null)
        .map((stat) => ({
          matchId: stat.matchId,
          userId: stat.userId,
          role: stat.role,
          teamSide: stat.teamSide,
          laneResult: stat.laneResult,
          contributionRating: stat.contributionRating,
          statStatus: stat.statStatus,
          createdAt: stat.createdAt,
          match: {
            createdAt: stat.match.createdAt,
            result: stat.match.result,
            players: stat.match.players,
          },
        })) as InhouseMmrStatInput[],
    });

    const { finalRolePower, overallPower, inhouseConfidence, inhouseWeight, roleBreakdown, overallBreakdown } =
      this.overallPowerCalculator.calculate({
        basePower: basePowerBreakdown.score,
        formScore: formScoreBreakdown.score,
        lanePower: lanePowerBreakdown.lanePower,
        inhouseRoleMmr: inhouseMmrBreakdown.roleMmr,
        confirmedMatchCount: inhouseMmrBreakdown.confirmedMatchCount,
        roleConfirmedMatchCount: inhouseMmrBreakdown.roleConfirmedMatchCount,
        styleScores,
        primaryPosition: user.primaryPosition,
        secondaryPosition: user.secondaryPosition,
      });
    const laneAutoAssignmentBasis = resolveLaneAutoAssignment(
      finalRolePower,
      user.primaryPosition,
      user.secondaryPosition,
    );
    this.logPowerDebug(userId, 'lane_auto_assignment', {
      primary: laneAutoAssignmentBasis.primaryPosition,
      secondary: laneAutoAssignmentBasis.secondaryPosition,
      scores: laneAutoAssignmentBasis.laneScores,
      source: laneAutoAssignmentBasis.source,
      reason: laneAutoAssignmentBasis.reason,
    });
    const calculatedAt = new Date();
    const breakdown = {
      version: POWER_PROFILE_VERSION,
      weights: {
        externalComposite: {
          basePower: 0.6,
          lanePower: 0.25,
          formScore: 0.15,
        },
        overallPower: {
          primaryRole: 0.75,
          secondaryRole: 0.25,
        },
      },
      source: {
        sourceAccountId: sourceAccount?.id ?? null,
        lastSyncAt: sourceAccount?.lastSyncedAt?.toISOString() ?? null,
        rankedSnapshotCollectedAt: rankedSnapshot?.collectedAt.toISOString() ?? null,
        latestStoredRankedSnapshotCollectedAt:
          latestRankedSnapshot?.collectedAt.toISOString() ?? null,
        aggregateSnapshotCollectedAt: aggregateSnapshot?.collectedAt.toISOString() ?? null,
      },
      basePower: basePowerBreakdown,
      formScore: formScoreBreakdown,
      lanePower: {
        formula: lanePowerBreakdown.formula,
        laneAdjustments: lanePowerBreakdown.laneAdjustments,
        lanePowerBeforeSpread: lanePowerBreakdown.lanePowerBeforeSpread,
        spreadAdjustments: lanePowerBreakdown.spreadAdjustments,
        spreadMultiplier: lanePowerBreakdown.spreadMultiplier,
        roles: lanePowerBreakdown.roles,
      },
      laneAutoAssignmentBasis,
      inhouse: {
        ...inhouseMmrBreakdown,
        inhouseWeight,
      },
      finalRolePower: {
        roles: roleBreakdown,
        overall: overallBreakdown,
      },
      displayScore: this.buildDisplayScoreDebug({
        overallPower,
        version: POWER_PROFILE_VERSION,
        calculatedAt,
      }),
    };

    await this.prismaService.playerPowerProfile.upsert({
      where: { userId },
      update: {
        sourceAccountId: sourceAccount?.id,
        basePower: basePowerBreakdown.score,
        formScore: formScoreBreakdown.score,
        styleScoresJson: styleScores,
        inhouseMmr: inhouseMmrBreakdown.overallMmr,
        inhouseConfidence,
        lanePowerJson: finalRolePower,
        breakdownJson: toPrismaJson(breakdown),
        overallPower,
        version: POWER_PROFILE_VERSION,
        confirmedMatchCount: inhouseMmrBreakdown.confirmedMatchCount,
        calculatedAt,
      },
      create: {
        userId,
        sourceAccountId: sourceAccount?.id,
        basePower: basePowerBreakdown.score,
        formScore: formScoreBreakdown.score,
        styleScoresJson: styleScores,
        inhouseMmr: inhouseMmrBreakdown.overallMmr,
        inhouseConfidence,
        lanePowerJson: finalRolePower,
        breakdownJson: toPrismaJson(breakdown),
        overallPower,
        version: POWER_PROFILE_VERSION,
        confirmedMatchCount: inhouseMmrBreakdown.confirmedMatchCount,
      },
    });
  }

  async getPowerMapForUsers(userIds: string[]): Promise<
    Map<
      string,
      {
        overallPower: number;
        lanePower: Record<string, number>;
      }
    >
  > {
    let profiles = await this.prismaService.playerPowerProfile.findMany({
      where: { userId: { in: userIds } },
      include: {
        sourceAccount: {
          select: {
            lastSyncedAt: true,
          },
        },
      },
    });

    const staleUserIds = profiles
      .filter((profile) => this.shouldRefreshProfile(profile))
      .map((profile) => profile.userId);

    for (const staleUserId of staleUserIds) {
      await this.recalculateProfile(staleUserId);
    }

    if (staleUserIds.length > 0) {
      profiles = await this.prismaService.playerPowerProfile.findMany({
        where: { userId: { in: userIds } },
        include: {
          sourceAccount: {
            select: {
              lastSyncedAt: true,
            },
          },
        },
      });
    }

    return new Map(
      profiles.map((profile) => [
        profile.userId,
        {
          overallPower: profile.overallPower,
          lanePower: normalizeLanePower(profile.overallPower, profile.lanePowerJson ?? null),
        },
      ]),
    );
  }

  private async toResponse(profile: {
    userId: string;
    overallPower: number;
    lanePowerJson: unknown;
    breakdownJson: unknown;
    styleScoresJson: unknown;
    basePower: number;
    formScore: number;
    inhouseMmr: number;
    inhouseConfidence: number;
    user?: {
      primaryPosition: Position | null;
      secondaryPosition: Position | null;
    };
    sourceAccount?: {
      id?: string;
    } | null;
    version: string;
    calculatedAt: Date;
  }): Promise<PowerProfileResponseDto> {
    const explanation = {
      ...((profile.breakdownJson as Record<string, unknown> | null) ?? {}),
    };
    const lanePower = normalizeLanePower(profile.overallPower, profile.lanePowerJson ?? null);
    const laneAutoAssignmentBasis = resolveLaneAutoAssignment(
      lanePower,
      profile.user?.primaryPosition ?? null,
      profile.user?.secondaryPosition ?? null,
    );
    explanation.laneAutoAssignmentBasis =
      explanation.laneAutoAssignmentBasis ?? laneAutoAssignmentBasis;
    explanation.displayScore =
      explanation.displayScore ??
      buildPowerProfileDisplayScore({
        overallPower: profile.overallPower,
        version: profile.version,
        calculatedAt: profile.calculatedAt,
      });
    const inhouseWeight = Number(
      (explanation.inhouse as { inhouseWeight?: number } | undefined)?.inhouseWeight ?? 0.15,
    );
    const style = normalizeStyleScores(profile.styleScoresJson, {
      overallPower: profile.overallPower,
      lanePower,
      primaryPosition: laneAutoAssignmentBasis.primaryPosition,
    });
    const championSummary = await this.riotChampionSummaryService.getTopChampionSummaryForUser(
      profile.userId,
      profile.sourceAccount?.id ?? null,
    );

    return {
      userId: profile.userId,
      overallPower: profile.overallPower,
      lanePower,
      style,
      basePower: profile.basePower,
      formScore: profile.formScore,
      inhouseMmr: profile.inhouseMmr,
      inhouseConfidence: profile.inhouseConfidence,
      inhouseWeight,
      primaryPosition: laneAutoAssignmentBasis.primaryPosition,
      secondaryPosition: laneAutoAssignmentBasis.secondaryPosition,
      explanation,
      version: profile.version,
      calculatedAt: profile.calculatedAt.toISOString(),
      topChampions: championSummary.topChampions,
      topChampionAggregationStatus: championSummary.aggregationStatus,
    };
  }

  private async findProfileForResponse(userId: string) {
    return this.prismaService.playerPowerProfile.findUnique({
      where: { userId },
      include: {
        user: {
          select: {
            primaryPosition: true,
            secondaryPosition: true,
          },
        },
        sourceAccount: {
          select: {
            id: true,
            lastSyncedAt: true,
          },
        },
      },
    });
  }

  private shouldRefreshProfile(profile: {
    version: string;
    calculatedAt: Date;
    breakdownJson: unknown;
    sourceAccount?: {
      lastSyncedAt: Date | null;
    } | null;
  }): boolean {
    if (profile.version !== POWER_PROFILE_VERSION) {
      return true;
    }

    if (
      profile.sourceAccount?.lastSyncedAt &&
      profile.calculatedAt.getTime() < profile.sourceAccount.lastSyncedAt.getTime()
    ) {
      return true;
    }

    const explanation = (profile.breakdownJson as Record<string, unknown> | null) ?? {};
    return explanation.displayScore === undefined;
  }

  private buildDisplayScoreDebug(input: {
    overallPower: number;
    version: string;
    calculatedAt: Date;
  }) {
    return buildPowerProfileDisplayScore(input);
  }

  private powerToRating(power: number): number {
    return Number((1000 + power * 10).toFixed(2));
  }

  private logPowerDebug(
    userId: string,
    action: string,
    details: Record<string, unknown>,
  ): void {
    const serialized = Object.entries(details)
      .map(([key, value]) => `${key}=${this.formatLogValue(value)}`)
      .join(' ');
    this.logger.debug(`[PowerDebug] userId=${userId} action=${action} ${serialized}`);
  }

  private formatLogValue(value: unknown): string {
    if (value === null || value === undefined) {
      return 'null';
    }
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    return String(value);
  }
}
