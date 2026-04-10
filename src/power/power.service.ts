import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Position, ResultStatus, SnapshotType } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { BasePowerCalculator } from './calculators/base-power.calculator';
import { FormScoreCalculator } from './calculators/form-score.calculator';
import { LanePowerCalculator } from './calculators/lane-power.calculator';
import { OverallPowerCalculator } from './calculators/overall-power.calculator';
import { StyleScoreCalculator } from './calculators/style-score.calculator';
import { PowerProfileResponseDto } from './dto/power-profile.dto';

@Injectable()
export class PowerService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly usersService: UsersService,
    private readonly basePowerCalculator: BasePowerCalculator,
    private readonly formScoreCalculator: FormScoreCalculator,
    private readonly lanePowerCalculator: LanePowerCalculator,
    private readonly styleScoreCalculator: StyleScoreCalculator,
    private readonly overallPowerCalculator: OverallPowerCalculator,
  ) {}

  async getProfile(
    requesterUserId: string,
    userId: string,
  ): Promise<PowerProfileResponseDto> {
    await this.usersService.assertCanAccessUserScopedResource(requesterUserId, userId);

    const profile = await this.prismaService.playerPowerProfile.findUnique({
      where: { userId },
    });

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
              take: 20,
            },
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    const sourceAccount = user.riotAccounts[0];
    const rankedSnapshot = sourceAccount?.snapshots.find(
      (snapshot) => snapshot.snapshotType === SnapshotType.RANKED,
    );
    const aggregateSnapshot = sourceAccount?.snapshots.find(
      (snapshot) => snapshot.snapshotType === SnapshotType.AGGREGATED,
    );

    const basePower = this.basePowerCalculator.calculate(
      rankedSnapshot?.metricsJson as Record<string, unknown> | null,
    );
    const formScore = this.formScoreCalculator.calculate(
      aggregateSnapshot?.metricsJson as Record<string, unknown> | null,
    );
    const styleScores = this.styleScoreCalculator.calculate(
      aggregateSnapshot?.metricsJson as Record<string, unknown> | null,
    );

    const confirmedStats = await this.prismaService.inhousePlayerStat.findMany({
      where: {
        userId,
        statStatus: ResultStatus.CONFIRMED,
      },
      include: {
        match: {
          include: {
            result: true,
          },
        },
      },
    });

    const confirmedMatchCount = confirmedStats.length;
    const inhouseMmr = confirmedStats.reduce((rating, stat) => {
      const didWin = stat.match.result?.winningTeam === stat.teamSide ? 1 : -1;
      const laneDelta =
        stat.laneResult === 'WIN' ? 4 : stat.laneResult === 'LOSE' ? -4 : 0;
      const balanceAdjustment = Number(stat.match.result?.balanceRating ?? 3) - 3;
      return rating + didWin * 18 + laneDelta + balanceAdjustment;
    }, 1500);

    const lanePower = this.lanePowerCalculator.calculate(
      basePower,
      aggregateSnapshot?.metricsJson as Record<string, unknown> | null,
    );

    const { finalRolePower, overallPower, inhouseConfidence } =
      this.overallPowerCalculator.calculate({
        basePower,
        formScore,
        lanePower,
        inhouseMmr,
        confirmedMatchCount,
        styleScores,
        primaryPosition: user.primaryPosition,
        secondaryPosition: user.secondaryPosition,
      });

    await this.prismaService.playerPowerProfile.upsert({
      where: { userId },
      update: {
        sourceAccountId: sourceAccount?.id,
        basePower,
        formScore,
        styleScoresJson: styleScores,
        inhouseMmr,
        inhouseConfidence,
        lanePowerJson: finalRolePower,
        overallPower,
        version: 'v1',
        confirmedMatchCount,
        calculatedAt: new Date(),
      },
      create: {
        userId,
        sourceAccountId: sourceAccount?.id,
        basePower,
        formScore,
        styleScoresJson: styleScores,
        inhouseMmr,
        inhouseConfidence,
        lanePowerJson: finalRolePower,
        overallPower,
        version: 'v1',
        confirmedMatchCount,
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
    const profiles = await this.prismaService.playerPowerProfile.findMany({
      where: { userId: { in: userIds } },
    });

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
    styleScoresJson: unknown;
    basePower: number;
    formScore: number;
    inhouseMmr: number;
    inhouseConfidence: number;
    version: string;
    calculatedAt: Date;
  }): PowerProfileResponseDto {
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
      version: profile.version,
      calculatedAt: profile.calculatedAt.toISOString(),
    };
  }
}

