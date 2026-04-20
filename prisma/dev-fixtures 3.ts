import {
  AuthProvider,
  ConfirmationAction,
  GroupRole,
  GroupVisibility,
  InputMode,
  JoinPolicy,
  LaneResult,
  MatchStatus,
  NotificationStatus,
  NotificationType,
  ParticipationStatus,
  Position,
  Prisma,
  PrismaClient,
  RecruitingPostStatus,
  RecruitingPostType,
  ResultStatus,
  RiotSyncStatus,
  SnapshotType,
  TeamSide,
  VerificationStatus,
} from '@prisma/client';
import { hash } from 'bcryptjs';

import { POWER_PROFILE_VERSION } from '../src/power/power.constants';

const PASSWORD_SALT_ROUNDS = 10;

export const DEV_FIXTURE_IDS = {
  users: {
    default: 'dev_user_default',
    empty: 'dev_user_empty',
    leader: 'dev_user_leader',
    member: 'dev_user_member',
    recruiter: 'dev_user_recruiter',
    profile: 'dev_user_profile',
    top: 'dev_user_top',
    jungle: 'dev_user_jungle',
    adc: 'dev_user_adc',
    support: 'dev_user_support',
    flex: 'dev_user_flex',
  },
  groups: {
    publicClash: 'dev_group_public_clash',
    privateNight: 'dev_group_private_night',
    teamLab: 'dev_group_team_lab',
  },
  recruitingPosts: {
    publicMid: 'dev_post_public_mid',
    publicScrim: 'dev_post_public_scrim',
    publicClosed: 'dev_post_public_closed',
    privateSupport: 'dev_post_private_support',
    privateClosed: 'dev_post_private_closed',
  },
  matches: {
    publicUpcoming: 'dev_match_public_upcoming',
    privateBalanced: 'dev_match_private_balanced',
    teamLabUpcoming: 'dev_match_team_lab_upcoming',
    publicConfirmed: 'dev_match_public_confirmed',
    privateClosed: 'dev_match_private_closed',
    publicPending: 'dev_match_public_pending',
  },
  results: {
    publicConfirmed: 'dev_result_public_confirmed',
    privateClosed: 'dev_result_private_closed',
    publicPending: 'dev_result_public_pending',
  },
  notifications: {
    defaultResultPending: 'dev_notification_default_result_pending',
    defaultRecruiting: 'dev_notification_default_recruiting',
    leaderApplicant: 'dev_notification_leader_applicant',
  },
} as const;

export const DEV_UI_FIXTURE_SCENARIOS = {
  default_populated_user: {
    userId: DEV_FIXTURE_IDS.users.default,
    email: 'dev.default@example.com',
    description:
      '홈 카드, 최근 그룹, 공개/비공개 그룹 상세, 모집 상세, 전적/결과, 파워 프로필을 한 계정에서 폭넓게 확인할 수 있는 기본 시나리오',
    accessibleGroupIds: [
      DEV_FIXTURE_IDS.groups.publicClash,
      DEV_FIXTURE_IDS.groups.privateNight,
      DEV_FIXTURE_IDS.groups.teamLab,
    ],
    highlightMatchIds: [
      DEV_FIXTURE_IDS.matches.publicUpcoming,
      DEV_FIXTURE_IDS.matches.privateBalanced,
      DEV_FIXTURE_IDS.matches.publicConfirmed,
      DEV_FIXTURE_IDS.matches.publicPending,
    ],
    highlightRecruitingPostIds: [
      DEV_FIXTURE_IDS.recruitingPosts.publicMid,
      DEV_FIXTURE_IDS.recruitingPosts.privateSupport,
    ],
    riotLinked: true,
    hasPowerProfile: true,
  },
  empty_user: {
    userId: DEV_FIXTURE_IDS.users.empty,
    email: 'dev.empty@example.com',
    description:
      '그룹 없음, Riot 계정 없음, 전적 없음, 알림 없음 상태를 확인하는 빈 화면 시나리오',
    accessibleGroupIds: [],
    highlightMatchIds: [],
    highlightRecruitingPostIds: [],
    riotLinked: false,
    hasPowerProfile: false,
  },
  leader_user: {
    userId: DEV_FIXTURE_IDS.users.leader,
    email: 'dev.leader@example.com',
    description:
      '공개/비공개 그룹 리더 권한, 비공개 모집글 상세, 지원자 목록 확인에 적합한 리더 시나리오',
    accessibleGroupIds: [
      DEV_FIXTURE_IDS.groups.publicClash,
      DEV_FIXTURE_IDS.groups.privateNight,
      DEV_FIXTURE_IDS.groups.teamLab,
    ],
    highlightMatchIds: [
      DEV_FIXTURE_IDS.matches.privateBalanced,
      DEV_FIXTURE_IDS.matches.privateClosed,
    ],
    highlightRecruitingPostIds: [
      DEV_FIXTURE_IDS.recruitingPosts.privateSupport,
      DEV_FIXTURE_IDS.recruitingPosts.publicClosed,
    ],
    riotLinked: true,
    hasPowerProfile: true,
  },
  member_user: {
    userId: DEV_FIXTURE_IDS.users.member,
    email: 'dev.member@example.com',
    description:
      '그룹 멤버 관점에서 최근 매치, 그룹 상세, 모집 참여 상태를 확인하는 시나리오',
    accessibleGroupIds: [
      DEV_FIXTURE_IDS.groups.publicClash,
      DEV_FIXTURE_IDS.groups.privateNight,
      DEV_FIXTURE_IDS.groups.teamLab,
    ],
    highlightMatchIds: [
      DEV_FIXTURE_IDS.matches.publicUpcoming,
      DEV_FIXTURE_IDS.matches.publicConfirmed,
    ],
    highlightRecruitingPostIds: [
      DEV_FIXTURE_IDS.recruitingPosts.publicMid,
      DEV_FIXTURE_IDS.recruitingPosts.privateSupport,
    ],
    riotLinked: true,
    hasPowerProfile: true,
  },
  recruiting_heavy_user: {
    userId: DEV_FIXTURE_IDS.users.recruiter,
    email: 'dev.recruiter@example.com',
    description:
      '여러 공개 모집글과 태그/포지션/예정 시간 조합을 집중적으로 확인하는 모집 중심 시나리오',
    accessibleGroupIds: [
      DEV_FIXTURE_IDS.groups.publicClash,
      DEV_FIXTURE_IDS.groups.teamLab,
    ],
    highlightMatchIds: [DEV_FIXTURE_IDS.matches.teamLabUpcoming],
    highlightRecruitingPostIds: [
      DEV_FIXTURE_IDS.recruitingPosts.publicMid,
      DEV_FIXTURE_IDS.recruitingPosts.publicScrim,
      DEV_FIXTURE_IDS.recruitingPosts.publicClosed,
    ],
    riotLinked: true,
    hasPowerProfile: true,
  },
  profile_connected_user: {
    userId: DEV_FIXTURE_IDS.users.profile,
    email: 'dev.profile@example.com',
    description:
      'Riot 계정 연결, 파워 프로필, 전적 통계를 중심으로 프로필 화면을 확인하는 시나리오',
    accessibleGroupIds: [
      DEV_FIXTURE_IDS.groups.publicClash,
      DEV_FIXTURE_IDS.groups.privateNight,
      DEV_FIXTURE_IDS.groups.teamLab,
    ],
    highlightMatchIds: [
      DEV_FIXTURE_IDS.matches.publicConfirmed,
      DEV_FIXTURE_IDS.matches.privateClosed,
    ],
    highlightRecruitingPostIds: [DEV_FIXTURE_IDS.recruitingPosts.publicMid],
    riotLinked: true,
    hasPowerProfile: true,
  },
} as const;

export type DevFixtureScenarioName = keyof typeof DEV_UI_FIXTURE_SCENARIOS;

const REQUIRED_SCENARIOS = Object.keys(
  DEV_UI_FIXTURE_SCENARIOS,
) as DevFixtureScenarioName[];

const MANAGED_USER_IDS = Object.values(DEV_FIXTURE_IDS.users);
const MANAGED_GROUP_IDS = Object.values(DEV_FIXTURE_IDS.groups);
const MANAGED_POST_IDS = Object.values(DEV_FIXTURE_IDS.recruitingPosts);
const MANAGED_MATCH_IDS = Object.values(DEV_FIXTURE_IDS.matches);
const MANAGED_RESULT_IDS = Object.values(DEV_FIXTURE_IDS.results);
const MANAGED_NOTIFICATION_IDS = Object.values(DEV_FIXTURE_IDS.notifications);

function atUtc(anchor: Date, dayOffset: number, hour: number, minute = 0): Date {
  const date = new Date(anchor);
  date.setUTCDate(date.getUTCDate() + dayOffset);
  date.setUTCHours(hour, minute, 0, 0);
  return date;
}

function iso(date: Date): string {
  return date.toISOString();
}

function lanePower(top: number, jungle: number, mid: number, adc: number, support: number) {
  return {
    [Position.TOP]: top,
    [Position.JUNGLE]: jungle,
    [Position.MID]: mid,
    [Position.ADC]: adc,
    [Position.SUPPORT]: support,
  };
}

function buildPowerBreakdown(overallPower: number, calculatedAt: Date) {
  return {
    version: POWER_PROFILE_VERSION,
    displayScore: {
      overallPower,
      version: POWER_PROFILE_VERSION,
      calculatedAt: iso(calculatedAt),
      seeded: true,
    },
    inhouse: {
      inhouseWeight: 0.2,
      source: 'development_fixture',
    },
  };
}

export function resolveDevFixturePassword(): string {
  return process.env.DEV_SEED_PASSWORD ?? 'DevSeed1234';
}

