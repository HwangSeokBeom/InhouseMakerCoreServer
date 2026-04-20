import { Logger } from '@nestjs/common';
import { GroupRole, MatchStatus, Position, ResultStatus, TeamSide } from '@prisma/client';

import { UsersService } from '../src/users/users.service';

describe('UsersService', () => {
  const prismaService = {
    user: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
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
    },
    groupMember: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    inhouseGroup: {
      count: jest.fn(),
    },
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
        }),
      }),
    );
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
