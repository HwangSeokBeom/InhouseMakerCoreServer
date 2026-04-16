import { MatchStatus, ParticipationStatus, Position, ResultStatus, TeamSide } from '@prisma/client';

import { GroupsService } from '../src/groups/groups.service';
import { UsersService } from '../src/users/users.service';

describe('Stats calculations', () => {
  it('computes user stats summary including power trend and group rank', async () => {
    const prismaService = {
      inhousePlayerStat: {
        findMany: jest.fn().mockResolvedValue([
          {
            userId: 'u1',
            role: Position.MID,
            teamSide: TeamSide.A,
            match: { result: { winningTeam: TeamSide.A } },
            createdAt: new Date('2026-04-12T10:00:00Z'),
          },
          {
            userId: 'u1',
            role: Position.MID,
            teamSide: TeamSide.B,
            match: { result: { winningTeam: TeamSide.A } },
            createdAt: new Date('2026-04-11T10:00:00Z'),
          },
        ]),
      },
      playerPowerProfile: {
        findUnique: jest.fn().mockResolvedValue({
          overallPower: 72,
          basePower: 68,
        }),
      },
      groupMember: {
        count: jest.fn().mockResolvedValue(2),
        findMany: jest.fn().mockResolvedValue([
          { userId: 'u2', user: { powerProfile: { overallPower: 75 } } },
          { userId: 'u1', user: { powerProfile: { overallPower: 72 } } },
        ]),
      },
      inhouseGroup: {
        count: jest.fn().mockResolvedValue(1),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'u1' }),
      },
    } as any;

    const service = new UsersService(prismaService);
    const result = await service.getUserStats(
      { userId: 'u1', email: 'u1@example.com' },
      'u1',
      { groupId: 'g1' },
    );

    expect(result).toEqual(
      expect.objectContaining({
        totalGames: 2,
        wins: 1,
        losses: 1,
        currentPower: 72,
        groupRank: 2,
      }),
    );
    expect(result.powerTrendSummary.direction).toBe('UP');
  });

  it('computes group leaderboard ordering by current power', async () => {
    const prismaService = {
      groupMember: {
        findUnique: jest.fn().mockResolvedValue({ userId: 'requester' }),
        findMany: jest.fn().mockResolvedValue([
          {
            userId: 'u1',
            user: { nickname: 'Alpha', powerProfile: { overallPower: 70 } },
          },
          {
            userId: 'u2',
            user: { nickname: 'Bravo', powerProfile: { overallPower: 74 } },
          },
        ]),
      },
      inhousePlayerStat: {
        findMany: jest.fn().mockResolvedValue([
          { userId: 'u1', teamSide: TeamSide.A, match: { result: { winningTeam: TeamSide.A } } },
          { userId: 'u2', teamSide: TeamSide.B, match: { result: { winningTeam: TeamSide.B } } },
        ]),
      },
    } as any;

    const service = new GroupsService(prismaService);
    const result = await service.getLeaderboard('requester', 'group1', { limit: 10 });

    expect(result.items[0]).toEqual(
      expect.objectContaining({
        userId: 'u2',
        groupRank: 1,
      }),
    );
  });
});