export function buildDevFixturePlan(anchor: Date = new Date()) {
  const createdAt = atUtc(anchor, -10, 12);
  const syncedAt = atUtc(anchor, -1, 10);
  const calculatedAt = atUtc(anchor, -1, 11);
  const upcomingOne = atUtc(anchor, 2, 11);
  const upcomingTwo = atUtc(anchor, 4, 12, 30);
  const upcomingThree = atUtc(anchor, 6, 13);
  const recentOne = atUtc(anchor, -2, 11);
  const recentTwo = atUtc(anchor, -5, 10);
  const recentPending = atUtc(anchor, -1, 19, 30);

  const users = [
    {
      id: DEV_FIXTURE_IDS.users.default,
      email: 'dev.default@example.com',
      nickname: 'PenDefault',
      primaryPosition: Position.MID,
      secondaryPosition: Position.ADC,
      isFillAvailable: false,
      styleTags: ['shotcaller', 'macro'],
      mannerScore: 98,
      noshowCount: 0,
      isAdmin: false,
    },
    {
      id: DEV_FIXTURE_IDS.users.empty,
      email: 'dev.empty@example.com',
      nickname: 'PenEmpty',
      primaryPosition: Position.TOP,
      secondaryPosition: Position.JUNGLE,
      isFillAvailable: false,
      styleTags: ['quiet'],
      mannerScore: 100,
      noshowCount: 0,
      isAdmin: false,
    },
    {
      id: DEV_FIXTURE_IDS.users.leader,
      email: 'dev.leader@example.com',
      nickname: 'PenLeader',
      primaryPosition: Position.SUPPORT,
      secondaryPosition: Position.TOP,
      isFillAvailable: true,
      styleTags: ['captain', 'teamplay'],
      mannerScore: 97,
      noshowCount: 0,
      isAdmin: false,
    },
    {
      id: DEV_FIXTURE_IDS.users.member,
      email: 'dev.member@example.com',
      nickname: 'PenMember',
      primaryPosition: Position.TOP,
      secondaryPosition: Position.MID,
      isFillAvailable: true,
      styleTags: ['stable', 'weakside'],
      mannerScore: 96,
      noshowCount: 0,
      isAdmin: false,
    },
    {
      id: DEV_FIXTURE_IDS.users.recruiter,
      email: 'dev.recruiter@example.com',
      nickname: 'PenRecruit',
      primaryPosition: Position.ADC,
      secondaryPosition: Position.SUPPORT,
      isFillAvailable: false,
      styleTags: ['aggro', 'playmaker'],
      mannerScore: 95,
      noshowCount: 0,
      isAdmin: false,
    },
    {
      id: DEV_FIXTURE_IDS.users.profile,
      email: 'dev.profile@example.com',
      nickname: 'PenProfile',
      primaryPosition: Position.JUNGLE,
      secondaryPosition: Position.MID,
      isFillAvailable: true,
      styleTags: ['tempo', 'roam'],
      mannerScore: 99,
      noshowCount: 0,
      isAdmin: false,
    },
    {
      id: DEV_FIXTURE_IDS.users.top,
      email: 'dev.top@example.com',
      nickname: 'PenTop',
      primaryPosition: Position.TOP,
      secondaryPosition: Position.JUNGLE,
      isFillAvailable: false,
      styleTags: ['lane', 'frontline'],
      mannerScore: 95,
      noshowCount: 1,
      isAdmin: false,
    },
    {
      id: DEV_FIXTURE_IDS.users.jungle,
      email: 'dev.jungle@example.com',
      nickname: 'PenJungle',
      primaryPosition: Position.JUNGLE,
      secondaryPosition: Position.SUPPORT,
      isFillAvailable: true,
      styleTags: ['gank', 'vision'],
      mannerScore: 97,
      noshowCount: 0,
      isAdmin: false,
    },
    {
      id: DEV_FIXTURE_IDS.users.adc,
      email: 'dev.adc@example.com',
      nickname: 'PenADC',
      primaryPosition: Position.ADC,
      secondaryPosition: Position.MID,
      isFillAvailable: false,
      styleTags: ['scaling', 'teamfight'],
      mannerScore: 94,
      noshowCount: 0,
      isAdmin: false,
    },
    {
      id: DEV_FIXTURE_IDS.users.support,
      email: 'dev.support@example.com',
      nickname: 'PenSupport',
      primaryPosition: Position.SUPPORT,
      secondaryPosition: Position.ADC,
      isFillAvailable: true,
      styleTags: ['vision', 'peel'],
      mannerScore: 98,
      noshowCount: 0,
      isAdmin: false,
    },
    {
      id: DEV_FIXTURE_IDS.users.flex,
      email: 'dev.flex@example.com',
      nickname: 'PenFlex',
      primaryPosition: Position.FILL,
      secondaryPosition: Position.MID,
      isFillAvailable: true,
      styleTags: ['adaptable', 'scrim'],
      mannerScore: 96,
      noshowCount: 0,
      isAdmin: false,
    },
  ] as const;

  const riotAccounts = [
    {
      id: 'dev_riot_default',
      userId: DEV_FIXTURE_IDS.users.default,
      riotGameName: 'PenDefault',
      tagLine: 'KR1',
      region: 'kr',
      puuid: 'dev-puuid-default',
      isPrimary: true,
      verificationStatus: VerificationStatus.GROUP_VERIFIED,
      syncStatus: RiotSyncStatus.SUCCEEDED,
      lastSyncedAt: syncedAt,
      lastSyncRequestedAt: atUtc(anchor, -1, 9, 45),
      lastSyncSucceededAt: syncedAt,
      profileIconId: 321,
      summonerLevel: 418,
    },
    {
      id: 'dev_riot_leader',
      userId: DEV_FIXTURE_IDS.users.leader,
      riotGameName: 'PenLeader',
      tagLine: 'KR1',
      region: 'kr',
      puuid: 'dev-puuid-leader',
      isPrimary: true,
      verificationStatus: VerificationStatus.GROUP_VERIFIED,
      syncStatus: RiotSyncStatus.SUCCEEDED,
      lastSyncedAt: syncedAt,
      lastSyncRequestedAt: atUtc(anchor, -1, 9, 40),
      lastSyncSucceededAt: syncedAt,
      profileIconId: 287,
      summonerLevel: 361,
    },
    {
      id: 'dev_riot_member',
      userId: DEV_FIXTURE_IDS.users.member,
      riotGameName: 'PenMember',
      tagLine: 'KR1',
      region: 'kr',
      puuid: 'dev-puuid-member',
      isPrimary: true,
      verificationStatus: VerificationStatus.GROUP_VERIFIED,
      syncStatus: RiotSyncStatus.SUCCEEDED,
      lastSyncedAt: syncedAt,
      lastSyncRequestedAt: atUtc(anchor, -1, 9, 41),
      lastSyncSucceededAt: syncedAt,
      profileIconId: 144,
      summonerLevel: 295,
    },
    {
      id: 'dev_riot_recruiter',
      userId: DEV_FIXTURE_IDS.users.recruiter,
      riotGameName: 'PenRecruit',
      tagLine: 'KR1',
      region: 'kr',
      puuid: 'dev-puuid-recruiter',
      isPrimary: true,
      verificationStatus: VerificationStatus.GROUP_VERIFIED,
      syncStatus: RiotSyncStatus.SUCCEEDED,
      lastSyncedAt: syncedAt,
      lastSyncRequestedAt: atUtc(anchor, -1, 9, 42),
      lastSyncSucceededAt: syncedAt,
      profileIconId: 411,
      summonerLevel: 372,
    },
    {
      id: 'dev_riot_profile',
      userId: DEV_FIXTURE_IDS.users.profile,
      riotGameName: 'PenProfile',
      tagLine: 'KR1',
      region: 'kr',
      puuid: 'dev-puuid-profile',
      isPrimary: true,
      verificationStatus: VerificationStatus.GROUP_VERIFIED,
      syncStatus: RiotSyncStatus.SUCCEEDED,
      lastSyncedAt: syncedAt,
      lastSyncRequestedAt: atUtc(anchor, -1, 9, 43),
      lastSyncSucceededAt: syncedAt,
      profileIconId: 518,
      summonerLevel: 433,
    },
    {
      id: 'dev_riot_top',
      userId: DEV_FIXTURE_IDS.users.top,
      riotGameName: 'PenTop',
      tagLine: 'KR1',
      region: 'kr',
      puuid: 'dev-puuid-top',
      isPrimary: true,
      verificationStatus: VerificationStatus.CLAIMED,
      syncStatus: RiotSyncStatus.SUCCEEDED,
      lastSyncedAt: syncedAt,
      lastSyncRequestedAt: atUtc(anchor, -1, 9, 44),
      lastSyncSucceededAt: syncedAt,
      profileIconId: 77,
      summonerLevel: 250,
    },
    {
      id: 'dev_riot_jungle',
      userId: DEV_FIXTURE_IDS.users.jungle,
      riotGameName: 'PenJungle',
      tagLine: 'KR1',
      region: 'kr',
      puuid: 'dev-puuid-jungle',
      isPrimary: true,
      verificationStatus: VerificationStatus.CLAIMED,
      syncStatus: RiotSyncStatus.SUCCEEDED,
      lastSyncedAt: syncedAt,
      lastSyncRequestedAt: atUtc(anchor, -1, 9, 44),
      lastSyncSucceededAt: syncedAt,
      profileIconId: 123,
      summonerLevel: 309,
    },
    {
      id: 'dev_riot_adc',
      userId: DEV_FIXTURE_IDS.users.adc,
      riotGameName: 'PenADC',
      tagLine: 'KR1',
      region: 'kr',
      puuid: 'dev-puuid-adc',
      isPrimary: true,
      verificationStatus: VerificationStatus.CLAIMED,
      syncStatus: RiotSyncStatus.SUCCEEDED,
      lastSyncedAt: syncedAt,
      lastSyncRequestedAt: atUtc(anchor, -1, 9, 44),
      lastSyncSucceededAt: syncedAt,
      profileIconId: 201,
      summonerLevel: 280,
    },
    {
      id: 'dev_riot_support',
      userId: DEV_FIXTURE_IDS.users.support,
      riotGameName: 'PenSupport',
      tagLine: 'KR1',
      region: 'kr',
      puuid: 'dev-puuid-support',
      isPrimary: true,
      verificationStatus: VerificationStatus.CLAIMED,
      syncStatus: RiotSyncStatus.SUCCEEDED,
      lastSyncedAt: syncedAt,
      lastSyncRequestedAt: atUtc(anchor, -1, 9, 44),
      lastSyncSucceededAt: syncedAt,
      profileIconId: 63,
      summonerLevel: 344,
    },
    {
      id: 'dev_riot_flex',
      userId: DEV_FIXTURE_IDS.users.flex,
      riotGameName: 'PenFlex',
      tagLine: 'KR1',
      region: 'kr',
      puuid: 'dev-puuid-flex',
      isPrimary: true,
      verificationStatus: VerificationStatus.CLAIMED,
      syncStatus: RiotSyncStatus.SUCCEEDED,
      lastSyncedAt: syncedAt,
      lastSyncRequestedAt: atUtc(anchor, -1, 9, 44),
      lastSyncSucceededAt: syncedAt,
      profileIconId: 29,
      summonerLevel: 236,
    },
  ] as const;

  const riotSnapshots = riotAccounts.flatMap((account) => [
    {
      id: `${account.id}_ranked`,
      riotAccountId: account.id,
      snapshotType: SnapshotType.RANKED,
      sampleSize: 1,
      tier:
        account.userId === DEV_FIXTURE_IDS.users.profile
          ? 'DIAMOND'
          : account.userId === DEV_FIXTURE_IDS.users.default
            ? 'EMERALD'
            : 'PLATINUM',
      rank: account.userId === DEV_FIXTURE_IDS.users.profile ? 'III' : 'I',
      lp: account.userId === DEV_FIXTURE_IDS.users.profile ? 72 : 46,
      metricsJson: {
        queueType: 'RANKED_SOLO_5x5',
        seeded: true,
      },
    },
    {
      id: `${account.id}_aggregate`,
      riotAccountId: account.id,
      snapshotType: SnapshotType.AGGREGATED,
      sampleSize: 12,
      metricsJson: {
        sampleSize: 12,
        recentWinRate: 0.58,
        recentKda: 3.1,
        averageVisionScore: 24,
        averageKillParticipation: 0.61,
        seeded: true,
      },
    },
  ]);

  const powerProfiles = [
    {
      userId: DEV_FIXTURE_IDS.users.default,
      sourceAccountId: 'dev_riot_default',
      basePower: 71.2,
      formScore: 74.1,
      inhouseMmr: 1532,
      inhouseConfidence: 0.42,
      lanePowerJson: lanePower(65, 69, 79, 74, 61),
      styleScoresJson: {
        stability: 72,
        carry: 76,
        teamContribution: 71,
        laneInfluence: 78,
      },
      overallPower: 76.4,
      confirmedMatchCount: 2,
    },
    {
      userId: DEV_FIXTURE_IDS.users.leader,
      sourceAccountId: 'dev_riot_leader',
      basePower: 68.4,
      formScore: 69.7,
      inhouseMmr: 1518,
      inhouseConfidence: 0.38,
      lanePowerJson: lanePower(61, 63, 65, 62, 75),
      styleScoresJson: {
        stability: 74,
        carry: 58,
        teamContribution: 83,
        laneInfluence: 69,
      },
      overallPower: 72.3,
      confirmedMatchCount: 2,
    },
    {
      userId: DEV_FIXTURE_IDS.users.member,
      sourceAccountId: 'dev_riot_member',
      basePower: 64.9,
      formScore: 66.5,
      inhouseMmr: 1497,
      inhouseConfidence: 0.35,
      lanePowerJson: lanePower(71, 60, 66, 59, 57),
      styleScoresJson: {
        stability: 70,
        carry: 60,
        teamContribution: 63,
        laneInfluence: 61,
      },
      overallPower: 69.2,
      confirmedMatchCount: 2,
    },
    {
      userId: DEV_FIXTURE_IDS.users.recruiter,
      sourceAccountId: 'dev_riot_recruiter',
      basePower: 70.1,
      formScore: 72.8,
      inhouseMmr: 1521,
      inhouseConfidence: 0.37,
      lanePowerJson: lanePower(58, 61, 68, 77, 72),
      styleScoresJson: {
        stability: 67,
        carry: 79,
        teamContribution: 69,
        laneInfluence: 74,
      },
      overallPower: 74.1,
      confirmedMatchCount: 2,
    },
    {
      userId: DEV_FIXTURE_IDS.users.profile,
      sourceAccountId: 'dev_riot_profile',
      basePower: 77.4,
      formScore: 80.2,
      inhouseMmr: 1564,
      inhouseConfidence: 0.51,
      lanePowerJson: lanePower(66, 82, 78, 68, 64),
      styleScoresJson: {
        stability: 75,
        carry: 81,
        teamContribution: 72,
        laneInfluence: 84,
      },
      overallPower: 80.7,
      confirmedMatchCount: 2,
    },
    {
      userId: DEV_FIXTURE_IDS.users.top,
      sourceAccountId: 'dev_riot_top',
      basePower: 66.3,
      formScore: 65.2,
      inhouseMmr: 1492,
      inhouseConfidence: 0.28,
      lanePowerJson: lanePower(73, 63, 58, 55, 50),
      styleScoresJson: {
        stability: 69,
        carry: 64,
        teamContribution: 56,
        laneInfluence: 68,
      },
      overallPower: 68.9,
      confirmedMatchCount: 2,
    },
    {
      userId: DEV_FIXTURE_IDS.users.jungle,
      sourceAccountId: 'dev_riot_jungle',
      basePower: 67.9,
      formScore: 69.1,
      inhouseMmr: 1503,
      inhouseConfidence: 0.28,
      lanePowerJson: lanePower(57, 74, 61, 58, 63),
      styleScoresJson: {
        stability: 66,
        carry: 68,
        teamContribution: 71,
        laneInfluence: 77,
      },
      overallPower: 70.3,
      confirmedMatchCount: 2,
    },
    {
      userId: DEV_FIXTURE_IDS.users.adc,
      sourceAccountId: 'dev_riot_adc',
      basePower: 65.8,
      formScore: 67.8,
      inhouseMmr: 1498,
      inhouseConfidence: 0.28,
      lanePowerJson: lanePower(54, 57, 62, 73, 58),
      styleScoresJson: {
        stability: 65,
        carry: 75,
        teamContribution: 60,
        laneInfluence: 63,
      },
      overallPower: 69.5,
      confirmedMatchCount: 2,
    },
    {
      userId: DEV_FIXTURE_IDS.users.support,
      sourceAccountId: 'dev_riot_support',
      basePower: 64.2,
      formScore: 68.4,
      inhouseMmr: 1496,
      inhouseConfidence: 0.28,
      lanePowerJson: lanePower(50, 58, 55, 60, 74),
      styleScoresJson: {
        stability: 73,
        carry: 52,
        teamContribution: 80,
        laneInfluence: 66,
      },
      overallPower: 68.2,
      confirmedMatchCount: 2,
    },
    {
      userId: DEV_FIXTURE_IDS.users.flex,
      sourceAccountId: 'dev_riot_flex',
      basePower: 63.7,
      formScore: 64.9,
      inhouseMmr: 1488,
      inhouseConfidence: 0.24,
      lanePowerJson: lanePower(59, 62, 66, 61, 60),
      styleScoresJson: {
        stability: 64,
        carry: 61,
        teamContribution: 62,
        laneInfluence: 65,
      },
      overallPower: 67.4,
      confirmedMatchCount: 2,
    },
  ].map((profile) => ({
    ...profile,
    version: POWER_PROFILE_VERSION,
    calculatedAt,
    breakdownJson: buildPowerBreakdown(profile.overallPower, calculatedAt),
  }));

  const groups = [
    {
      id: DEV_FIXTURE_IDS.groups.publicClash,
      ownerUserId: DEV_FIXTURE_IDS.users.leader,
      name: 'Public Clash Hub',
      region: 'kr',
      description: '공개 모집과 예정된 내전이 꾸준히 올라오는 공개 인하우스 그룹',
      visibility: GroupVisibility.PUBLIC,
      joinPolicy: JoinPolicy.OPEN,
      tags: ['public', 'night', 'competitive'],
    },
    {
      id: DEV_FIXTURE_IDS.groups.privateNight,
      ownerUserId: DEV_FIXTURE_IDS.users.leader,
      name: 'Private Night Five',
      region: 'kr',
      description: '초대 전용 비공개 스크림 그룹',
      visibility: GroupVisibility.PRIVATE,
      joinPolicy: JoinPolicy.INVITE_ONLY,
      tags: ['private', 'scrim', 'trusted'],
    },
    {
      id: DEV_FIXTURE_IDS.groups.teamLab,
      ownerUserId: DEV_FIXTURE_IDS.users.recruiter,
      name: 'Team Lab Seoul',
      region: 'kr',
      description: '포지션별 실험 조합과 공개 모집이 많은 테스트 그룹',
      visibility: GroupVisibility.PUBLIC,
      joinPolicy: JoinPolicy.APPROVAL_REQUIRED,
      tags: ['public', 'experiment', 'weekend'],
    },
  ] as const;

  const groupMembers = [
    { groupId: DEV_FIXTURE_IDS.groups.publicClash, userId: DEV_FIXTURE_IDS.users.leader, role: GroupRole.OWNER },
    { groupId: DEV_FIXTURE_IDS.groups.publicClash, userId: DEV_FIXTURE_IDS.users.default, role: GroupRole.ADMIN },
    { groupId: DEV_FIXTURE_IDS.groups.publicClash, userId: DEV_FIXTURE_IDS.users.member, role: GroupRole.MEMBER },
    { groupId: DEV_FIXTURE_IDS.groups.publicClash, userId: DEV_FIXTURE_IDS.users.recruiter, role: GroupRole.ADMIN },
    { groupId: DEV_FIXTURE_IDS.groups.publicClash, userId: DEV_FIXTURE_IDS.users.profile, role: GroupRole.MEMBER },
    { groupId: DEV_FIXTURE_IDS.groups.publicClash, userId: DEV_FIXTURE_IDS.users.top, role: GroupRole.MEMBER },
    { groupId: DEV_FIXTURE_IDS.groups.publicClash, userId: DEV_FIXTURE_IDS.users.jungle, role: GroupRole.MEMBER },
    { groupId: DEV_FIXTURE_IDS.groups.publicClash, userId: DEV_FIXTURE_IDS.users.adc, role: GroupRole.MEMBER },
    { groupId: DEV_FIXTURE_IDS.groups.publicClash, userId: DEV_FIXTURE_IDS.users.support, role: GroupRole.MEMBER },
    { groupId: DEV_FIXTURE_IDS.groups.publicClash, userId: DEV_FIXTURE_IDS.users.flex, role: GroupRole.MEMBER },
    { groupId: DEV_FIXTURE_IDS.groups.privateNight, userId: DEV_FIXTURE_IDS.users.leader, role: GroupRole.OWNER },
    { groupId: DEV_FIXTURE_IDS.groups.privateNight, userId: DEV_FIXTURE_IDS.users.default, role: GroupRole.MEMBER },
    { groupId: DEV_FIXTURE_IDS.groups.privateNight, userId: DEV_FIXTURE_IDS.users.member, role: GroupRole.MEMBER },
    { groupId: DEV_FIXTURE_IDS.groups.privateNight, userId: DEV_FIXTURE_IDS.users.profile, role: GroupRole.MEMBER },
    { groupId: DEV_FIXTURE_IDS.groups.privateNight, userId: DEV_FIXTURE_IDS.users.top, role: GroupRole.MEMBER },
    { groupId: DEV_FIXTURE_IDS.groups.privateNight, userId: DEV_FIXTURE_IDS.users.jungle, role: GroupRole.MEMBER },
    { groupId: DEV_FIXTURE_IDS.groups.privateNight, userId: DEV_FIXTURE_IDS.users.adc, role: GroupRole.MEMBER },
    { groupId: DEV_FIXTURE_IDS.groups.privateNight, userId: DEV_FIXTURE_IDS.users.support, role: GroupRole.ADMIN },
    { groupId: DEV_FIXTURE_IDS.groups.privateNight, userId: DEV_FIXTURE_IDS.users.flex, role: GroupRole.MEMBER },
    { groupId: DEV_FIXTURE_IDS.groups.teamLab, userId: DEV_FIXTURE_IDS.users.recruiter, role: GroupRole.OWNER },
    { groupId: DEV_FIXTURE_IDS.groups.teamLab, userId: DEV_FIXTURE_IDS.users.default, role: GroupRole.MEMBER },
    { groupId: DEV_FIXTURE_IDS.groups.teamLab, userId: DEV_FIXTURE_IDS.users.member, role: GroupRole.MEMBER },
    { groupId: DEV_FIXTURE_IDS.groups.teamLab, userId: DEV_FIXTURE_IDS.users.leader, role: GroupRole.MEMBER },
    { groupId: DEV_FIXTURE_IDS.groups.teamLab, userId: DEV_FIXTURE_IDS.users.profile, role: GroupRole.MEMBER },
  ] as const;

  const recruitingPosts = [
    {
      id: DEV_FIXTURE_IDS.recruitingPosts.publicMid,
      groupId: DEV_FIXTURE_IDS.groups.publicClash,
      createdBy: DEV_FIXTURE_IDS.users.recruiter,
      postType: RecruitingPostType.MEMBER_RECRUIT,
      title: '토요일 공개 내전, 미드/서폿 2명 구해요',
      body: '저녁 8시 시작 예정입니다. 디스코드 가능하고 오더 가능한 분 우대합니다.',
      tags: ['weekend', 'voice', 'public'],
      requiredPositionsJson: [Position.MID, Position.SUPPORT],
      scheduledAt: upcomingOne,
      status: RecruitingPostStatus.OPEN,
    },
    {
      id: DEV_FIXTURE_IDS.recruitingPosts.publicScrim,
      groupId: DEV_FIXTURE_IDS.groups.teamLab,
      createdBy: DEV_FIXTURE_IDS.users.recruiter,
      postType: RecruitingPostType.OPPONENT_RECRUIT,
      title: '일요일 팀랩 스크림 상대 모집',
      body: '5전제 스크림 상대를 찾습니다. 밴픽 피드백까지 가능하면 좋습니다.',
      tags: ['scrim', 'weekend', 'analysis'],
      requiredPositionsJson: [Position.TOP],
      scheduledAt: upcomingThree,
      status: RecruitingPostStatus.OPEN,
    },
    {
      id: DEV_FIXTURE_IDS.recruitingPosts.publicClosed,
      groupId: DEV_FIXTURE_IDS.groups.publicClash,
      createdBy: DEV_FIXTURE_IDS.users.leader,
      postType: RecruitingPostType.MEMBER_RECRUIT,
      title: '마감된 공개 모집 예시',
      body: '이미 인원이 꽉 찬 모집글입니다.',
      tags: ['closed', 'weekday'],
      requiredPositionsJson: [Position.ADC],
      scheduledAt: recentPending,
      status: RecruitingPostStatus.CLOSED,
    },
    {
      id: DEV_FIXTURE_IDS.recruitingPosts.privateSupport,
      groupId: DEV_FIXTURE_IDS.groups.privateNight,
      createdBy: DEV_FIXTURE_IDS.users.leader,
      postType: RecruitingPostType.MEMBER_RECRUIT,
      title: '비공개 야간 스크림 서폿/정글 보강',
      body: '비공개 그룹 멤버만 신청 가능합니다. 결과 피드백까지 진행합니다.',
      tags: ['private', 'night', 'serious'],
      requiredPositionsJson: [Position.JUNGLE, Position.SUPPORT],
      scheduledAt: upcomingTwo,
      status: RecruitingPostStatus.OPEN,
    },
    {
      id: DEV_FIXTURE_IDS.recruitingPosts.privateClosed,
      groupId: DEV_FIXTURE_IDS.groups.privateNight,
      createdBy: DEV_FIXTURE_IDS.users.leader,
      postType: RecruitingPostType.OPPONENT_RECRUIT,
      title: '마감된 비공개 상대 모집 예시',
      body: '비공개 그룹 내부 테스트용 마감 상태 모집글입니다.',
      tags: ['private', 'closed'],
      requiredPositionsJson: [Position.TOP],
      scheduledAt: recentTwo,
      status: RecruitingPostStatus.CLOSED,
    },
  ] as const;

  const recruitingApplications = [
    { postId: DEV_FIXTURE_IDS.recruitingPosts.publicMid, userId: DEV_FIXTURE_IDS.users.default },
    { postId: DEV_FIXTURE_IDS.recruitingPosts.publicMid, userId: DEV_FIXTURE_IDS.users.member },
    { postId: DEV_FIXTURE_IDS.recruitingPosts.publicScrim, userId: DEV_FIXTURE_IDS.users.profile },
    { postId: DEV_FIXTURE_IDS.recruitingPosts.privateSupport, userId: DEV_FIXTURE_IDS.users.member },
    { postId: DEV_FIXTURE_IDS.recruitingPosts.privateSupport, userId: DEV_FIXTURE_IDS.users.profile },
  ] as const;

  const balancedPlayers = [
    {
      userId: DEV_FIXTURE_IDS.users.top,
      riotAccountId: 'dev_riot_top',
      teamSide: TeamSide.A,
      assignedRole: Position.TOP,
      participationStatus: ParticipationStatus.LOCKED_IN,
      isCaptain: false,
    },
    {
      userId: DEV_FIXTURE_IDS.users.jungle,
      riotAccountId: 'dev_riot_jungle',
      teamSide: TeamSide.A,
      assignedRole: Position.JUNGLE,
      participationStatus: ParticipationStatus.LOCKED_IN,
      isCaptain: false,
    },
    {
      userId: DEV_FIXTURE_IDS.users.default,
      riotAccountId: 'dev_riot_default',
      teamSide: TeamSide.A,
      assignedRole: Position.MID,
      participationStatus: ParticipationStatus.LOCKED_IN,
      isCaptain: true,
    },
    {
      userId: DEV_FIXTURE_IDS.users.recruiter,
      riotAccountId: 'dev_riot_recruiter',
      teamSide: TeamSide.A,
      assignedRole: Position.ADC,
      participationStatus: ParticipationStatus.LOCKED_IN,
      isCaptain: false,
    },
    {
      userId: DEV_FIXTURE_IDS.users.leader,
      riotAccountId: 'dev_riot_leader',
      teamSide: TeamSide.A,
      assignedRole: Position.SUPPORT,
      participationStatus: ParticipationStatus.LOCKED_IN,
      isCaptain: true,
    },
    {
      userId: DEV_FIXTURE_IDS.users.member,
      riotAccountId: 'dev_riot_member',
      teamSide: TeamSide.B,
      assignedRole: Position.TOP,
      participationStatus: ParticipationStatus.LOCKED_IN,
      isCaptain: false,
    },
    {
      userId: DEV_FIXTURE_IDS.users.profile,
      riotAccountId: 'dev_riot_profile',
      teamSide: TeamSide.B,
      assignedRole: Position.JUNGLE,
      participationStatus: ParticipationStatus.LOCKED_IN,
      isCaptain: true,
    },
    {
      userId: DEV_FIXTURE_IDS.users.flex,
      riotAccountId: 'dev_riot_flex',
      teamSide: TeamSide.B,
      assignedRole: Position.MID,
      participationStatus: ParticipationStatus.LOCKED_IN,
      isCaptain: false,
    },
    {
      userId: DEV_FIXTURE_IDS.users.adc,
      riotAccountId: 'dev_riot_adc',
      teamSide: TeamSide.B,
      assignedRole: Position.ADC,
      participationStatus: ParticipationStatus.LOCKED_IN,
      isCaptain: false,
    },
    {
      userId: DEV_FIXTURE_IDS.users.support,
      riotAccountId: 'dev_riot_support',
      teamSide: TeamSide.B,
      assignedRole: Position.SUPPORT,
      participationStatus: ParticipationStatus.LOCKED_IN,
      isCaptain: false,
    },
  ] as const;

  const recruitingPlayers = [
    {
      userId: DEV_FIXTURE_IDS.users.default,
      riotAccountId: 'dev_riot_default',
      participationStatus: ParticipationStatus.ACCEPTED,
      isCaptain: true,
    },
    {
      userId: DEV_FIXTURE_IDS.users.leader,
      riotAccountId: 'dev_riot_leader',
      participationStatus: ParticipationStatus.ACCEPTED,
      isCaptain: false,
    },
    {
      userId: DEV_FIXTURE_IDS.users.member,
      riotAccountId: 'dev_riot_member',
      participationStatus: ParticipationStatus.ACCEPTED,
      isCaptain: false,
    },
    {
      userId: DEV_FIXTURE_IDS.users.recruiter,
      riotAccountId: 'dev_riot_recruiter',
      participationStatus: ParticipationStatus.ACCEPTED,
      isCaptain: false,
    },
    {
      userId: DEV_FIXTURE_IDS.users.profile,
      riotAccountId: 'dev_riot_profile',
      participationStatus: ParticipationStatus.ACCEPTED,
      isCaptain: false,
    },
    {
      userId: DEV_FIXTURE_IDS.users.top,
      riotAccountId: 'dev_riot_top',
      participationStatus: ParticipationStatus.ACCEPTED,
      isCaptain: false,
    },
  ] as const;

  const matches: Array<{
    id: string;
    groupId: string;
    createdBy: string;
    title: string;
    notes: string;
    status: MatchStatus;
    scheduledAt: Date;
    balanceMode: 'BALANCED' | null;
    selectedCandidateNo: number | null;
    candidatesJson: Prisma.InputJsonValue | typeof Prisma.JsonNull;
  }> = [
    {
      id: DEV_FIXTURE_IDS.matches.publicUpcoming,
      groupId: DEV_FIXTURE_IDS.groups.publicClash,
      createdBy: DEV_FIXTURE_IDS.users.default,
      title: 'Saturday Open Inhouse',
      notes: '홈 예정 경기 카드용 공개 내전',
      status: MatchStatus.RECRUITING,
      scheduledAt: upcomingOne,
      balanceMode: null,
      selectedCandidateNo: null,
      candidatesJson: Prisma.JsonNull,
    },
    {
      id: DEV_FIXTURE_IDS.matches.privateBalanced,
      groupId: DEV_FIXTURE_IDS.groups.privateNight,
      createdBy: DEV_FIXTURE_IDS.users.leader,
      title: 'Private Night Balanced',
      notes: '비공개 그룹 밸런싱 완료 경기',
      status: MatchStatus.BALANCED,
      scheduledAt: upcomingTwo,
      balanceMode: 'BALANCED',
      selectedCandidateNo: 1,
      candidatesJson: [{ candidateNo: 1, seeded: true }],
    },
    {
      id: DEV_FIXTURE_IDS.matches.teamLabUpcoming,
      groupId: DEV_FIXTURE_IDS.groups.teamLab,
      createdBy: DEV_FIXTURE_IDS.users.recruiter,
      title: 'Team Lab Sunday Run',
      notes: '실험 조합 검증용 공개 팀랩 경기',
      status: MatchStatus.RECRUITING,
      scheduledAt: upcomingThree,
      balanceMode: null,
      selectedCandidateNo: null,
      candidatesJson: Prisma.JsonNull,
    },
    {
      id: DEV_FIXTURE_IDS.matches.publicConfirmed,
      groupId: DEV_FIXTURE_IDS.groups.publicClash,
      createdBy: DEV_FIXTURE_IDS.users.default,
      title: 'Friday Public Confirmed',
      notes: '최근 전적과 결과 카드용 확정 경기',
      status: MatchStatus.CONFIRMED,
      scheduledAt: recentOne,
      balanceMode: 'BALANCED',
      selectedCandidateNo: 1,
      candidatesJson: [{ candidateNo: 1, seeded: true }],
    },
    {
      id: DEV_FIXTURE_IDS.matches.privateClosed,
      groupId: DEV_FIXTURE_IDS.groups.privateNight,
      createdBy: DEV_FIXTURE_IDS.users.leader,
      title: 'Private Closed Review',
      notes: '최근 전적 손실 케이스와 비공개 결과 화면 검증용 경기',
      status: MatchStatus.CLOSED,
      scheduledAt: recentTwo,
      balanceMode: 'BALANCED',
      selectedCandidateNo: 1,
      candidatesJson: [{ candidateNo: 1, seeded: true }],
    },
    {
      id: DEV_FIXTURE_IDS.matches.publicPending,
      groupId: DEV_FIXTURE_IDS.groups.publicClash,
      createdBy: DEV_FIXTURE_IDS.users.default,
      title: 'Pending Result Review',
      notes: '결과 입력 후 확인 대기 상태 검증용 경기',
      status: MatchStatus.RESULT_PENDING,
      scheduledAt: recentPending,
      balanceMode: 'BALANCED',
      selectedCandidateNo: 1,
      candidatesJson: [{ candidateNo: 1, seeded: true }],
    },
  ];

  const matchPlayers = [
    ...recruitingPlayers.map((player) => ({
      matchId: DEV_FIXTURE_IDS.matches.publicUpcoming,
      ...player,
      teamSide: null,
      assignedRole: null,
    })),
    ...recruitingPlayers.map((player) => ({
      matchId: DEV_FIXTURE_IDS.matches.teamLabUpcoming,
      ...player,
      teamSide: null,
      assignedRole: null,
    })),
    ...balancedPlayers.map((player) => ({
      matchId: DEV_FIXTURE_IDS.matches.privateBalanced,
      ...player,
    })),
    ...balancedPlayers.map((player) => ({
      matchId: DEV_FIXTURE_IDS.matches.publicConfirmed,
      ...player,
    })),
    ...balancedPlayers.map((player) => ({
      matchId: DEV_FIXTURE_IDS.matches.privateClosed,
      ...player,
    })),
    ...balancedPlayers.map((player) => ({
      matchId: DEV_FIXTURE_IDS.matches.publicPending,
      ...player,
    })),
  ] as const;

  const results = [
    {
      id: DEV_FIXTURE_IDS.results.publicConfirmed,
      matchId: DEV_FIXTURE_IDS.matches.publicConfirmed,
      winningTeam: TeamSide.A,
      mvpUserId: DEV_FIXTURE_IDS.users.default,
      balanceRating: 4,
      resultStatus: ResultStatus.CONFIRMED,
      inputMode: InputMode.QUICK,
      submittedBy: DEV_FIXTURE_IDS.users.default,
      confirmedAt: atUtc(anchor, -2, 14),
      notes: '공개 경기 결과 확정',
      version: 2,
      payloadJson: {
        winningTeam: TeamSide.A,
        seeded: true,
      },
    },
    {
      id: DEV_FIXTURE_IDS.results.privateClosed,
      matchId: DEV_FIXTURE_IDS.matches.privateClosed,
      winningTeam: TeamSide.B,
      mvpUserId: DEV_FIXTURE_IDS.users.profile,
      balanceRating: 5,
      resultStatus: ResultStatus.CONFIRMED,
      inputMode: InputMode.QUICK,
      submittedBy: DEV_FIXTURE_IDS.users.leader,
      confirmedAt: atUtc(anchor, -5, 13),
      notes: '비공개 경기 결과 확정',
      version: 2,
      payloadJson: {
        winningTeam: TeamSide.B,
        seeded: true,
      },
    },
    {
      id: DEV_FIXTURE_IDS.results.publicPending,
      matchId: DEV_FIXTURE_IDS.matches.publicPending,
      winningTeam: TeamSide.B,
      mvpUserId: DEV_FIXTURE_IDS.users.profile,
      balanceRating: 3,
      resultStatus: ResultStatus.PARTIAL,
      inputMode: InputMode.QUICK,
      submittedBy: DEV_FIXTURE_IDS.users.default,
      confirmedAt: null,
      notes: '결과 확인 대기',
      version: 1,
      payloadJson: {
        winningTeam: TeamSide.B,
        seeded: true,
      },
    },
  ] as const;

  const stats = [
    {
      matchId: DEV_FIXTURE_IDS.matches.publicConfirmed,
      userId: DEV_FIXTURE_IDS.users.top,
      teamSide: TeamSide.A,
      role: Position.TOP,
      kills: 4,
      deaths: 3,
      assists: 8,
      laneResult: LaneResult.WIN,
      contributionRating: 4,
      statStatus: ResultStatus.CONFIRMED,
    },
    {
      matchId: DEV_FIXTURE_IDS.matches.publicConfirmed,
      userId: DEV_FIXTURE_IDS.users.jungle,
      teamSide: TeamSide.A,
      role: Position.JUNGLE,
      kills: 5,
      deaths: 4,
      assists: 11,
      laneResult: LaneResult.WIN,
      contributionRating: 4,
      statStatus: ResultStatus.CONFIRMED,
    },
    {
      matchId: DEV_FIXTURE_IDS.matches.publicConfirmed,
      userId: DEV_FIXTURE_IDS.users.default,
      teamSide: TeamSide.A,
      role: Position.MID,
      kills: 9,
      deaths: 2,
      assists: 10,
      laneResult: LaneResult.WIN,
      contributionRating: 5,
      statStatus: ResultStatus.CONFIRMED,
    },
    {
      matchId: DEV_FIXTURE_IDS.matches.publicConfirmed,
      userId: DEV_FIXTURE_IDS.users.recruiter,
      teamSide: TeamSide.A,
      role: Position.ADC,
      kills: 7,
      deaths: 3,
      assists: 9,
      laneResult: LaneResult.EVEN,
      contributionRating: 4,
      statStatus: ResultStatus.CONFIRMED,
    },
    {
      matchId: DEV_FIXTURE_IDS.matches.publicConfirmed,
      userId: DEV_FIXTURE_IDS.users.leader,
      teamSide: TeamSide.A,
      role: Position.SUPPORT,
      kills: 1,
      deaths: 4,
      assists: 16,
      laneResult: LaneResult.EVEN,
      contributionRating: 4,
      statStatus: ResultStatus.CONFIRMED,
    },
    {
      matchId: DEV_FIXTURE_IDS.matches.publicConfirmed,
      userId: DEV_FIXTURE_IDS.users.member,
      teamSide: TeamSide.B,
      role: Position.TOP,
      kills: 3,
      deaths: 6,
      assists: 5,
      laneResult: LaneResult.LOSE,
      contributionRating: 3,
      statStatus: ResultStatus.CONFIRMED,
    },
    {
      matchId: DEV_FIXTURE_IDS.matches.publicConfirmed,
      userId: DEV_FIXTURE_IDS.users.profile,
      teamSide: TeamSide.B,
      role: Position.JUNGLE,
      kills: 6,
      deaths: 5,
      assists: 4,
      laneResult: LaneResult.EVEN,
      contributionRating: 4,
      statStatus: ResultStatus.CONFIRMED,
    },
    {
      matchId: DEV_FIXTURE_IDS.matches.publicConfirmed,
      userId: DEV_FIXTURE_IDS.users.flex,
      teamSide: TeamSide.B,
      role: Position.MID,
      kills: 2,
      deaths: 7,
      assists: 6,
      laneResult: LaneResult.LOSE,
      contributionRating: 2,
      statStatus: ResultStatus.CONFIRMED,
    },
    {
      matchId: DEV_FIXTURE_IDS.matches.publicConfirmed,
      userId: DEV_FIXTURE_IDS.users.adc,
      teamSide: TeamSide.B,
      role: Position.ADC,
      kills: 5,
      deaths: 5,
      assists: 3,
      laneResult: LaneResult.EVEN,
      contributionRating: 3,
      statStatus: ResultStatus.CONFIRMED,
    },
    {
      matchId: DEV_FIXTURE_IDS.matches.publicConfirmed,
      userId: DEV_FIXTURE_IDS.users.support,
      teamSide: TeamSide.B,
      role: Position.SUPPORT,
      kills: 0,
      deaths: 6,
      assists: 9,
      laneResult: LaneResult.LOSE,
      contributionRating: 3,
      statStatus: ResultStatus.CONFIRMED,
    },
    {
      matchId: DEV_FIXTURE_IDS.matches.privateClosed,
      userId: DEV_FIXTURE_IDS.users.top,
      teamSide: TeamSide.A,
      role: Position.TOP,
      kills: 2,
      deaths: 6,
      assists: 4,
      laneResult: LaneResult.LOSE,
      contributionRating: 2,
      statStatus: ResultStatus.CONFIRMED,
    },
    {
      matchId: DEV_FIXTURE_IDS.matches.privateClosed,
      userId: DEV_FIXTURE_IDS.users.jungle,
      teamSide: TeamSide.A,
      role: Position.JUNGLE,
      kills: 4,
      deaths: 5,
      assists: 5,
      laneResult: LaneResult.EVEN,
      contributionRating: 3,
      statStatus: ResultStatus.CONFIRMED,
    },
    {
      matchId: DEV_FIXTURE_IDS.matches.privateClosed,
      userId: DEV_FIXTURE_IDS.users.default,
      teamSide: TeamSide.A,
      role: Position.MID,
      kills: 3,
      deaths: 7,
      assists: 6,
      laneResult: LaneResult.LOSE,
      contributionRating: 2,
      statStatus: ResultStatus.CONFIRMED,
    },
    {
      matchId: DEV_FIXTURE_IDS.matches.privateClosed,
      userId: DEV_FIXTURE_IDS.users.recruiter,
      teamSide: TeamSide.A,
      role: Position.ADC,
      kills: 6,
      deaths: 6,
      assists: 4,
      laneResult: LaneResult.EVEN,
      contributionRating: 3,
      statStatus: ResultStatus.CONFIRMED,
    },
    {
      matchId: DEV_FIXTURE_IDS.matches.privateClosed,
      userId: DEV_FIXTURE_IDS.users.leader,
      teamSide: TeamSide.A,
      role: Position.SUPPORT,
      kills: 1,
      deaths: 7,
      assists: 12,
      laneResult: LaneResult.EVEN,
      contributionRating: 3,
      statStatus: ResultStatus.CONFIRMED,
    },
    {
      matchId: DEV_FIXTURE_IDS.matches.privateClosed,
      userId: DEV_FIXTURE_IDS.users.member,
      teamSide: TeamSide.B,
      role: Position.TOP,
      kills: 5,
      deaths: 3,
      assists: 8,
      laneResult: LaneResult.WIN,
      contributionRating: 4,
      statStatus: ResultStatus.CONFIRMED,
    },
    {
      matchId: DEV_FIXTURE_IDS.matches.privateClosed,
      userId: DEV_FIXTURE_IDS.users.profile,
      teamSide: TeamSide.B,
      role: Position.JUNGLE,
      kills: 8,
      deaths: 2,
      assists: 9,
      laneResult: LaneResult.WIN,
      contributionRating: 5,
      statStatus: ResultStatus.CONFIRMED,
    },
    {
      matchId: DEV_FIXTURE_IDS.matches.privateClosed,
      userId: DEV_FIXTURE_IDS.users.flex,
      teamSide: TeamSide.B,
      role: Position.MID,
      kills: 7,
      deaths: 4,
      assists: 7,
      laneResult: LaneResult.WIN,
      contributionRating: 4,
      statStatus: ResultStatus.CONFIRMED,
    },
    {
      matchId: DEV_FIXTURE_IDS.matches.privateClosed,
      userId: DEV_FIXTURE_IDS.users.adc,
      teamSide: TeamSide.B,
      role: Position.ADC,
      kills: 9,
      deaths: 3,
      assists: 5,
      laneResult: LaneResult.WIN,
      contributionRating: 5,
      statStatus: ResultStatus.CONFIRMED,
    },
    {
      matchId: DEV_FIXTURE_IDS.matches.privateClosed,
      userId: DEV_FIXTURE_IDS.users.support,
      teamSide: TeamSide.B,
      role: Position.SUPPORT,
      kills: 2,
      deaths: 4,
      assists: 17,
      laneResult: LaneResult.EVEN,
      contributionRating: 4,
      statStatus: ResultStatus.CONFIRMED,
    },
    {
      matchId: DEV_FIXTURE_IDS.matches.publicPending,
      userId: DEV_FIXTURE_IDS.users.top,
      teamSide: TeamSide.A,
      role: Position.TOP,
      kills: 3,
      deaths: 5,
      assists: 4,
      laneResult: LaneResult.EVEN,
      contributionRating: 3,
      statStatus: ResultStatus.PARTIAL,
    },
    {
      matchId: DEV_FIXTURE_IDS.matches.publicPending,
      userId: DEV_FIXTURE_IDS.users.jungle,
      teamSide: TeamSide.A,
      role: Position.JUNGLE,
      kills: 2,
      deaths: 4,
      assists: 9,
      laneResult: LaneResult.EVEN,
      contributionRating: 3,
      statStatus: ResultStatus.PARTIAL,
    },
    {
      matchId: DEV_FIXTURE_IDS.matches.publicPending,
      userId: DEV_FIXTURE_IDS.users.default,
      teamSide: TeamSide.A,
      role: Position.MID,
      kills: 5,
      deaths: 6,
      assists: 7,
      laneResult: LaneResult.LOSE,
      contributionRating: 3,
      statStatus: ResultStatus.PARTIAL,
    },
    {
      matchId: DEV_FIXTURE_IDS.matches.publicPending,
      userId: DEV_FIXTURE_IDS.users.recruiter,
      teamSide: TeamSide.A,
      role: Position.ADC,
      kills: 6,
      deaths: 5,
      assists: 4,
      laneResult: LaneResult.EVEN,
      contributionRating: 3,
      statStatus: ResultStatus.PARTIAL,
    },
    {
      matchId: DEV_FIXTURE_IDS.matches.publicPending,
      userId: DEV_FIXTURE_IDS.users.leader,
      teamSide: TeamSide.A,
      role: Position.SUPPORT,
      kills: 1,
      deaths: 5,
      assists: 13,
      laneResult: LaneResult.EVEN,
      contributionRating: 3,
      statStatus: ResultStatus.PARTIAL,
    },
    {
      matchId: DEV_FIXTURE_IDS.matches.publicPending,
      userId: DEV_FIXTURE_IDS.users.member,
      teamSide: TeamSide.B,
      role: Position.TOP,
      kills: 4,
      deaths: 3,
      assists: 7,
      laneResult: LaneResult.WIN,
      contributionRating: 4,
      statStatus: ResultStatus.PARTIAL,
    },
    {
      matchId: DEV_FIXTURE_IDS.matches.publicPending,
      userId: DEV_FIXTURE_IDS.users.profile,
      teamSide: TeamSide.B,
      role: Position.JUNGLE,
      kills: 7,
      deaths: 2,
      assists: 10,
      laneResult: LaneResult.WIN,
      contributionRating: 5,
      statStatus: ResultStatus.PARTIAL,
    },
    {
      matchId: DEV_FIXTURE_IDS.matches.publicPending,
      userId: DEV_FIXTURE_IDS.users.flex,
      teamSide: TeamSide.B,
      role: Position.MID,
      kills: 4,
      deaths: 4,
      assists: 6,
      laneResult: LaneResult.EVEN,
      contributionRating: 3,
      statStatus: ResultStatus.PARTIAL,
    },
    {
      matchId: DEV_FIXTURE_IDS.matches.publicPending,
      userId: DEV_FIXTURE_IDS.users.adc,
      teamSide: TeamSide.B,
      role: Position.ADC,
      kills: 8,
      deaths: 3,
      assists: 6,
      laneResult: LaneResult.WIN,
      contributionRating: 4,
      statStatus: ResultStatus.PARTIAL,
    },
    {
      matchId: DEV_FIXTURE_IDS.matches.publicPending,
      userId: DEV_FIXTURE_IDS.users.support,
      teamSide: TeamSide.B,
      role: Position.SUPPORT,
      kills: 1,
      deaths: 4,
      assists: 15,
      laneResult: LaneResult.EVEN,
      contributionRating: 4,
      statStatus: ResultStatus.PARTIAL,
    },
  ] as const;

  const confirmations: Array<{
    id: string;
    matchResultId: string;
    matchId: string;
    userId: string;
    action: ConfirmationAction;
    resultVersion: number;
    proposedWinningTeam?: TeamSide | null;
    comment?: string;
    diffJson?: Prisma.InputJsonValue;
  }> = [
    {
      id: 'dev_confirmation_public_confirmed_default',
      matchResultId: DEV_FIXTURE_IDS.results.publicConfirmed,
      matchId: DEV_FIXTURE_IDS.matches.publicConfirmed,
      userId: DEV_FIXTURE_IDS.users.default,
      action: ConfirmationAction.CONFIRM,
      resultVersion: 2,
    },
    {
      id: 'dev_confirmation_public_confirmed_leader',
      matchResultId: DEV_FIXTURE_IDS.results.publicConfirmed,
      matchId: DEV_FIXTURE_IDS.matches.publicConfirmed,
      userId: DEV_FIXTURE_IDS.users.leader,
      action: ConfirmationAction.CONFIRM,
      resultVersion: 2,
    },
    {
      id: 'dev_confirmation_private_closed_profile',
      matchResultId: DEV_FIXTURE_IDS.results.privateClosed,
      matchId: DEV_FIXTURE_IDS.matches.privateClosed,
      userId: DEV_FIXTURE_IDS.users.profile,
      action: ConfirmationAction.CONFIRM,
      resultVersion: 2,
    },
    {
      id: 'dev_confirmation_public_pending_default',
      matchResultId: DEV_FIXTURE_IDS.results.publicPending,
      matchId: DEV_FIXTURE_IDS.matches.publicPending,
      userId: DEV_FIXTURE_IDS.users.default,
      action: ConfirmationAction.CONFIRM,
      resultVersion: 1,
    },
    {
      id: 'dev_confirmation_public_pending_profile',
      matchResultId: DEV_FIXTURE_IDS.results.publicPending,
      matchId: DEV_FIXTURE_IDS.matches.publicPending,
      userId: DEV_FIXTURE_IDS.users.profile,
      action: ConfirmationAction.SUGGEST_CHANGE,
      resultVersion: 1,
      proposedWinningTeam: TeamSide.B,
      comment: '정글 오브젝트 점수 반영 요청',
      diffJson: {
        balanceRating: 4,
      },
    },
  ];

  const notifications = [
    {
      id: DEV_FIXTURE_IDS.notifications.defaultResultPending,
      userId: DEV_FIXTURE_IDS.users.default,
      type: NotificationType.RESULT_CONFIRMATION_REQUEST,
      title: '결과 확인 요청',
      body: 'Pending Result Review 결과를 확인해주세요.',
      payloadJson: {
        matchId: DEV_FIXTURE_IDS.matches.publicPending,
        resultId: DEV_FIXTURE_IDS.results.publicPending,
      },
      relatedEntityType: 'match_result',
      relatedEntityId: DEV_FIXTURE_IDS.results.publicPending,
      status: NotificationStatus.PENDING,
    },
    {
      id: DEV_FIXTURE_IDS.notifications.defaultRecruiting,
      userId: DEV_FIXTURE_IDS.users.default,
      type: NotificationType.RECRUITING_POSTED,
      title: '새 모집 글이 등록되었습니다',
      body: '토요일 공개 내전, 미드/서폿 2명 구해요',
      payloadJson: {
        groupId: DEV_FIXTURE_IDS.groups.publicClash,
        postId: DEV_FIXTURE_IDS.recruitingPosts.publicMid,
      },
      relatedEntityType: 'recruiting_post',
      relatedEntityId: DEV_FIXTURE_IDS.recruitingPosts.publicMid,
      status: NotificationStatus.PENDING,
    },
    {
      id: DEV_FIXTURE_IDS.notifications.leaderApplicant,
      userId: DEV_FIXTURE_IDS.users.leader,
      type: NotificationType.RECRUITING_APPLIED,
      title: '모집 글에 새 신청이 도착했습니다',
      body: '비공개 야간 스크림 서폿/정글 보강',
      payloadJson: {
        postId: DEV_FIXTURE_IDS.recruitingPosts.privateSupport,
        applicantUserId: DEV_FIXTURE_IDS.users.profile,
      },
      relatedEntityType: 'recruiting_post',
      relatedEntityId: DEV_FIXTURE_IDS.recruitingPosts.privateSupport,
      status: NotificationStatus.PENDING,
    },
  ] as const;

  return {
    anchor,
    createdAt,
    users,
    riotAccounts,
    riotSnapshots,
    powerProfiles,
    groups,
    groupMembers,
    recruitingPosts,
    recruitingApplications,
    matches,
    matchPlayers,
    results,
    stats,
    confirmations,
    notifications,
    scenarios: DEV_UI_FIXTURE_SCENARIOS,
  };
}

