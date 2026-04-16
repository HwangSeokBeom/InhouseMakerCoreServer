import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Position, ResultStatus, SnapshotType } from '@prisma/client';

import { toPrismaJson } from '../common/prisma-json.util';
import { PrismaService } from '../prisma/prisma.service';
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
import { PowerProfileResponseDto } from './dto/power-profile.dto';
import { POWER_PROFILE_VERSION, POWER_ROLES, PowerRole } from './power.constants';

@Injectable()
export class PowerService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly usersService: UsersService,
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
        roles: lanePowerBreakdown.roles,
      },
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
          lanePower:
            (profile.lanePowerJson as Record<string, number> | null) ??
            this.defaultLanePower(profile.overallPower),
        },
      ]),
    );
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

  private toResponse(profile: {
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
    version: string;
    calculatedAt: Date;
  }): PowerProfileResponseDto {
    const explanation = {
      ...((profile.breakdownJson as Record<string, unknown> | null) ?? {}),
    };
    explanation.displayScore =
      explanation.displayScore ??
      this.buildDisplayScoreDebug({
        overallPower: profile.overallPower,
        version: profile.version,
        calculatedAt: profile.calculatedAt,
      });
    const inhouseWeight = Number(
      (explanation.inhouse as { inhouseWeight?: number } | undefined)?.inhouseWeight ?? 0.15,
    );

    return {
      userId: profile.userId,
      overallPower: profile.overallPower,
      lanePower: (profile.lanePowerJson as Record<string, number> | null) ?? {},
      style:
        (profile.styleScoresJson as {
          stability: number;
          carry: number;
          teamContribution: number;
          laneInfluence: number;
        } | null) ?? {
          stability: 50,
          carry: 50,
          teamContribution: 50,
          laneInfluence: 50,
        },
      basePower: profile.basePower,
      formScore: profile.formScore,
      inhouseMmr: profile.inhouseMmr,
      inhouseConfidence: profile.inhouseConfidence,
      inhouseWeight,
      primaryPosition: profile.user?.primaryPosition ?? null,
      secondaryPosition: profile.user?.secondaryPosition ?? null,
      explanation,
      version: profile.version,
      calculatedAt: profile.calculatedAt.toISOString(),
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
    return {
      sourceField: 'overallPower',
      serverStoredOverallPower: Number(input.overallPower.toFixed(2)),
      dtoOverallPower: Number(input.overallPower.toFixed(2)),
      clientDisplayRaw: Number(input.overallPower.toFixed(2)),
      clientDisplayRounded: Math.round(input.overallPower),
      roundingMode: 'rounded()',
      profileVersion: input.version,
      profileCalculatedAt: input.calculatedAt.toISOString(),
    };
  }

  private powerToRating(power: number): number {
    return Number((1000 + power * 10).toFixed(2));
  }
}
