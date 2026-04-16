import { BadRequestException } from '@nestjs/common';
import { GroupRole, MatchStatus, ParticipationStatus, ResultStatus } from '@prisma/client';

import { MatchesService } from '../src/matches/matches.service';

describe('MatchesService', () => {
  const prismaService = {
    groupMember: {
      findUnique: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    inhouseMatch: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    inhouseMatchPlayer: {
      updateMany: jest.fn(),
    },
    inhousePlayerStat: {
      deleteMany: jest.fn(),
      findMany: jest.fn(),
    },
    inhouseMatchResult: {
      delete: jest.fn(),
    },
    playerPowerProfile: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  } as any;
  const groupsService = {
    assertGroupMember: jest.fn(),
  } as any;
  const auditLogService = {
    create: jest.fn(),
  } as any;

  let service: MatchesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MatchesService(prismaService, groupsService, auditLogService);
  });

  it('blocks reopen for confirmed results', async () => {
    prismaService.inhouseMatch.findUnique.mockResolvedValue({
      id: 'm1',
      groupId: 'g1',
      status: MatchStatus.CONFIRMED,
      createdBy: 'host1',
      title: 'Match',
      scheduledAt: null,
      balanceMode: null,
      selectedCandidateNo: null,
      candidatesJson: null,
      players: [],
      result: { id: 'r1', resultStatus: ResultStatus.CONFIRMED },
    });
    prismaService.groupMember.findUnique.mockResolvedValue({
      groupId: 'g1',
      userId: 'admin1',
      role: GroupRole.ADMIN,
    });
    prismaService.user.findUnique.mockResolvedValue({ isAdmin: false });

    await expect(service.reopenMatch('admin1', 'm1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reopens an unconfirmed match and clears stale result state', async () => {
    prismaService.inhouseMatch.findUnique.mockResolvedValue({
      id: 'm1',
      groupId: 'g1',
      status: MatchStatus.RESULT_PENDING,
      createdBy: 'host1',
      title: 'Match',
      scheduledAt: null,
      balanceMode: null,
      selectedCandidateNo: null,
      candidatesJson: null,
      players: [
        {
          id: 'p1',
          userId: 'u1',
          user: { nickname: 'Alpha' },
          riotAccountId: null,
          sameTeamPreferencesJson: null,
          avoidTeamPreferencesJson: null,
          isCaptain: false,
          teamSide: 'A',
          assignedRole: null,
          participationStatus: ParticipationStatus.LOCKED_IN,
        },
      ],
      result: { id: 'r1', resultStatus: ResultStatus.DISPUTED },
    });
    prismaService.groupMember.findUnique.mockResolvedValue({
      groupId: 'g1',
      userId: 'admin1',
      role: GroupRole.ADMIN,
    });
    prismaService.user.findUnique.mockResolvedValue({ isAdmin: false });
    prismaService.$transaction.mockImplementation(async (callback: any) =>
      callback({
        inhousePlayerStat: { deleteMany: jest.fn() },
        inhouseMatchResult: { delete: jest.fn() },
        inhouseMatchPlayer: { updateMany: jest.fn() },
        inhouseMatch: { update: jest.fn() },
      }),
    );

    jest.spyOn(service, 'getMatch').mockResolvedValue({
      id: 'm1',
      groupId: 'g1',
      status: MatchStatus.RECRUITING,
      scheduledAt: null,
      balanceMode: null,
      selectedCandidateNo: null,
      players: [],
      candidates: null,
    });

    const result = await service.reopenMatch('admin1', 'm1');

    expect(result.status).toBe(MatchStatus.RECRUITING);
    expect(auditLogService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'MATCH_REOPENED',
      }),
    );
  });
});
