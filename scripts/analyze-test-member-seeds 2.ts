import { readFileSync } from 'node:fs';
import path from 'node:path';

import { PrismaClient } from '@prisma/client';

const TEST_MEMBER_FIXTURE_EMAILS = [
  'dev_mock_aaa33@inhouse.local',
  'dev_mock_top_hyeon@inhouse.local',
  'dev_mock_jungle_min@inhouse.local',
  'dev_mock_mid_su@inhouse.local',
  'dev_mock_adc_jun@inhouse.local',
  'dev_mock_support_ho@inhouse.local',
  'dev_mock_top_yeong@inhouse.local',
  'dev_mock_jungle_a@inhouse.local',
  'dev_mock_adc_ram@inhouse.local',
  'dev_mock_support_bin@inhouse.local',
] as const;

const TEST_MEMBER_FIXTURE_NICKNAMES = [
  'aaa33',
  '탑현',
  '정글민',
  '미드수',
  '원딜준',
  '서폿호',
  '탑영',
  '정글아',
  '원딜람',
  '서폿빈',
] as const;

function loadEnv() {
  if (process.env.DATABASE_URL) {
    return;
  }

  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const envPath = path.resolve(process.cwd(), `.env.${nodeEnv}`);
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

function hasUnsafeReferences(counts: {
  authIdentities: number;
  riotAccounts: number;
  ownedGroups: number;
  createdMatches: number;
  matchPlayers: number;
  playerStats: number;
  submittedMatchResults: number;
  mvpMatchResults: number;
  adminResolvedMatchResults: number;
  resultConfirmations: number;
  notifications: number;
  createdRecruitingPosts: number;
  recruitingApplications: number;
  auditLogs: number;
}): boolean {
  return Object.values(counts).some((count) => count > 0);
}

async function main() {
  loadEnv();

  const prisma = new PrismaClient();
  await prisma.$connect();

  try {
    console.log('[TestDataCleanup] feature=test_member_injection removed=true');

    const [fixtureUsers, ambiguousNicknameMatches] = await Promise.all([
      prisma.user.findMany({
        where: {
          email: {
            in: [...TEST_MEMBER_FIXTURE_EMAILS],
          },
        },
        select: {
          id: true,
          email: true,
          nickname: true,
          _count: {
            select: {
              authIdentities: true,
              riotAccounts: true,
              ownedGroups: true,
              createdMatches: true,
              matchPlayers: true,
              playerStats: true,
              submittedMatchResults: true,
              mvpMatchResults: true,
              adminResolvedMatchResults: true,
              resultConfirmations: true,
              notifications: true,
              createdRecruitingPosts: true,
              recruitingApplications: true,
              auditLogs: true,
            },
          },
        },
        orderBy: {
          email: 'asc',
        },
      }),
      prisma.user.findMany({
        where: {
          nickname: {
            in: [...TEST_MEMBER_FIXTURE_NICKNAMES],
          },
          email: {
            notIn: [...TEST_MEMBER_FIXTURE_EMAILS],
          },
        },
        select: {
          id: true,
          email: true,
          nickname: true,
        },
        orderBy: {
          nickname: 'asc',
        },
      }),
    ]);

    const removable =
      ambiguousNicknameMatches.length === 0 &&
      fixtureUsers.every((user) => !hasUnsafeReferences(user._count));

    console.log(
      `[TestDataCleanup] existingSeededRecords detected=${fixtureUsers.length} removable=${removable}`,
    );

    if (ambiguousNicknameMatches.length > 0) {
      console.log(
        `[TestDataCleanup] existingSeededRecords purgeExecuted=false reason=marker_not_safe ambiguousNicknameMatches=${ambiguousNicknameMatches.length}`,
      );
    } else if (!removable) {
      console.log(
        '[TestDataCleanup] existingSeededRecords purgeExecuted=false reason=live_references_present',
      );
    } else {
      console.log(
        '[TestDataCleanup] existingSeededRecords purgeExecuted=false reason=dry_run_default',
      );
    }

    if (fixtureUsers.length > 0) {
      console.table(
        fixtureUsers.map((user) => ({
          email: user.email,
          nickname: user.nickname,
          authIdentities: user._count.authIdentities,
          riotAccounts: user._count.riotAccounts,
          ownedGroups: user._count.ownedGroups,
          createdMatches: user._count.createdMatches,
          matchPlayers: user._count.matchPlayers,
          playerStats: user._count.playerStats,
          submittedMatchResults: user._count.submittedMatchResults,
          resultConfirmations: user._count.resultConfirmations,
          notifications: user._count.notifications,
          createdRecruitingPosts: user._count.createdRecruitingPosts,
          recruitingApplications: user._count.recruitingApplications,
          auditLogs: user._count.auditLogs,
        })),
      );
    }

    if (ambiguousNicknameMatches.length > 0) {
      console.table(ambiguousNicknameMatches);
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
