import { Position } from '@prisma/client';

import { PowerService } from '../src/power/power.service';
import { POWER_PROFILE_VERSION } from '../src/power/power.constants';
import { DEV_GROUP_MEMBER_FIXTURES } from './support/dev-group-member-fixtures';

describe('PowerService', () => {
  const REQUIRED_LANES = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'] as const;
  const prismaService = {
    playerPowerProfile: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
  } as any;
  const usersService = {
    assertCanAccessUserScopedResource: jest.fn(),
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

  let service: PowerService;

  beforeEach(() => {
    jest.clearAllMocks();
    riotChampionSummaryService.getTopChampionsForUser.mockResolvedValue([]);
    riotChampionSummaryService.getTopChampionSummaryForUser.mockResolvedValue(
      emptyChampionSummary,
    );
    service = new PowerService(
      prismaService,
      usersService,
      riotChampionSummaryService,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  it('recalculates stale profiles before returning the response', async () => {
    usersService.assertCanAccessUserScopedResource.mockResolvedValue(undefined);
    prismaService.playerPowerProfile.findUnique
      .mockResolvedValueOnce({
        userId: 'user-1',
        overallPower: 41.2,
        lanePowerJson: { MID: 41.2 },
        breakdownJson: {},
        styleScoresJson: { stability: 50, carry: 50, teamContribution: 50, laneInfluence: 50 },
        basePower: 35,
        formScore: 50,
        inhouseMmr: 1500,
        inhouseConfidence: 0,
        user: { primaryPosition: 'MID', secondaryPosition: 'ADC' },
        sourceAccount: { lastSyncedAt: null },
        version: 'v1',
        calculatedAt: new Date('2026-04-15T10:00:00Z'),
      })
      .mockResolvedValueOnce({
        userId: 'user-1',
        overallPower: 76.25,
        lanePowerJson: { MID: 76.25 },
        breakdownJson: {
          inhouse: { inhouseWeight: 0.15 },
          displayScore: {
            sourceField: 'overallPower',
            dtoOverallPower: 76.25,
            clientDisplayRounded: 76,
          },
        },
        styleScoresJson: { stability: 52, carry: 54, teamContribution: 53, laneInfluence: 55 },
        basePower: 77.08,
        formScore: 52.1,
        inhouseMmr: 1762.5,
        inhouseConfidence: 0.15,
        user: { primaryPosition: 'MID', secondaryPosition: 'ADC' },
        sourceAccount: { lastSyncedAt: null },
        version: POWER_PROFILE_VERSION,
        calculatedAt: new Date('2026-04-16T10:00:00Z'),
      });
    const recalculateSpy = jest
      .spyOn(service, 'recalculateProfile')
      .mockResolvedValue(undefined);

    const response = await service.getProfile('viewer-1', 'user-1');

    expect(recalculateSpy).toHaveBeenCalledWith('user-1');
    expect(response.overallPower).toBe(76.25);
    expect(response.version).toBe(POWER_PROFILE_VERSION);
    expect((response.explanation.displayScore as Record<string, unknown>).sourceField).toBe(
      'overallPower',
    );
    expect(response.topChampions).toEqual([]);
  });

  it('recalculates when riot sync is newer than stored calculation time', async () => {
    usersService.assertCanAccessUserScopedResource.mockResolvedValue(undefined);
    prismaService.playerPowerProfile.findUnique
      .mockResolvedValueOnce({
        userId: 'user-2',
        overallPower: 64.5,
        lanePowerJson: { MID: 64.5 },
        breakdownJson: { displayScore: { sourceField: 'overallPower' } },
        styleScoresJson: { stability: 50, carry: 50, teamContribution: 50, laneInfluence: 50 },
        basePower: 60,
        formScore: 51,
        inhouseMmr: 1645,
        inhouseConfidence: 0.2,
        user: { primaryPosition: 'MID', secondaryPosition: 'ADC' },
        sourceAccount: { lastSyncedAt: new Date('2026-04-16T11:00:00Z') },
        version: POWER_PROFILE_VERSION,
        calculatedAt: new Date('2026-04-16T10:00:00Z'),
      })
      .mockResolvedValueOnce({
        userId: 'user-2',
        overallPower: 68.4,
        lanePowerJson: { MID: 68.4 },
        breakdownJson: {
          inhouse: { inhouseWeight: 0.15 },
          displayScore: {
            sourceField: 'overallPower',
            dtoOverallPower: 68.4,
            clientDisplayRounded: 68,
          },
        },
        styleScoresJson: { stability: 50, carry: 50, teamContribution: 50, laneInfluence: 50 },
        basePower: 64,
        formScore: 51,
        inhouseMmr: 1684,
        inhouseConfidence: 0.2,
        user: { primaryPosition: 'MID', secondaryPosition: 'ADC' },
        sourceAccount: { lastSyncedAt: new Date('2026-04-16T11:00:00Z') },
        version: POWER_PROFILE_VERSION,
        calculatedAt: new Date('2026-04-16T11:00:05Z'),
      });
    const recalculateSpy = jest
      .spyOn(service, 'recalculateProfile')
      .mockResolvedValue(undefined);

    const response = await service.getProfile('viewer-1', 'user-2');

    expect(recalculateSpy).toHaveBeenCalledWith('user-2');
    expect(response.overallPower).toBe(68.4);
    expect(response.topChampions).toEqual([]);
  });

  it('normalizes legacy seeded profiles into the full power-profile contract', async () => {
    usersService.assertCanAccessUserScopedResource.mockResolvedValue(undefined);
    prismaService.playerPowerProfile.findUnique.mockResolvedValue({
      userId: 'user-seeded',
      overallPower: 68,
      lanePowerJson: {
        [Position.ADC]: 74,
        [Position.MID]: 62,
      },
      breakdownJson: {
        displayScore: {
          sourceField: 'overallPower',
        },
      },
      styleScoresJson: {
        seeded: true,
        roleFocus: Position.ADC,
      },
      basePower: 65,
      formScore: 67,
      inhouseMmr: 1722,
      inhouseConfidence: 0.2,
      user: { primaryPosition: Position.ADC, secondaryPosition: Position.MID },
      sourceAccount: { lastSyncedAt: null },
      version: POWER_PROFILE_VERSION,
      calculatedAt: new Date('2026-04-20T09:00:00Z'),
    });

    const response = await service.getProfile('viewer-1', 'user-seeded');

    expect(response.style).toMatchObject({
      seeded: true,
      roleFocus: Position.ADC,
    });
    expect(typeof response.style.stability).toBe('number');
    expect(typeof response.style.carry).toBe('number');
    expect(typeof response.style.teamContribution).toBe('number');
    expect(typeof response.style.laneInfluence).toBe('number');
    for (const lane of REQUIRED_LANES) {
      expect(typeof response.lanePower[lane]).toBe('number');
    }
    expect(response.primaryPosition).toBe(Position.ADC);
    expect(response.secondaryPosition).toBe(Position.MID);
    expect(response.topChampions).toEqual([]);
  });

  it('returns auto-calculated primary and secondary positions when manual positions are empty', async () => {
    usersService.assertCanAccessUserScopedResource.mockResolvedValue(undefined);
    prismaService.playerPowerProfile.findUnique.mockResolvedValue({
      userId: 'user-auto',
      overallPower: 70,
      lanePowerJson: {
        [Position.TOP]: 65,
        [Position.JUNGLE]: 68,
        [Position.MID]: 78,
        [Position.ADC]: 73,
        [Position.SUPPORT]: 62,
      },
      breakdownJson: {
        displayScore: {
          sourceField: 'overallPower',
        },
      },
      styleScoresJson: { stability: 50, carry: 50, teamContribution: 50, laneInfluence: 50 },
      basePower: 69,
      formScore: 71,
      inhouseMmr: 1700,
      inhouseConfidence: 0.2,
      user: { primaryPosition: null, secondaryPosition: null },
      sourceAccount: { lastSyncedAt: null },
      version: POWER_PROFILE_VERSION,
      calculatedAt: new Date('2026-04-20T09:00:00Z'),
    });

    const response = await service.getProfile('viewer-1', 'user-auto');

    expect(response.primaryPosition).toBe(Position.MID);
    expect(response.secondaryPosition).toBe(Position.ADC);
    expect(response.explanation.laneAutoAssignmentBasis).toMatchObject({
      source: 'auto_fallback',
      primaryPosition: Position.MID,
      secondaryPosition: Position.ADC,
    });
  });

  it('keeps non-empty top champions in the power-profile response even when aggregation status is partial', async () => {
    usersService.assertCanAccessUserScopedResource.mockResolvedValue(undefined);
    prismaService.playerPowerProfile.findUnique.mockResolvedValue({
      userId: 'user-champions',
      overallPower: 70,
      lanePowerJson: {
        [Position.TOP]: 64,
        [Position.JUNGLE]: 66,
        [Position.MID]: 74,
        [Position.ADC]: 71,
        [Position.SUPPORT]: 63,
      },
      breakdownJson: {
        displayScore: {
          sourceField: 'overallPower',
        },
      },
      styleScoresJson: { stability: 50, carry: 50, teamContribution: 50, laneInfluence: 50 },
      basePower: 67,
      formScore: 52,
      inhouseMmr: 1700,
      inhouseConfidence: 0.1,
      user: { primaryPosition: Position.MID, secondaryPosition: Position.ADC },
      sourceAccount: { id: 'riot-1', lastSyncedAt: null },
      version: POWER_PROFILE_VERSION,
      calculatedAt: new Date('2026-04-20T09:00:00Z'),
    });
    riotChampionSummaryService.getTopChampionSummaryForUser.mockResolvedValue({
      topChampions: [
        {
          championId: 99,
          championKey: 'Lux',
          championName: 'Lux',
          games: 2,
          wins: 1,
          losses: 1,
          winRate: 0.5,
          kills: 12,
          deaths: 8,
          assists: 21,
          kda: 4.13,
          lastPlayedAt: '2026-04-20T00:00:00.000Z',
        },
      ],
      aggregationStatus: {
        status: 'PARTIAL',
        reason: 'insufficient_sample',
        message: 'Top champions were aggregated from stored ranked history, but the champion sample is still limited.',
        hasUsableContent: true,
        totalMatches: 2,
        rankedMatches: 2,
        eligibleMatches: 2,
        mappedMatches: 2,
        thresholdUsed: 2,
        syncCoverageSummary: {
          usedQueueScope: 'ranked',
        },
      },
    });

    const response = await service.getProfile('viewer-1', 'user-champions');

    expect(response.topChampions).toHaveLength(1);
    expect(response.topChampionAggregationStatus).toMatchObject({
      status: 'PARTIAL',
      reason: 'insufficient_sample',
      hasUsableContent: true,
    });
  });

  it('returns lobby-ready seeded responses for all 10 dev fixtures', async () => {
    usersService.assertCanAccessUserScopedResource.mockResolvedValue(undefined);
    const calculatedAt = new Date('2026-04-20T09:00:00Z');
    prismaService.playerPowerProfile.findUnique.mockImplementation(({ where }: { where: { userId: string } }) => {
      const fixtureIndex = Number(where.userId.replace('user-', '')) - 1;
      const fixture = DEV_GROUP_MEMBER_FIXTURES[fixtureIndex];

      if (!fixture) {
        return Promise.resolve(null);
      }

      return Promise.resolve({
        userId: where.userId,
        overallPower: fixture.overallPower,
        lanePowerJson: fixture.lanePower,
        breakdownJson: {
          displayScore: {
            sourceField: 'overallPower',
          },
          inhouse: {
            source: 'dev_group_fill',
          },
        },
        styleScoresJson: {
          seeded: true,
          roleFocus: fixture.primaryPosition,
          stability: 64,
          carry: 62,
          teamContribution: 61,
          laneInfluence: 63,
        },
        basePower: fixture.overallPower - 3,
        formScore: fixture.overallPower - 1,
        inhouseMmr: 1450 + fixture.overallPower * 4,
        inhouseConfidence: 0.2,
        user: {
          primaryPosition: fixture.primaryPosition,
          secondaryPosition: fixture.secondaryPosition,
        },
        sourceAccount: { lastSyncedAt: null },
        version: POWER_PROFILE_VERSION,
        calculatedAt,
      });
    });

    const responses = await Promise.all(
      DEV_GROUP_MEMBER_FIXTURES.map((_, index) => service.getProfile('viewer-1', `user-${index + 1}`)),
    );

    expect(responses).toHaveLength(10);
    expect(
      responses.every(
        (response) =>
          response.overallPower > 0 &&
          response.primaryPosition !== null &&
          response.secondaryPosition !== null &&
          typeof response.style.stability === 'number' &&
          typeof response.style.roleFocus === 'string' &&
          REQUIRED_LANES.every((lane) => typeof response.lanePower[lane] === 'number'),
      ),
    ).toBe(true);
  });
});
