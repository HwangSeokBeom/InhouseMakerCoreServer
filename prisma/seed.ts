import {
  AuthProvider,
  ConfirmationAction,
  GroupRole,
  GroupVisibility,
  InputMode,
  JoinPolicy,
  LaneResult,
  MatchStatus,
  NotificationType,
  ParticipationStatus,
  Position,
  PrismaClient,
  RecruitingPostType,
  ResultStatus,
  SnapshotType,
  TeamSide,
  VerificationStatus,
} from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const users = await Promise.all([
    prisma.user.upsert({
      where: { email: 'host@example.com' },
      update: {},
      create: {
        id: 'seed_user_host',
        email: 'host@example.com',
        nickname: 'HostOne',
        isAdmin: true,
        primaryPosition: Position.MID,
        secondaryPosition: Position.ADC,
        isFillAvailable: false,
        styleTags: ['shotcaller', 'macro'],
      },
    }),
    prisma.user.upsert({
      where: { email: 'top@example.com' },
      update: {},
      create: {
        id: 'seed_user_top',
        email: 'top@example.com',
        nickname: 'TopGap',
        primaryPosition: Position.TOP,
        secondaryPosition: Position.JUNGLE,
        isFillAvailable: true,
        styleTags: ['stable'],
      },
    }),
    prisma.user.upsert({
      where: { email: 'support@example.com' },
      update: {},
      create: {
        id: 'seed_user_support',
        email: 'support@example.com',
        nickname: 'VisionLord',
        primaryPosition: Position.SUPPORT,
        secondaryPosition: Position.ADC,
        isFillAvailable: true,
        styleTags: ['teamplay'],
      },
    }),
  ]);

  await Promise.all(
    [
      {
        userId: users[0].id,
        provider: AuthProvider.APPLE,
        providerUserId: 'seed-apple-host',
        email: users[0].email,
      },
      {
        userId: users[1].id,
        provider: AuthProvider.GOOGLE,
        providerUserId: 'seed-google-top',
        email: users[1].email,
      },
      {
        userId: users[2].id,
        provider: AuthProvider.APPLE,
        providerUserId: 'seed-apple-support',
        email: users[2].email,
      },
    ].map((identity) =>
      prisma.authIdentity.upsert({
        where: {
          provider_providerUserId: {
            provider: identity.provider,
            providerUserId: identity.providerUserId,
          },
        },
        update: {
          email: identity.email,
        },
        create: {
          userId: identity.userId,
          provider: identity.provider,
          providerUserId: identity.providerUserId,
          email: identity.email,
        },
      }),
    ),
  );

  const group = await prisma.inhouseGroup.upsert({
    where: { id: 'seed_group_alpha' },
    update: {},
    create: {
      id: 'seed_group_alpha',
      ownerUserId: users[0].id,
      name: 'Alpha Inhouse',
      description: 'Seeded MVP inhouse group',
      visibility: GroupVisibility.PRIVATE,
      joinPolicy: JoinPolicy.INVITE_ONLY,
      tags: ['competitive', 'evening'],
    },
  });

  await prisma.groupMember.upsert({
    where: {
      groupId_userId: {
        groupId: group.id,
        userId: users[0].id,
      },
    },
    update: {},
    create: {
      groupId: group.id,
      userId: users[0].id,
      role: GroupRole.OWNER,
    },
  });

  await prisma.groupMember.upsert({
    where: {
      groupId_userId: {
        groupId: group.id,
        userId: users[1].id,
      },
    },
    update: {},
    create: {
      groupId: group.id,
      userId: users[1].id,
      role: GroupRole.MEMBER,
    },
  });

  await prisma.groupMember.upsert({
    where: {
      groupId_userId: {
        groupId: group.id,
        userId: users[2].id,
      },
    },
    update: {},
    create: {
      groupId: group.id,
      userId: users[2].id,
      role: GroupRole.ADMIN,
    },
  });

  const riotAccount = await prisma.riotAccount.upsert({
    where: {
      userId_puuid: {
        userId: users[0].id,
        puuid: 'seed-puuid-host',
      },
    },
    update: {},
    create: {
      id: 'seed_riot_host',
      userId: users[0].id,
      riotGameName: 'HideOnSeed',
      tagLine: 'KR1',
      region: 'kr',
      puuid: 'seed-puuid-host',
      isPrimary: true,
      verificationStatus: VerificationStatus.GROUP_VERIFIED,
      lastSyncedAt: new Date(),
    },
  });

  await prisma.riotAccountSnapshot.createMany({
    data: [
      {
        id: 'seed_snapshot_ranked',
        riotAccountId: riotAccount.id,
        snapshotType: SnapshotType.RANKED,
        sampleSize: 2,
        tier: 'EMERALD',
        rank: 'II',
        lp: 77,
        metricsJson: {
          primaryTier: 'EMERALD',
          primaryRank: 'II',
          primaryLp: 77,
          queues: [
            {
              queueType: 'RANKED_SOLO_5x5',
              tier: 'EMERALD',
              rank: 'II',
              lp: 77,
            },
          ],
        },
      },
      {
        id: 'seed_snapshot_aggregate',
        riotAccountId: riotAccount.id,
        snapshotType: SnapshotType.AGGREGATED,
        sampleSize: 10,
        metricsJson: {
          sampleSize: 10,
          recentWinRate: 0.6,
          recentKda: 3.4,
          averageVisionScore: 24,
          averageKillParticipation: 0.58,
          laneMetrics: {
            MID: {
              matches: 6,
              winRate: 0.67,
              kda: 3.8,
              visionScore: 20,
              laneInfluence: 4,
            },
            ADC: {
              matches: 4,
              winRate: 0.5,
              kda: 3.0,
              visionScore: 18,
              laneInfluence: 1,
            },
          },
        },
      },
    ],
    skipDuplicates: true,
  });

  await prisma.playerPowerProfile.upsert({
    where: { userId: users[0].id },
    update: {},
    create: {
      id: 'seed_power_host',
      userId: users[0].id,
      sourceAccountId: riotAccount.id,
      basePower: 71.4,
      formScore: 67.2,
      styleScoresJson: {
        stability: 69,
        carry: 73,
        teamContribution: 65,
        laneInfluence: 70,
      },
      inhouseMmr: 1524,
      inhouseConfidence: 0.2,
      lanePowerJson: {
        TOP: 68,
        JUNGLE: 63,
        MID: 76,
        ADC: 71,
        SUPPORT: 60,
      },
      overallPower: 73.1,
      version: 'v1',
      confirmedMatchCount: 3,
    },
  });

  const match = await prisma.inhouseMatch.upsert({
    where: { id: 'seed_match_alpha' },
    update: {},
    create: {
      id: 'seed_match_alpha',
      groupId: group.id,
      createdBy: users[0].id,
      title: 'Friday Inhouse',
      status: MatchStatus.RESULT_PENDING,
      scheduledAt: new Date(),
      balanceMode: 'BALANCED',
      selectedCandidateNo: 1,
      candidatesJson: [],
    },
  });

  await prisma.inhouseMatchPlayer.createMany({
    data: [
      {
        id: 'seed_match_player_host',
        matchId: match.id,
        userId: users[0].id,
        riotAccountId: riotAccount.id,
        teamSide: TeamSide.A,
        assignedRole: Position.MID,
        participationStatus: ParticipationStatus.LOCKED_IN,
        isCaptain: true,
      },
      {
        id: 'seed_match_player_top',
        matchId: match.id,
        userId: users[1].id,
        teamSide: TeamSide.A,
        assignedRole: Position.TOP,
        participationStatus: ParticipationStatus.LOCKED_IN,
      },
      {
        id: 'seed_match_player_support',
        matchId: match.id,
        userId: users[2].id,
        teamSide: TeamSide.B,
        assignedRole: Position.SUPPORT,
        participationStatus: ParticipationStatus.LOCKED_IN,
        isCaptain: true,
      },
    ],
    skipDuplicates: true,
  });

  const result = await prisma.inhouseMatchResult.upsert({
    where: { matchId: match.id },
    update: {},
    create: {
      id: 'seed_result_alpha',
      matchId: match.id,
      winningTeam: TeamSide.A,
      mvpUserId: users[0].id,
      balanceRating: 4,
      resultStatus: ResultStatus.PARTIAL,
      inputMode: InputMode.QUICK,
      submittedBy: users[0].id,
      payloadJson: {
        winningTeam: TeamSide.A,
      },
    },
  });

  await prisma.inhousePlayerStat.createMany({
    data: [
      {
        id: 'seed_stat_host',
        matchId: match.id,
        userId: users[0].id,
        teamSide: TeamSide.A,
        role: Position.MID,
        kills: 8,
        deaths: 2,
        assists: 11,
        laneResult: LaneResult.WIN,
        contributionRating: 5,
        statStatus: ResultStatus.PARTIAL,
      },
      {
        id: 'seed_stat_top',
        matchId: match.id,
        userId: users[1].id,
        teamSide: TeamSide.A,
        role: Position.TOP,
        kills: 3,
        deaths: 4,
        assists: 7,
        laneResult: LaneResult.EVEN,
        contributionRating: 3,
        statStatus: ResultStatus.PARTIAL,
      },
      {
        id: 'seed_stat_support',
        matchId: match.id,
        userId: users[2].id,
        teamSide: TeamSide.B,
        role: Position.SUPPORT,
        kills: 1,
        deaths: 6,
        assists: 9,
        laneResult: LaneResult.LOSE,
        contributionRating: 3,
        statStatus: ResultStatus.PARTIAL,
      },
    ],
    skipDuplicates: true,
  });

  await prisma.matchResultConfirmation.create({
    data: {
      id: 'seed_confirmation_host',
      matchResultId: result.id,
      matchId: match.id,
      userId: users[0].id,
      action: ConfirmationAction.CONFIRM,
    },
  }).catch(() => undefined);

  await prisma.recruitingPost.upsert({
    where: { id: 'seed_recruiting_alpha' },
    update: {},
    create: {
      id: 'seed_recruiting_alpha',
      groupId: group.id,
      createdBy: users[0].id,
      postType: RecruitingPostType.MEMBER_RECRUIT,
      title: 'Tonight 5v5 looking for 2 more',
      body: 'Need stable jungle and support players.',
      tags: ['weekday', 'competitive'],
      requiredPositionsJson: [Position.JUNGLE, Position.SUPPORT],
    },
  });

  await prisma.notification.create({
    data: {
      id: 'seed_notification_result',
      userId: users[2].id,
      type: NotificationType.RESULT_CONFIRMATION_REQUEST,
      title: '결과 확인 요청',
      body: 'Friday Inhouse 결과를 확인해주세요.',
      relatedEntityType: 'match_result',
      relatedEntityId: result.id,
    },
  }).catch(() => undefined);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
