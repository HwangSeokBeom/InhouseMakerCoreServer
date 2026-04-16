import {
  GroupRole,
  InputMode,
  LaneResult,
  MatchStatus,
  ParticipationStatus,
  ResultStatus,
  TeamSide,
} from '@prisma/client';

import { ResultsService } from '../src/results/results.service';

describe('ResultsService', () => {
  const prismaService = {
    inhouseMatchResult: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    inhousePlayerStat: {
      updateMany: jest.fn(),
    },
    inhouseMatch: {
      update: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    groupMember: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  } as any;
  const matchesService = {
    getMatchWithPlayers: jest.fn(),
  } as any;
  const notificationService = {
    createMany: jest.fn(),
  } as any;
  const queueService = {
    enqueuePowerRecalculation: jest.fn(),
  } as any;
  const auditLogService = {
    create: jest.fn(),
  } as any;
  const resultConfirmationPolicyService = {} as any;

  let service: ResultsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ResultsService(
      prismaService,
      matchesService,
      notificationService,
      queueService,
      auditLogService,
      resultConfirmationPolicyService,
    );
  });

  it('validates a guest quick-result preview without persisting anything', () => {
    const response = service.previewQuickResult({
      winningTeam: TeamSide.A,
      mvpUserId: 'u1',
      balanceRating: 4,
      players: [
        { userId: 'u1', teamSide: TeamSide.A, kills: 5, deaths: 2, assists: 7, laneResult: LaneResult.WIN, contributionRating: 4 },
        { userId: 'u2', teamSide: TeamSide.A, kills: 3, deaths: 4, assists: 8, laneResult: LaneResult.EVEN, contributionRating: 3 },
        { userId: 'u3', teamSide: TeamSide.A, kills: 6, deaths: 3, assists: 5, laneResult: LaneResult.WIN, contributionRating: 4 },
        { userId: 'u4', teamSide: TeamSide.A, kills: 8, deaths: 2, assists: 6, laneResult: LaneResult.WIN, contributionRating: 5 },
        { userId: 'u5', teamSide: TeamSide.A, kills: 1, deaths: 5, assists: 15, laneResult: LaneResult.EVEN, contributionRating: 3 },
        { userId: 'u6', teamSide: TeamSide.B, kills: 4, deaths: 6, assists: 3, laneResult: LaneResult.LOSE, contributionRating: 2 },
        { userId: 'u7', teamSide: TeamSide.B, kills: 2, deaths: 7, assists: 9, laneResult: LaneResult.LOSE, contributionRating: 2 },
        { userId: 'u8', teamSide: TeamSide.B, kills: 7, deaths: 5, assists: 2, laneResult: LaneResult.WIN, contributionRating: 4 },
        { userId: 'u9', teamSide: TeamSide.B, kills: 5, deaths: 4, assists: 4, laneResult: LaneResult.EVEN, contributionRating: 3 },
        { userId: 'u10', teamSide: TeamSide.B, kills: 0, deaths: 8, assists: 11, laneResult: LaneResult.LOSE, contributionRating: 1 },
      ],
    });

    expect(response).toEqual({
      validated: true,
      playerCount: 10,
      mvpUserId: 'u1',
      winningTeam: TeamSide.A,
      balanceRating: 4,
      teams: [
        {
          teamSide: TeamSide.A,
          playerCount: 5,
          kills: 23,
          deaths: 16,
          assists: 41,
        },
        {
          teamSide: TeamSide.B,
          playerCount: 5,
          kills: 18,
          deaths: 30,
          assists: 29,
        },
      ],
    });
    expect(prismaService.$transaction).not.toHaveBeenCalled();
    expect(notificationService.createMany).not.toHaveBeenCalled();
    expect(queueService.enqueuePowerRecalculation).not.toHaveBeenCalled();
    expect(auditLogService.create).not.toHaveBeenCalled();
    expect(matchesService.getMatchWithPlayers).not.toHaveBeenCalled();
  });

  it('rejects invalid quick-result preview payloads before any side effects run', () => {
    expect(() =>
      service.previewQuickResult({
        winningTeam: TeamSide.A,
        mvpUserId: 'u1',
        balanceRating: 4,
        players: [
          { userId: 'u1', teamSide: TeamSide.A, kills: 1, deaths: 1, assists: 1, laneResult: LaneResult.WIN },
        ],
      }),
    ).toThrow('Result preview requires exactly 10 players.');
    expect(prismaService.$transaction).not.toHaveBeenCalled();
    expect(notificationService.createMany).not.toHaveBeenCalled();
    expect(queueService.enqueuePowerRecalculation).not.toHaveBeenCalled();
    expect(auditLogService.create).not.toHaveBeenCalled();
  });

  it('resolves a disputed result through admin workflow and enqueues recalculation', async () => {
    matchesService.getMatchWithPlayers.mockResolvedValue({
      id: 'match-1',
      groupId: 'group-1',
      players: [
        { userId: 'u1', participationStatus: ParticipationStatus.LOCKED_IN },
        { userId: 'u2', participationStatus: ParticipationStatus.ACCEPTED },
      ],
    });
    prismaService.user.findUnique.mockResolvedValue({ isAdmin: true });
    prismaService.groupMember.findUnique.mockResolvedValue(null);
    prismaService.inhouseMatchResult.findFirst.mockResolvedValue({
      id: 'result-1',
      matchId: 'match-1',
      winningTeam: TeamSide.B,
      mvpUserId: 'u2',
      balanceRating: 3,
      resultStatus: ResultStatus.DISPUTED,
      version: 2,
      adminResolutionNote: null,
      payloadJson: {
        winningTeam: TeamSide.B,
        mvpUserId: 'u2',
        balanceRating: 3,
      },
    });
    prismaService.$transaction.mockImplementation(async (callback: any) =>
      callback({
        inhouseMatchResult: {
          update: jest.fn().mockResolvedValue({
            id: 'result-1',
            resultStatus: ResultStatus.CONFIRMED,
            version: 3,
            winningTeam: TeamSide.A,
            mvpUserId: 'u1',
            balanceRating: 4,
            adminResolutionNote: 'admin reviewed replay',
            adminResolvedAt: new Date('2026-04-12T12:00:00Z'),
          }),
        },
        inhousePlayerStat: {
          updateMany: jest.fn(),
        },
        inhouseMatch: {
          update: jest.fn().mockResolvedValue({
            status: MatchStatus.CONFIRMED,
          }),
        },
      }),
    );

    const response = await service.adminResolveDispute('admin-1', 'match-1', 'result-1', {
      winningTeam: TeamSide.A,
      mvpUserId: 'u1',
      balanceRating: 4,
      note: 'admin reviewed replay',
    });

    expect(response).toEqual({
      resultId: 'result-1',
      status: ResultStatus.CONFIRMED,
      version: 3,
      adminResolvedAt: '2026-04-12T12:00:00.000Z',
    });
    expect(queueService.enqueuePowerRecalculation).toHaveBeenCalledTimes(2);
    expect(notificationService.createMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          userId: 'u1',
          title: '내전 결과가 운영자에 의해 확정되었습니다',
        }),
      ]),
    );
    expect(auditLogService.create).toHaveBeenCalled();
  });

  it('blocks admin resolve when the result is not disputed', async () => {
    matchesService.getMatchWithPlayers.mockResolvedValue({
      id: 'match-1',
      groupId: 'group-1',
      players: [{ userId: 'u1', participationStatus: ParticipationStatus.LOCKED_IN }],
    });
    prismaService.user.findUnique.mockResolvedValue({ isAdmin: true });
    prismaService.groupMember.findUnique.mockResolvedValue(null);
    prismaService.inhouseMatchResult.findFirst.mockResolvedValue({
      id: 'result-1',
      matchId: 'match-1',
      winningTeam: TeamSide.A,
      mvpUserId: 'u1',
      balanceRating: 4,
      resultStatus: ResultStatus.CONFIRMED,
      version: 2,
      adminResolutionNote: null,
      payloadJson: { winningTeam: TeamSide.A },
    });

    await expect(
      service.adminResolveDispute('admin-1', 'match-1', 'result-1', {
        winningTeam: TeamSide.A,
        note: 'already done',
      }),
    ).rejects.toThrow('Only disputed results can be admin resolved.');
  });
});
