import { readFileSync } from 'node:fs';
import path from 'node:path';

import axios from 'axios';
import { HttpService } from '@nestjs/axios';
import { Position, SnapshotType, VerificationStatus } from '@prisma/client';

import { AuditLogService } from '../src/common/audit-log.service';
import { resolveEnvFilePath } from '../src/config/runtime-env';
import { PrismaService } from '../src/prisma/prisma.service';
import { BasePowerCalculator } from '../src/power/calculators/base-power.calculator';
import { FormScoreCalculator } from '../src/power/calculators/form-score.calculator';
import { InhouseMmrCalculator } from '../src/power/calculators/inhouse-mmr.calculator';
import { LanePowerCalculator } from '../src/power/calculators/lane-power.calculator';
import { OverallPowerCalculator } from '../src/power/calculators/overall-power.calculator';
import { StyleScoreCalculator } from '../src/power/calculators/style-score.calculator';
import { PowerService } from '../src/power/power.service';
import { QueueService } from '../src/queue/queue.service';
import { RiotApiClient } from '../src/riot/riot-api.client';
import { RiotService } from '../src/riot/riot.service';

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

const trackedAccounts = [
  {
    riotGameName: '섭쥬비',
    tagLine: 'KR1',
    region: 'kr',
    fallbackUserId: 'seed_user_top',
  },
  {
    riotGameName: '생딸기트리설빙',
    tagLine: '950',
    region: 'kr',
    fallbackUserId: 'cmo0bg75e00088zekulqqr0ef',
  },
] as const;

function createConfigService() {
  return {
    getOrThrow(key: string) {
      const value = process.env[key];
      if (!value) {
        throw new Error(`Missing env ${key}`);
      }
      return value;
    },
    get<T>(key: string, fallback?: T): T | undefined {
      return (process.env[key] as T | undefined) ?? fallback;
    },
  };
}

function createQueueStub(): QueueService {
  return {
    enqueuePowerRecalculation: async () => undefined,
    enqueueRiotAccountInitialSync: async () => undefined,
    enqueueRiotAccountRefresh: async () => undefined,
    cancelRiotSyncJobs: async () => 0,
    enqueueFinalizeResultConfirmation: async () => undefined,
    enqueueNotification: async () => undefined,
    getQueuesHealth: async () => 'ok',
  } as unknown as QueueService;
}

async function ensureRiotAccount(
  prisma: PrismaService,
  riotApiClient: RiotApiClient,
  input: (typeof trackedAccounts)[number],
) {
  const resolved = await riotApiClient.resolveAccountByRiotId(
    input.riotGameName,
    input.tagLine,
    process.env.RIOT_ACCOUNT_REGION,
  );

  const existing = await prisma.riotAccount.findUnique({
    where: {
      userId_puuid: {
        userId: input.fallbackUserId,
        puuid: resolved.puuid,
      },
    },
  });
  if (existing) {
    return existing;
  }

  return prisma.riotAccount.create({
    data: {
      userId: input.fallbackUserId,
      riotGameName: input.riotGameName,
      tagLine: input.tagLine,
      region: input.region,
      puuid: resolved.puuid,
      isPrimary: true,
      verificationStatus: VerificationStatus.CLAIMED,
    },
  });
}

async function latestRankedSnapshot(prisma: PrismaService, riotAccountId: string) {
  return prisma.riotAccountSnapshot.findFirst({
    where: {
      riotAccountId,
      snapshotType: SnapshotType.RANKED,
    },
    orderBy: { collectedAt: 'desc' },
  });
}

async function main() {
  loadEnv();

  const prisma = new PrismaService();
  await prisma.$connect();

  const configService = createConfigService();
  const httpService = new HttpService(axios);
  const auditLogService = new AuditLogService(prisma);
  const riotApiClient = new RiotApiClient(httpService, configService as never);
  const riotService = new RiotService(
    prisma,
    riotApiClient,
    createQueueStub(),
    auditLogService,
    configService as never,
  );
  const powerService = new PowerService(
    prisma,
    {
      assertCanAccessUserScopedResource: async () => undefined,
    } as never,
    new BasePowerCalculator(),
    new FormScoreCalculator(),
    new InhouseMmrCalculator(),
    new LanePowerCalculator(),
    new StyleScoreCalculator(),
    new OverallPowerCalculator(),
  );

  try {
    const report: Array<Record<string, unknown>> = [];

    for (const tracked of trackedAccounts) {
      const account = await ensureRiotAccount(prisma, riotApiClient, tracked);
      const beforeSnapshot = await latestRankedSnapshot(prisma, account.id);
      const beforeState = await prisma.riotAccount.findUniqueOrThrow({ where: { id: account.id } });

      console.log(`\n=== sync ${tracked.riotGameName}#${tracked.tagLine} (${account.id}) ===`);
      await riotService.syncAccount(account.id);
      await powerService.recalculateProfile(account.userId);

      const afterState = await prisma.riotAccount.findUniqueOrThrow({ where: { id: account.id } });
      const afterSnapshot = await latestRankedSnapshot(prisma, account.id);
      const profile = await powerService.getProfile(account.userId, account.userId);
      const explanation = profile.explanation as Record<string, any>;
      const rankedMetrics = (afterSnapshot?.metricsJson as Record<string, any> | null) ?? {};
      const queues = Array.isArray(rankedMetrics.queues) ? rankedMetrics.queues : [];
      const solo = queues.find((entry: any) => entry.queueType === 'RANKED_SOLO_5x5') ?? null;
      const flex = queues.find((entry: any) => entry.queueType === 'RANKED_FLEX_SR') ?? null;
      const display = (explanation.displayScore as Record<string, any> | undefined) ?? {};

      report.push({
        riotId: `${tracked.riotGameName}#${tracked.tagLine}`,
        userId: account.userId,
        puuid: account.puuid,
        encryptedSummonerId: afterState.summonerId,
        rankedSnapshotSavedBefore: Boolean(beforeSnapshot),
        rankedSnapshotSavedAfter: Boolean(afterSnapshot),
        rankedSnapshotCollectedAt: afterSnapshot?.collectedAt.toISOString() ?? null,
        soloTier: solo?.tier ?? null,
        soloRank: solo?.rank ?? null,
        soloLp: solo?.lp ?? null,
        flexTier: flex?.tier ?? null,
        flexRank: flex?.rank ?? null,
        flexLp: flex?.lp ?? null,
        powerOverall: profile.overallPower,
        displayScore: display.clientDisplayRounded ?? Math.round(profile.overallPower),
        finalReasonSummary: explanation.basePower?.finalReasonSummary ?? null,
        version: profile.version,
        warningCodeBefore: beforeState.lastSyncWarningCode,
        warningCodeAfter: afterState.lastSyncWarningCode,
      });
    }

    console.table(report);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
