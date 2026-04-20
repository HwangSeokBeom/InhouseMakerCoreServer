import { readFileSync } from 'node:fs';
import path from 'node:path';

import { SnapshotType } from '@prisma/client';

import { resolveEnvFilePath } from '../src/config/runtime-env';
import { BasePowerCalculator } from '../src/power/calculators/base-power.calculator';
import { FormScoreCalculator } from '../src/power/calculators/form-score.calculator';
import { InhouseMmrCalculator } from '../src/power/calculators/inhouse-mmr.calculator';
import { LanePowerCalculator } from '../src/power/calculators/lane-power.calculator';
import { OverallPowerCalculator } from '../src/power/calculators/overall-power.calculator';
import { StyleScoreCalculator } from '../src/power/calculators/style-score.calculator';
import { PowerService } from '../src/power/power.service';
import { POWER_PROFILE_VERSION, POWER_ROLES } from '../src/power/power.constants';
import { PrismaService } from '../src/prisma/prisma.service';

function loadEnv() {
  if (process.env.DATABASE_URL) {
    return;
  }

  const envPath = path.resolve(process.cwd(), resolveEnvFilePath());
  const envFile = readFileSync(envPath, 'utf8');

  for (const line of envFile.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex);
    const value = line.slice(separatorIndex + 1);
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function readOption(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return null;
  }

  return process.argv[index + 1] ?? null;
}

function shouldRecalculate(profile: {
  version: string;
  breakdownJson: unknown;
}): boolean {
  if (profile.version !== POWER_PROFILE_VERSION) {
    return true;
  }

  const explanation = (profile.breakdownJson as Record<string, unknown> | null) ?? {};
  return explanation.displayScore === undefined;
}

async function main() {
  loadEnv();

  const prisma = new PrismaService();
  await prisma.$connect();

  const powerService = new PowerService(
    prisma,
    {} as never,
    new BasePowerCalculator(),
    new FormScoreCalculator(),
    new InhouseMmrCalculator(),
    new LanePowerCalculator(),
    new StyleScoreCalculator(),
    new OverallPowerCalculator(),
  );
  const basePowerCalculator = new BasePowerCalculator();

  try {
    const userId = readOption('--user');
    let profiles = await prisma.playerPowerProfile.findMany({
      where: userId ? { userId } : undefined,
      include: {
        user: {
          select: {
            nickname: true,
            primaryPosition: true,
            secondaryPosition: true,
          },
        },
        sourceAccount: {
          include: {
            snapshots: {
              orderBy: { collectedAt: 'desc' },
              take: 10,
            },
          },
        },
      },
      orderBy: { calculatedAt: 'desc' },
    });

    if (hasFlag('--recalculate-stale')) {
      for (const profile of profiles) {
        if (shouldRecalculate(profile)) {
          await powerService.recalculateProfile(profile.userId);
        }
      }

      profiles = await prisma.playerPowerProfile.findMany({
        where: userId ? { userId } : undefined,
        include: {
          user: {
            select: {
              nickname: true,
              primaryPosition: true,
              secondaryPosition: true,
            },
          },
          sourceAccount: {
            include: {
              snapshots: {
                orderBy: { collectedAt: 'desc' },
                take: 10,
              },
            },
          },
        },
        orderBy: { calculatedAt: 'desc' },
      });
    }

    const rows = profiles.map((profile) => {
      const explanation = (profile.breakdownJson as Record<string, any> | null) ?? {};
      const baseBreakdown = (explanation.basePower as Record<string, any> | undefined) ?? {};
      const finalRole = (explanation.finalRolePower as Record<string, any> | undefined) ?? {};
      const roleDetails = (finalRole.roles as Record<string, any> | undefined) ?? {};
      const overallDetails = (finalRole.overall as Record<string, any> | undefined) ?? {};
      const displayScore = (explanation.displayScore as Record<string, any> | undefined) ?? {};
      const rankedSnapshots = profile.sourceAccount?.snapshots.filter(
        (snapshot) => snapshot.snapshotType === SnapshotType.RANKED,
      ) ?? [];
      const latestRankedSnapshot = rankedSnapshots[0] ?? null;
      const isCurrentSnapshot = latestRankedSnapshot
        ? basePowerCalculator.isCurrentRankSnapshot(
            latestRankedSnapshot.collectedAt,
            profile.sourceAccount?.lastSyncedAt ?? null,
          )
        : false;
      const currentRank = isCurrentSnapshot ? latestRankedSnapshot : null;

      return {
        userId: profile.userId,
        nickname: profile.user.nickname,
        version: profile.version,
        currentTier: currentRank?.tier ?? '-',
        currentRank: currentRank?.rank ?? '-',
        currentLp: currentRank?.lp ?? '-',
        overallPower: Number(profile.overallPower.toFixed(2)),
        displayedScore: Math.round(profile.overallPower),
        basePower: Number(profile.basePower.toFixed(2)),
        soloRankScore: baseBreakdown.soloRankScore ?? null,
        historicalRankScore: baseBreakdown.historicalRankScore ?? null,
        flexRankScore: baseBreakdown.flexRankScore ?? null,
        rankCompositeBeforeClamp: baseBreakdown.rankCompositeBeforeClamp ?? null,
        overallPowerBeforeClamp: overallDetails.overallPowerBeforeClamp ?? null,
        overallPowerAfterClamp: overallDetails.overallPowerAfterClamp ?? null,
        reason: baseBreakdown.finalReasonSummary ?? null,
        sourceField: displayScore.sourceField ?? 'overallPower',
        dtoOverallPower: displayScore.dtoOverallPower ?? Number(profile.overallPower.toFixed(2)),
        clientDisplayRounded: displayScore.clientDisplayRounded ?? Math.round(profile.overallPower),
      };
    });

    console.table(rows);

    if (hasFlag('--json')) {
      const detailed = profiles.map((profile) => {
        const explanation = (profile.breakdownJson as Record<string, unknown> | null) ?? {};
        const finalRolePower = (explanation.finalRolePower as Record<string, any> | undefined) ?? {};
        const roleRows = Object.fromEntries(
          POWER_ROLES.map((role) => [
            role,
            finalRolePower.roles?.[role]
              ? {
                  basePowerContribution: finalRolePower.roles[role].basePowerContribution,
                  laneContribution: finalRolePower.roles[role].laneContribution,
                  formContribution: finalRolePower.roles[role].formContribution,
                  stabilityContribution: finalRolePower.roles[role].stabilityContribution,
                  externalCompositeBeforeClamp: finalRolePower.roles[role].externalCompositeBeforeClamp,
                  finalRolePowerBeforeClamp: finalRolePower.roles[role].finalRolePowerBeforeClamp,
                  finalRolePowerAfterClamp: finalRolePower.roles[role].finalRolePowerAfterClamp,
                }
              : null,
          ]),
        );

        return {
          userId: profile.userId,
          nickname: profile.user.nickname,
          overallPower: profile.overallPower,
          displayedScore: Math.round(profile.overallPower),
          explanation: {
            basePower: explanation.basePower,
            finalRolePower: {
              roles: roleRows,
              overall: finalRolePower.overall ?? null,
            },
            displayScore: explanation.displayScore ?? null,
          },
        };
      });

      console.log(JSON.stringify(detailed, null, 2));
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
