import { Logger } from '@nestjs/common';
import {
  GroupRole,
  MatchStatus,
  Position,
  ResultStatus,
  TeamSide,
  UserStatus,
} from '@prisma/client';

import { UsersService } from '../src/users/users.service';

describe('UsersService', () => {
  const prismaService = {
    user: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    authIdentity: {
      deleteMany: jest.fn(),
    },
    riotAccount: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    riotMatchParticipantSummary: {
      deleteMany: jest.fn(),
    },
    userBlock: {
      deleteMany: jest.fn(),
    },
    inhousePlayerStat: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    inhouseMatchPlayer: {
      count: jest.fn(),
    },
    playerPowerProfile: {
      findUnique: jest.fn(),
      deleteMany: jest.fn(),
    },
    groupMember: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    inhouseGroup: {
      count: jest.fn(),
    },
    $transaction: jest.fn((operations: Array<Promise<unknown>>) => Promise.all(operations)),
  } as any;
  const riotChampionSummaryService = {
    getTopChampionsForUser: jest.fn(),
    getTopChampionSummaryForUser: jest.fn(),
  } as any;
  const emptyChampionSummary = {
    topChampions: [],
    aggregationStatus: {
      status: 'EMPTY',
      reason: 'no_sync',
      message: 'test',
      hasUsableContent: false,
      totalMatches: 0,
      rankedMatches: 0,
      eligibleMatches: 0,
      mappedMatches: 0,
      thresholdUsed: null,
      syncCoverageSummary: {},
    },
  };

  let service: UsersService;
  let loggerLogSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    loggerLogSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    riotChampionSummaryService.getTopChampionsForUser.mockResolvedValue([]);
    riotChampionSummaryService.getTopChampionSummaryForUser.mockResolvedValue(
      emptyChampionSummary,
    );
    service = new UsersService(prismaService, riotChampionSummaryService);
  });

  afterEach(() => {
    loggerLogSpy.mockRestore();
  });

  it('returns invite-search results with exact user ids and invite metadata', async () => {
    prismaService.user.findMany.mockResolvedValue([
      {
        id: 'user-exact',
        nickname: 'Alpha',
        primaryPosition: Position.MID,
        secondaryPosition: Position.TOP,
        powerProfile: { overallPower: 73.6 },
        riotAccounts: [
          {
            riotGameName: 'Alpha',
            tagLine: 'KR1',
            region: 'kr',
            profileIconId: 321,
            summonerLevel: 201,
          },
        ],
        groupMemberships: [{ role: GroupRole.MEMBER }],
      },
      {
        id: 'user-contains',
        nickname: 'TeamAlpha',
        primaryPosition: Position.SUPPORT,
        secondaryPosition: Position.ADC,
        powerProfile: { overallPower: 60.2 },
        riotAccounts: [],
        groupMemberships: [],
      },
    ]);

    const result = await service.searchInviteUsers('self-user', {
      query: 'Alpha',
      limit: 20,
      groupId: 'group-1',
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        id: 'user-exact',
        userId: 'user-exact',
        nickname: 'Alpha',
        primaryPosition: Position.MID,
        secondaryPosition: Position.TOP,
        recentPower: 73.6,
        riotDisplayName: 'Alpha#KR1',
        alreadyMember: true,
        memberRole: GroupRole.MEMBER,
      }),
      expect.objectContaining({
        id: 'user-contains',
        userId: 'user-contains',
        nickname: 'TeamAlpha',
        alreadyMember: false,
        memberRole: null,
      }),
    ]);
  });

  it('passes korean nickname queries through as contains search and can exclude current members', async () => {
    prismaService.user.findMany.mockResolvedValue([]);

    const result = await service.searchInviteUsers('self-user', {
      query: '탑',
      limit: 20,
      groupId: 'group-1',
      excludeExistingMembers: true,
    });

    expect(result).toEqual({ items: [] });
    expect(prismaService.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          nickname: {
            contains: '탑',
            mode: 'insensitive',
          },
          groupMemberships: {
            none: {
              groupId: 'group-1',
            },
          },
          AND: [
            {
              AND: [
                {
                  blockedByUsers: {
                    none: {
                      userId: 'self-user',
                    },
                  },
                },
                {
                  blockedUsers: {
                    none: {
                      targetUserId: 'self-user',
                    },
                  },
                },
              ],
            },
          ],
        }),
      }),
    );
  });

  it('uploads a profile image, stores the new URL, and removes the previous local file', async () => {
    const fileStorage = {
      store: jest.fn().mockResolvedValue({
        url: '/uploads/profile-images/new.jpg',
      }),
      deleteByUrl: jest.fn(),
    };
    const serviceWithStorage = new UsersService(
      prismaService,
      riotChampionSummaryService,
      fileStorage,
    );
    prismaService.user.findUnique
      .mockResolvedValueOnce({
        id: 'user-1',
        profileImageUrl: '/uploads/profile-images/old.jpg',
      })
      .mockResolvedValueOnce({
        id: 'user-1',
        email: 'user@example.com',
        nickname: 'UserOne',
        status: UserStatus.ACTIVE,
        profileImageUrl: '/uploads/profile-images/new.jpg',
        primaryPosition: Position.MID,
        secondaryPosition: Position.TOP,
        isFillAvailable: false,
        styleTags: [],
        mannerScore: 100,
        noshowCount: 0,
        powerProfile: null,
      });
    prismaService.user.update.mockResolvedValue({});

    const response = await serviceWithStorage.updateProfileImage('user-1', {
      buffer: Buffer.from([1, 2, 3]),
      originalname: 'avatar.png',
      mimetype: 'image/png',
      size: 3,
    });

    expect(fileStorage.store).toHaveBeenCalledWith(
      expect.objectContaining({
        directory: 'profile-images',
        mimeType: 'image/png',
      }),
    );
    expect(prismaService.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        profileImageUrl: '/uploads/profile-images/new.jpg',
      },
    });
    expect(fileStorage.deleteByUrl).toHaveBeenCalledWith('/uploads/profile-images/old.jpg');
    expect(response.profileImageUrl).toBe('/uploads/profile-images/new.jpg');
  });

  it('rejects non-image profile uploads before storage', async () => {
    const fileStorage = {
      store: jest.fn(),
      deleteByUrl: jest.fn(),
    };
    const serviceWithStorage = new UsersService(
      prismaService,
      riotChampionSummaryService,
      fileStorage,
    );

    await expect(
      serviceWithStorage.updateProfileImage('user-1', {
        buffer: Buffer.from('not-image'),
        originalname: 'avatar.gif',
        mimetype: 'image/gif',
        size: 9,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'PROFILE_IMAGE_INVALID_TYPE',
      }),
    });
    expect(fileStorage.store).not.toHaveBeenCalled();
  });

  it('deletes a profile image and returns the profile with a null image URL', async () => {
    const fileStorage = {
      store: jest.fn(),
      deleteByUrl: jest.fn(),
    };
    const serviceWithStorage = new UsersService(
      prismaService,
      riotChampionSummaryService,
      fileStorage,
    );
    prismaService.user.findUnique
      .mockResolvedValueOnce({
        id: 'user-1',
        profileImageUrl: '/uploads/profile-images/old.jpg',
      })
      .mockResolvedValueOnce({
        id: 'user-1',
        email: 'user@example.com',
        nickname: 'UserOne',
        status: UserStatus.ACTIVE,
        profileImageUrl: null,
        primaryPosition: Position.MID,
        secondaryPosition: Position.TOP,
        isFillAvailable: false,
        styleTags: [],
        mannerScore: 100,
        noshowCount: 0,
        powerProfile: null,
      });
    prismaService.user.update.mockResolvedValue({});

    const response = await serviceWithStorage.deleteProfileImage('user-1');

    expect(prismaService.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        profileImageUrl: null,
      },
    });
    expect(fileStorage.deleteByUrl).toHaveBeenCalledWith('/uploads/profile-images/old.jpg');
    expect(response.profileImageUrl).toBeNull();
  });

  it('withdraws the current account and deletes Riot-derived personal data', async () => {
    const fileStorage = {
      store: jest.fn(),
      deleteByUrl: jest.fn(),
    };
    const serviceWithStorage = new UsersService(
      prismaService,
      riotChampionSummaryService,
      fileStorage,
    );
    prismaService.user.findUnique.mockResolvedValue({
      id: 'user-1',
      status: UserStatus.ACTIVE,
      profileImageUrl: '/uploads/profile-images/old.jpg',
    });
    prismaService.authIdentity.deleteMany.mockResolvedValue({ count: 1 });
    prismaService.riotAccount.findMany.mockResolvedValue([
      { puuid: 'puuid-1' },
      { puuid: 'puuid-1' },
    ]);
    prismaService.riotMatchParticipantSummary.deleteMany.mockResolvedValue({ count: 3 });
    prismaService.playerPowerProfile.deleteMany.mockResolvedValue({ count: 1 });
    prismaService.riotAccount.deleteMany.mockResolvedValue({ count: 1 });
    prismaService.user.update.mockResolvedValue({});
    prismaService.userBlock.deleteMany.mockResolvedValue({ count: 2 });

    const response = await serviceWithStorage.withdrawMe('user-1');

    expect(prismaService.$transaction).toHaveBeenCalledWith([
      expect.any(Promise),
      expect.any(Promise),
      expect.any(Promise),
      expect.any(Promise),
      expect.any(Promise),
      expect.any(Promise),
    ]);
    expect(prismaService.riotMatchParticipantSummary.deleteMany).toHaveBeenCalledWith({
      where: { puuid: { in: ['puuid-1'] } },
    });
    expect(prismaService.playerPowerProfile.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
    expect(prismaService.riotAccount.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
    expect(prismaService.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: expect.objectContaining({
        email: 'withdrawn-user-1@withdrawn.local',
        nickname: 'withdrawn-user-1',
        status: UserStatus.WITHDRAWN,
        refreshTokenHash: null,
        profileImageUrl: null,
        primaryPosition: null,
        secondaryPosition: null,
        styleTags: expect.anything(),
      }),
    });
    expect(fileStorage.deleteByUrl).toHaveBeenCalledWith('/uploads/profile-images/old.jpg');
    expect(response).toMatchObject({
      success: true,
      userId: 'user-1',
      status: UserStatus.WITHDRAWN,
    });
  });

  it('returns a profile summary with safe topChampions defaults', async () => {
    prismaService.user.findUnique.mockResolvedValue({
      id: 'user-1',
      nickname: 'ProfileUser',
      primaryPosition: Position.MID,
      secondaryPosition: Position.ADC,
      isFillAvailable: true,
      powerProfile: { overallPower: 73.4, lanePowerJson: { MID: 76, ADC: 72 } },
      styleTags: ['shotcaller'],
      mannerScore: 98,
      noshowCount: 0,
    });

    const response = await service.getUserProfile('user-1', 'user-1');

    expect(response).toMatchObject({
      userId: 'user-1',
      recentPower: 73.4,
      topChampions: [],
      topChampionAggregationStatus: emptyChampionSummary.aggregationStatus,
    });
    expect(riotChampionSummaryService.getTopChampionSummaryForUser).toHaveBeenCalledWith(
      'user-1',
    );
  });

  it('includes result-pending player stats in inhouse history after quick result submit', async () => {
    const createdAt = new Date('2026-04-18T14:00:00.000Z');
    prismaService.inhousePlayerStat.findMany.mockResolvedValue([
      {
        matchId: 'match-1',
        userId: 'user-1',
        teamSide: TeamSide.A,
        role: Position.MID,
        kills: 7,
        deaths: 2,
        assists: 9,
        createdAt,
        match: {
          groupId: 'group-1',
          group: {
            id: 'group-1',
            name: 'Night Queue',
          },
          title: 'Pending result match',
          status: MatchStatus.RESULT_PENDING,
          scheduledAt: null,
          result: {
            winningTeam: TeamSide.A,
            resultStatus: ResultStatus.PARTIAL,
            confirmedAt: null,
            updatedAt: createdAt,
          },
        },
      },
    ]);

    const response = await service.getInhouseHistory(
      { userId: 'user-1' } as any,
      'user-1',
      { limit: 30 },
    );

    expect(prismaService.inhousePlayerStat.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'user-1',
          match: {
            status: {
              in: expect.arrayContaining([MatchStatus.RESULT_PENDING]),
            },
          },
        },
        take: 30,
      }),
    );
    expect(response.items).toEqual([
      expect.objectContaining({
        matchId: 'match-1',
        status: MatchStatus.RESULT_PENDING,
        result: 'WIN',
        kda: '7/2/9',
        deltaMmr: 9,
        winningTeam: TeamSide.A,
        resultStatus: ResultStatus.PARTIAL,
      }),
    ]);
  });
});