function assertDevSeedEnabled(): void {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const devSeedEnabled = process.env.DEV_SEED_ENABLED === 'true';

  if (nodeEnv === 'production') {
    throw new Error('Development fixture seed is blocked in production.');
  }

  if (!devSeedEnabled) {
    throw new Error('Set DEV_SEED_ENABLED=true to run the development fixture seed.');
  }
}

function groupByKey<T>(
  items: readonly T[],
  getKey: (item: T) => string,
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = getKey(item);
    const bucket = map.get(key);
    if (bucket) {
      bucket.push(item);
      continue;
    }
    map.set(key, [item]);
  }
  return map;
}

export async function seedDevelopmentFixtures(prisma: PrismaClient): Promise<void> {
  assertDevSeedEnabled();

  const password = resolveDevFixturePassword();
  const passwordHash = await hash(password, PASSWORD_SALT_ROUNDS);
  const plan = buildDevFixturePlan(new Date());

  for (const user of plan.users) {
    await prisma.user.upsert({
      where: { id: user.id },
      update: {
        email: user.email,
        nickname: user.nickname,
        primaryPosition: user.primaryPosition,
        secondaryPosition: user.secondaryPosition,
        isFillAvailable: user.isFillAvailable,
        styleTags: user.styleTags,
        mannerScore: user.mannerScore,
        noshowCount: user.noshowCount,
        isAdmin: user.isAdmin,
      },
      create: {
        ...user,
      },
    });

    await prisma.authIdentity.upsert({
      where: {
        provider_providerUserId: {
          provider: AuthProvider.EMAIL,
          providerUserId: user.email,
        },
      },
      update: {
        userId: user.id,
        email: user.email,
        passwordHash,
        lastLoginAt: plan.createdAt,
      },
      create: {
        userId: user.id,
        provider: AuthProvider.EMAIL,
        providerUserId: user.email,
        email: user.email,
        passwordHash,
        linkedAt: plan.createdAt,
        lastLoginAt: plan.createdAt,
      },
    });
  }

  const managedRiotAccountIds = plan.riotAccounts.map((account) => account.id);
  const managedPowerUserIds = new Set<string>(
    plan.powerProfiles.map((profile) => profile.userId),
  );
  const usersWithoutRiot = MANAGED_USER_IDS.filter(
    (userId) => !plan.riotAccounts.some((account) => account.userId === userId),
  );
  const usersWithoutPower = MANAGED_USER_IDS.filter((userId) => !managedPowerUserIds.has(userId));

  if (usersWithoutRiot.length > 0) {
    await prisma.riotAccountSnapshot.deleteMany({
      where: {
        riotAccount: {
          userId: {
            in: usersWithoutRiot,
          },
        },
      },
    });
    await prisma.riotAccount.deleteMany({
      where: {
        userId: {
          in: usersWithoutRiot,
        },
      },
    });
  }

  if (usersWithoutPower.length > 0) {
    await prisma.playerPowerProfile.deleteMany({
      where: {
        userId: {
          in: usersWithoutPower,
        },
      },
    });
  }

  for (const account of plan.riotAccounts) {
    await prisma.riotAccount.upsert({
      where: { id: account.id },
      update: {
        userId: account.userId,
        riotGameName: account.riotGameName,
        tagLine: account.tagLine,
        region: account.region,
        puuid: account.puuid,
        isPrimary: account.isPrimary,
        verificationStatus: account.verificationStatus,
        syncStatus: account.syncStatus,
        lastSyncRequestedAt: account.lastSyncRequestedAt,
        lastSyncSucceededAt: account.lastSyncSucceededAt,
        lastSyncedAt: account.lastSyncedAt,
        profileIconId: account.profileIconId,
        summonerLevel: account.summonerLevel,
      },
      create: {
        ...account,
      },
    });
  }

  await prisma.riotAccountSnapshot.deleteMany({
    where: {
      riotAccountId: {
        in: managedRiotAccountIds,
      },
      id: {
        notIn: plan.riotSnapshots.map((snapshot) => snapshot.id),
      },
    },
  });

  for (const snapshot of plan.riotSnapshots) {
    await prisma.riotAccountSnapshot.upsert({
      where: { id: snapshot.id },
      update: {
        riotAccountId: snapshot.riotAccountId,
        snapshotType: snapshot.snapshotType,
        sampleSize: snapshot.sampleSize,
        tier: snapshot.tier,
        rank: snapshot.rank,
        lp: snapshot.lp,
        metricsJson: snapshot.metricsJson,
      },
      create: {
        ...snapshot,
      },
    });
  }

  for (const profile of plan.powerProfiles) {
    await prisma.playerPowerProfile.upsert({
      where: { userId: profile.userId },
      update: {
        sourceAccountId: profile.sourceAccountId,
        basePower: profile.basePower,
        formScore: profile.formScore,
        styleScoresJson: profile.styleScoresJson,
        inhouseMmr: profile.inhouseMmr,
        inhouseConfidence: profile.inhouseConfidence,
        lanePowerJson: profile.lanePowerJson,
        breakdownJson: profile.breakdownJson,
        overallPower: profile.overallPower,
        confirmedMatchCount: profile.confirmedMatchCount,
        version: profile.version,
        calculatedAt: profile.calculatedAt,
      },
      create: {
        ...profile,
      },
    });
  }

  for (const group of plan.groups) {
    await prisma.inhouseGroup.upsert({
      where: { id: group.id },
      update: {
        ownerUserId: group.ownerUserId,
        name: group.name,
        region: group.region,
        description: group.description,
        visibility: group.visibility,
        joinPolicy: group.joinPolicy,
        tags: group.tags,
        archivedAt: null,
      },
      create: {
        ...group,
      },
    });
  }

  const membersByGroup = groupByKey(plan.groupMembers, (item) => item.groupId);
  for (const groupId of MANAGED_GROUP_IDS) {
    const members = membersByGroup.get(groupId) ?? [];
    await prisma.groupMember.deleteMany({
      where: {
        groupId,
        userId: {
          notIn: members.map((member) => member.userId),
        },
      },
    });

    for (const member of members) {
      await prisma.groupMember.upsert({
        where: {
          groupId_userId: {
            groupId: member.groupId,
            userId: member.userId,
          },
        },
        update: {
          role: member.role,
        },
        create: {
          ...member,
        },
      });
    }
  }

  for (const post of plan.recruitingPosts) {
    await prisma.recruitingPost.upsert({
      where: { id: post.id },
      update: {
        groupId: post.groupId,
        createdBy: post.createdBy,
        postType: post.postType,
        title: post.title,
        body: post.body,
        tags: post.tags,
        requiredPositionsJson: post.requiredPositionsJson,
        scheduledAt: post.scheduledAt,
        status: post.status,
        deletedAt: null,
      },
      create: {
        ...post,
      },
    });
  }

  const applicationsByPost = groupByKey(plan.recruitingApplications, (item) => item.postId);
  for (const postId of MANAGED_POST_IDS) {
    const applications = applicationsByPost.get(postId) ?? [];
    await prisma.recruitingPostApplication.deleteMany({
      where: {
        postId,
        userId: {
          notIn: applications.map((application) => application.userId),
        },
      },
    });

    for (const application of applications) {
      await prisma.recruitingPostApplication.upsert({
        where: {
          postId_userId: {
            postId: application.postId,
            userId: application.userId,
          },
        },
        update: {},
        create: {
          ...application,
        },
      });
    }
  }

  for (const match of plan.matches) {
    await prisma.inhouseMatch.upsert({
      where: { id: match.id },
      update: {
        groupId: match.groupId,
        createdBy: match.createdBy,
        title: match.title,
        notes: match.notes,
        status: match.status,
        scheduledAt: match.scheduledAt,
        balanceMode: match.balanceMode,
        selectedCandidateNo: match.selectedCandidateNo,
        candidatesJson: match.candidatesJson,
      },
      create: {
        ...match,
      },
    });
  }

  const playersByMatch = groupByKey(plan.matchPlayers, (item) => item.matchId);
  for (const matchId of MANAGED_MATCH_IDS) {
    const players = playersByMatch.get(matchId) ?? [];
    await prisma.inhouseMatchPlayer.deleteMany({
      where: {
        matchId,
        userId: {
          notIn: players.map((player) => player.userId),
        },
      },
    });

    for (const player of players) {
      await prisma.inhouseMatchPlayer.upsert({
        where: {
          matchId_userId: {
            matchId: player.matchId,
            userId: player.userId,
          },
        },
        update: {
          riotAccountId: player.riotAccountId,
          teamSide: player.teamSide,
          assignedRole: player.assignedRole,
          participationStatus: player.participationStatus,
          isCaptain: player.isCaptain,
          positionPrefSnapshot: {
            primaryPosition: plan.users.find((user) => user.id === player.userId)?.primaryPosition ?? null,
          },
          sameTeamPreferencesJson: [],
          avoidTeamPreferencesJson: [],
        },
        create: {
          ...player,
          positionPrefSnapshot: {
            primaryPosition: plan.users.find((user) => user.id === player.userId)?.primaryPosition ?? null,
          },
          sameTeamPreferencesJson: [],
          avoidTeamPreferencesJson: [],
        },
      });
    }
  }

  await prisma.matchResultConfirmation.deleteMany({
    where: {
      matchId: {
        in: MANAGED_MATCH_IDS,
      },
      id: {
        notIn: plan.confirmations.map((confirmation) => confirmation.id),
      },
    },
  });

  for (const result of plan.results) {
    await prisma.inhouseMatchResult.upsert({
      where: { matchId: result.matchId },
      update: {
        id: result.id,
        winningTeam: result.winningTeam,
        mvpUserId: result.mvpUserId,
        balanceRating: result.balanceRating,
        resultStatus: result.resultStatus,
        inputMode: result.inputMode,
        submittedBy: result.submittedBy,
        confirmedAt: result.confirmedAt,
        notes: result.notes,
        payloadJson: result.payloadJson,
        version: result.version,
      },
      create: {
        ...result,
      },
    });
  }

  const statsByMatch = groupByKey(plan.stats, (item) => item.matchId);
  for (const matchId of MANAGED_MATCH_IDS) {
    const matchStats = statsByMatch.get(matchId) ?? [];
    await prisma.inhousePlayerStat.deleteMany({
      where: {
        matchId,
        userId: {
          notIn: matchStats.map((stat) => stat.userId),
        },
      },
    });

    for (const stat of matchStats) {
      await prisma.inhousePlayerStat.upsert({
        where: {
          matchId_userId: {
            matchId: stat.matchId,
            userId: stat.userId,
          },
        },
        update: {
          teamSide: stat.teamSide,
          role: stat.role,
          kills: stat.kills,
          deaths: stat.deaths,
          assists: stat.assists,
          laneResult: stat.laneResult,
          contributionRating: stat.contributionRating,
          statStatus: stat.statStatus,
        },
        create: {
          ...stat,
        },
      });
    }
  }

  for (const confirmation of plan.confirmations) {
    await prisma.matchResultConfirmation.upsert({
      where: { id: confirmation.id },
      update: {
        matchResultId: confirmation.matchResultId,
        matchId: confirmation.matchId,
        userId: confirmation.userId,
        action: confirmation.action,
        resultVersion: confirmation.resultVersion,
        proposedWinningTeam: confirmation.proposedWinningTeam,
        comment: confirmation.comment,
        diffJson: confirmation.diffJson,
      },
      create: {
        ...confirmation,
      },
    });
  }

  await prisma.notification.deleteMany({
    where: {
      userId: {
        in: MANAGED_USER_IDS,
      },
      id: {
        notIn: MANAGED_NOTIFICATION_IDS,
      },
      relatedEntityId: {
        in: [...MANAGED_RESULT_IDS, ...MANAGED_POST_IDS],
      },
    },
  });

  for (const notification of plan.notifications) {
    await prisma.notification.upsert({
      where: { id: notification.id },
      update: {
        userId: notification.userId,
        type: notification.type,
        title: notification.title,
        body: notification.body,
        payloadJson: notification.payloadJson,
        relatedEntityType: notification.relatedEntityType,
        relatedEntityId: notification.relatedEntityId,
        status: notification.status,
      },
      create: {
        ...notification,
      },
    });
  }

  const scenarioLines = REQUIRED_SCENARIOS.map((scenarioName) => {
    const scenario = plan.scenarios[scenarioName];
    return `${scenarioName} => ${scenario.email}`;
  });

  // eslint-disable-next-line no-console
  console.log(`[dev-seed] users created: ${plan.users.length}`);
  // eslint-disable-next-line no-console
  console.log(`[dev-seed] groups created: ${plan.groups.length}`);
  // eslint-disable-next-line no-console
  console.log(`[dev-seed] matches created: ${plan.matches.length}`);
  // eslint-disable-next-line no-console
  console.log(`[dev-seed] recruiting posts created: ${plan.recruitingPosts.length}`);
  // eslint-disable-next-line no-console
  console.log(`[dev-seed] riot accounts attached: ${plan.riotAccounts.length}`);
  // eslint-disable-next-line no-console
  console.log(`[dev-seed] shared dev password: ${password}`);
  // eslint-disable-next-line no-console
  console.log(`[dev-seed] scenarios:\n- ${scenarioLines.join('\n- ')}`);
}
