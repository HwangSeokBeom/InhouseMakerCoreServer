import { ParticipationStatus, Position } from '@prisma/client';

import { MatchmakingAlgorithmService } from '../src/matchmaking/matchmaking-algorithm.service';
import { MatchmakingService } from '../src/matchmaking/matchmaking.service';
import { DEV_GROUP_MEMBER_FIXTURES } from './support/dev-group-member-fixtures';

describe('MatchmakingService', () => {
  const createService = () => {
    const prismaService = {
      inhouseMatch: {
        update: jest.fn(),
        findMany: jest.fn(),
      },
    };
    const matchesService = {
      getMatchWithPlayers: jest.fn(),
      assertMatchHostOrCaptain: jest.fn(),
    };
    const powerService = {
      getPowerMapForUsers: jest.fn(),
    };

    return {
      prismaService,
      matchesService,
      powerService,
      service: new MatchmakingService(
        prismaService as any,
        matchesService as any,
        powerService as any,
        new MatchmakingAlgorithmService(),
      ),
    };
  };

  it('generates guest preview balance candidates without touching persistence', () => {
    const { service, prismaService, matchesService, powerService } = createService();

    const response = service.previewBalance({
      players: [
        { userId: 'u1', nickname: 'Top1', primaryPosition: Position.TOP, secondaryPosition: Position.JUNGLE, isFillAvailable: false, overallPower: 70, lanePower: { TOP: 74, JUNGLE: 65, MID: 58, ADC: 55, SUPPORT: 52 } },
        { userId: 'u2', nickname: 'Jg1', primaryPosition: Position.JUNGLE, secondaryPosition: Position.TOP, isFillAvailable: false, overallPower: 69, lanePower: { TOP: 63, JUNGLE: 73, MID: 57, ADC: 53, SUPPORT: 54 } },
        { userId: 'u3', nickname: 'Mid1', primaryPosition: Position.MID, secondaryPosition: Position.ADC, isFillAvailable: false, overallPower: 72, lanePower: { TOP: 55, JUNGLE: 58, MID: 78, ADC: 67, SUPPORT: 51 } },
        { userId: 'u4', nickname: 'Ad1', primaryPosition: Position.ADC, secondaryPosition: Position.MID, isFillAvailable: false, overallPower: 71, lanePower: { TOP: 52, JUNGLE: 55, MID: 66, ADC: 77, SUPPORT: 50 } },
        { userId: 'u5', nickname: 'Sup1', primaryPosition: Position.SUPPORT, secondaryPosition: Position.ADC, isFillAvailable: true, overallPower: 68, lanePower: { TOP: 50, JUNGLE: 54, MID: 56, ADC: 62, SUPPORT: 75 } },
        { userId: 'u6', nickname: 'Top2', primaryPosition: Position.TOP, secondaryPosition: Position.SUPPORT, isFillAvailable: false, overallPower: 70, lanePower: { TOP: 72, JUNGLE: 57, MID: 55, ADC: 54, SUPPORT: 61 } },
        { userId: 'u7', nickname: 'Jg2', primaryPosition: Position.JUNGLE, secondaryPosition: Position.SUPPORT, isFillAvailable: true, overallPower: 67, lanePower: { TOP: 57, JUNGLE: 71, MID: 56, ADC: 55, SUPPORT: 63 } },
        { userId: 'u8', nickname: 'Mid2', primaryPosition: Position.MID, secondaryPosition: Position.TOP, isFillAvailable: false, overallPower: 69, lanePower: { TOP: 61, JUNGLE: 56, MID: 74, ADC: 59, SUPPORT: 55 } },
        { userId: 'u9', nickname: 'Ad2', primaryPosition: Position.ADC, secondaryPosition: Position.SUPPORT, isFillAvailable: false, overallPower: 68, lanePower: { TOP: 51, JUNGLE: 54, MID: 60, ADC: 73, SUPPORT: 64 } },
        { userId: 'u10', nickname: 'Sup2', primaryPosition: Position.SUPPORT, secondaryPosition: Position.JUNGLE, isFillAvailable: true, overallPower: 66, lanePower: { TOP: 52, JUNGLE: 61, MID: 55, ADC: 58, SUPPORT: 72 } },
      ],
    });

    expect(response.candidates).toHaveLength(3);
    expect(response.candidates.every((candidate) => candidate.teamA.length === 5)).toBe(true);
    expect(response.candidates.every((candidate) => candidate.teamB.length === 5)).toBe(true);
    expect(prismaService.inhouseMatch.update).not.toHaveBeenCalled();
    expect(matchesService.getMatchWithPlayers).not.toHaveBeenCalled();
    expect(powerService.getPowerMapForUsers).not.toHaveBeenCalled();
  });

  it('rejects invalid guest preview payloads before any persistence-facing dependency runs', () => {
    const { service, prismaService, matchesService, powerService } = createService();

    expect(() =>
      service.previewBalance({
        players: Array.from({ length: 10 }, (_, index) => ({
          userId: index === 9 ? 'u1' : `u${index + 1}`,
          nickname: `Player${index + 1}`,
          primaryPosition: Position.TOP,
          overallPower: 50,
        })),
      }),
    ).toThrow('Balance preview players must have unique user IDs.');
    expect(prismaService.inhouseMatch.update).not.toHaveBeenCalled();
    expect(matchesService.getMatchWithPlayers).not.toHaveBeenCalled();
    expect(powerService.getPowerMapForUsers).not.toHaveBeenCalled();
  });

  it('generates at least one persisted candidate from the 10-player dev seed shape', async () => {
    const { service, prismaService, matchesService, powerService } = createService();
    const players = DEV_GROUP_MEMBER_FIXTURES.map((fixture, index) => ({
      id: `player-${index + 1}`,
      userId: `user-${index + 1}`,
      participationStatus: ParticipationStatus.ACCEPTED,
      teamSide: null,
      assignedRole: null,
      sameTeamPreferencesJson: [],
      avoidTeamPreferencesJson: [],
      isCaptain: index === 0,
      user: {
        id: `user-${index + 1}`,
        nickname: fixture.nickname,
        primaryPosition: fixture.primaryPosition,
        secondaryPosition: fixture.secondaryPosition,
        isFillAvailable: true,
      },
    }));

    matchesService.getMatchWithPlayers.mockResolvedValue({
      id: 'match-1',
      groupId: 'group-1',
      players,
    });
    powerService.getPowerMapForUsers.mockResolvedValue(
      new Map(
        DEV_GROUP_MEMBER_FIXTURES.map((fixture, index) => [
          `user-${index + 1}`,
          {
            overallPower: fixture.overallPower,
            lanePower: fixture.lanePower,
          },
        ]),
      ),
    );
    prismaService.inhouseMatch.findMany.mockResolvedValue([]);
    prismaService.inhouseMatch.update.mockResolvedValue({});

    const response = await service.autoBalance('user-1', 'match-1', {});

    expect(response.candidates.length).toBeGreaterThanOrEqual(1);
    expect(response.candidates[0].teamA).toHaveLength(5);
    expect(response.candidates[0].teamB).toHaveLength(5);
    expect(prismaService.inhouseMatch.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'match-1' },
        data: expect.objectContaining({
          candidatesJson: expect.anything(),
        }),
      }),
    );
  });
});
