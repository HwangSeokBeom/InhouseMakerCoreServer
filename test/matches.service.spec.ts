import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { GroupRole, MatchStatus, ParticipationStatus, Position, ResultStatus } from '@prisma/client';

import { AppErrorCode, AppException } from '../src/common/app.exception';
import { REALIZED_INHOUSE_MATCH_STATUSES } from '../src/matches/match-status.policy';
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
      findMany: jest.fn(),
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
    auditLog: {
      findFirst: jest.fn(),
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

  it('marks missing match ids as stale client references and flags fixture-like ids', async () => {
    prismaService.inhouseMatch.findUnique.mockResolvedValue(null);

    await expect(service.getMatch('viewer1', 'match-ui-test')).rejects.toMatchObject({
      response: expect.objectContaining({
        code: AppErrorCode.MATCH_NOT_FOUND,
        details: expect.objectContaining({
          matchId: 'match-ui-test',
          probableCause: 'stale_client_reference',
          fixtureHint: 'removed_fixture',
        }),
      }),
    });

    expect(groupsService.assertGroupMember).not.toHaveBeenCalled();
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

    await expect(service.reopenMatch('admin1', 'm1')).rejects.toMatchObject({
      response: expect.objectContaining({
        code: AppErrorCode.MATCH_REOPEN_NOT_ALLOWED,
      }),
    });
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
      matchId: 'm1',
      canonicalMatchId: 'm1',
      groupId: 'g1',
      groupName: 'Group',
      status: MatchStatus.RECRUITING,
      title: null,
      notes: null,
      scheduledAt: null,
      playedAt: null,
      updatedAt: '2026-04-18T00:00:00.000Z',
      balanceMode: null,
      selectedCandidateNo: null,
      players: [],
      blueTeam: null,
      redTeam: null,
      winningTeam: null,
      resultStatus: null,
      resultSummary: null,
      candidates: null,
      manualBalance: null,
      rematchInput: {
        matchId: 'm1',
        canonicalMatchId: 'm1',
        groupId: 'g1',
        groupName: 'Group',
        players: [],
        options: {
          supportedStrategies: [],
          excludePreviousCombinationSupported: true,
          regenerateNonceSupported: true,
          defaultExcludePreviousCombination: true,
          excludePreviousCombinationKeys: [],
        },
      },
    });

    const result = await service.reopenMatch('admin1', 'm1');

    expect(result.status).toBe(MatchStatus.RECRUITING);
    expect(auditLogService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'MATCH_REOPENED',
      }),
    );
  });

  it('returns enriched match detail with result summary and rematch input', async () => {
    groupsService.assertGroupMember.mockResolvedValue({ isMember: true });
    prismaService.inhouseMatch.findUnique.mockResolvedValue({
      id: 'm1',
      groupId: 'g1',
      createdBy: 'host1',
      title: 'Spring Finals',
      notes: 'Bo1',
      status: MatchStatus.BALANCED,
      scheduledAt: new Date('2026-04-18T10:00:00.000Z'),
      updatedAt: new Date('2026-04-18T12:00:00.000Z'),
      balanceMode: 'BALANCED',
      selectedCandidateNo: 1,
      candidatesJson: [
        {
          candidateNo: 1,
          combinationKey: 'u1-TOP|u2-JUNGLE|u3-MID|u4-ADC|u5-SUPPORT',
        },
      ],
      group: {
        id: 'g1',
        name: 'Alpha',
      },
      players: [
        {
          id: 'p1',
          userId: 'u1',
          riotAccountId: null,
          positionPrefSnapshot: {
            overallPower: 60,
            lanePower: {
              TOP: 61,
              JUNGLE: 58,
              MID: 57,
              ADC: 54,
              SUPPORT: 53,
            },
            primaryPosition: Position.TOP,
            secondaryPosition: Position.MID,
            isFillAvailable: false,
            calculatedAt: '2026-04-18T09:00:00.000Z',
            version: 'power-v1',
            source: 'MATCH_SNAPSHOT',
          },
          sameTeamPreferencesJson: ['u2'],
          avoidTeamPreferencesJson: [],
          user: {
            id: 'u1',
            nickname: 'Top',
            primaryPosition: Position.TOP,
            secondaryPosition: Position.MID,
            isFillAvailable: false,
            powerProfile: {
              overallPower: 62,
              lanePowerJson: {
                TOP: 62,
                JUNGLE: 58,
                MID: 59,
                ADC: 55,
                SUPPORT: 54,
              },
              calculatedAt: new Date('2026-04-18T09:30:00.000Z'),
              version: 'power-v2',
            },
          },
          teamSide: 'A',
          assignedRole: Position.TOP,
          participationStatus: ParticipationStatus.LOCKED_IN,
          isCaptain: true,
        },
        {
          id: 'p2',
          userId: 'u6',
          riotAccountId: null,
          positionPrefSnapshot: null,
          sameTeamPreferencesJson: [],
          avoidTeamPreferencesJson: ['u1'],
          user: {
            id: 'u6',
            nickname: 'Jungle',
            primaryPosition: Position.JUNGLE,
            secondaryPosition: Position.TOP,
            isFillAvailable: true,
            powerProfile: {
              overallPower: 55,
              lanePowerJson: {
                TOP: 54,
                JUNGLE: 57,
                MID: 52,
                ADC: 50,
                SUPPORT: 51,
              },
              calculatedAt: new Date('2026-04-18T09:45:00.000Z'),
              version: 'power-v2',
            },
          },
          teamSide: 'B',
          assignedRole: Position.JUNGLE,
          participationStatus: ParticipationStatus.LOCKED_IN,
          isCaptain: false,
        },
      ],
      result: {
        id: 'r1',
        matchId: 'm1',
        winningTeam: 'A',
        mvpUserId: 'u1',
        balanceRating: 4,
        resultStatus: ResultStatus.CONFIRMED,
        inputMode: 'QUICK',
        submittedBy: 'host1',
        confirmedAt: new Date('2026-04-18T12:30:00.000Z'),
        adminResolvedById: null,
        adminResolutionNote: null,
        adminResolvedAt: null,
        version: 1,
        updatedAt: new Date('2026-04-18T12:30:00.000Z'),
      },
    });
    prismaService.inhousePlayerStat.findMany.mockResolvedValue([
      {
        userId: 'u1',
        teamSide: 'A',
        role: Position.TOP,
        kills: 7,
        deaths: 2,
        assists: 8,
        laneResult: 'WIN',
        contributionRating: 5,
        createdAt: new Date('2026-04-18T12:20:00.000Z'),
      },
      {
        userId: 'u6',
        teamSide: 'B',
        role: Position.JUNGLE,
        kills: 2,
        deaths: 6,
        assists: 3,
        laneResult: 'LOSE',
        contributionRating: 2,
        createdAt: new Date('2026-04-18T12:20:00.000Z'),
      },
    ]);

    const response = await service.getMatch('viewer1', 'm1');

    expect(response.resultSummary).toEqual(
      expect.objectContaining({
        resultId: 'r1',
        winningTeam: 'A',
        balanceFeeling: 4,
        playerStatsCount: 2,
      }),
    );
    expect(response.blueTeam?.players[0].resultStats?.kda).toBe('7/2/8');
    expect(response.rematchInput?.players[0]).toEqual(
      expect.objectContaining({
        userId: 'u1',
        sameTeamPreferenceUserIds: ['u2'],
        overallPower: 60,
      }),
    );
    expect(response.rematchInput?.options.excludePreviousCombinationKeys).toEqual([
      'u1-TOP|u2-JUNGLE|u3-MID|u4-ADC|u5-SUPPORT',
    ]);
    expect(response.playedAt).toBe('2026-04-18T12:30:00.000Z');
  });

  it('exposes result input candidates and lane targets for a balanced 10-player match', async () => {
    groupsService.assertGroupMember.mockResolvedValue({ isMember: true });
    const roles = [
      Position.TOP,
      Position.JUNGLE,
      Position.MID,
      Position.ADC,
      Position.SUPPORT,
    ];
    prismaService.inhouseMatch.findUnique.mockResolvedValue({
      id: 'm1',
      groupId: 'g1',
      createdBy: 'host1',
      title: 'Balanced Match',
      notes: null,
      status: MatchStatus.BALANCED,
      scheduledAt: null,
      updatedAt: new Date('2026-04-18T12:00:00.000Z'),
      balanceMode: 'BALANCED',
      selectedCandidateNo: 1,
      candidatesJson: [],
      group: {
        id: 'g1',
        name: 'Alpha',
      },
      players: Array.from({ length: 10 }, (_, index) => {
        const role = roles[index % 5];
        return {
          id: `p${index + 1}`,
          userId: `u${index + 1}`,
          riotAccountId: null,
          positionPrefSnapshot: null,
          sameTeamPreferencesJson: [],
          avoidTeamPreferencesJson: [],
          user: {
            id: `u${index + 1}`,
            nickname: `User${index + 1}`,
            primaryPosition: role,
            secondaryPosition: null,
            isFillAvailable: true,
            powerProfile: {
              overallPower: 60 + index,
              lanePowerJson: null,
              calculatedAt: new Date('2026-04-18T09:30:00.000Z'),
              version: 'power-v2',
            },
          },
          teamSide: index < 5 ? 'A' : 'B',
          assignedRole: role,
          participationStatus: ParticipationStatus.LOCKED_IN,
          isCaptain: index === 0,
        };
      }),
      result: null,
    });
    prismaService.inhousePlayerStat.findMany.mockResolvedValue([]);

    const response = await service.getMatch('viewer1', 'm1');

    expect(response.canSubmitResult).toBe(true);
    expect(response.resultInputBlockedReason).toBeNull();
    expect(response.mvpCandidates).toHaveLength(10);
    expect(response.laneResultTargets).toHaveLength(10);
    expect(response.laneResultTargets?.filter((target) => target.teamSide === 'A').map((target) => target.assignedRole)).toEqual(roles);
    expect(response.laneResultTargets?.filter((target) => target.teamSide === 'B').map((target) => target.assignedRole)).toEqual(roles);
  });

  it('persists a manual balance and returns the saved match snapshot', async () => {
    prismaService.inhouseMatch.findUnique
      .mockResolvedValueOnce({
        id: 'm1',
        groupId: 'g1',
        createdBy: 'host1',
        players: [
          { userId: 'host1', isCaptain: false },
          { userId: 'u2', isCaptain: false },
        ],
      })
      .mockResolvedValueOnce({
        id: 'm1',
        groupId: 'g1',
        createdBy: 'host1',
        status: MatchStatus.LOCKED,
        balanceMode: null,
        players: Array.from({ length: 10 }, (_, index) => ({
          id: `p${index + 1}`,
          userId: `u${index + 1}`,
          user: {
            nickname: `User${index + 1}`,
            primaryPosition: null,
            secondaryPosition: null,
            powerProfile: null,
          },
          teamSide: null,
          assignedRole: null,
          participationStatus: ParticipationStatus.ACCEPTED,
          isCaptain: false,
        })),
        result: null,
        updatedAt: new Date('2026-04-18T11:00:00.000Z'),
        group: { id: 'g1', name: 'Alpha' },
      });
    prismaService.groupMember.findUnique.mockResolvedValue({
      groupId: 'g1',
      userId: 'host1',
      role: GroupRole.OWNER,
    });
    prismaService.$transaction.mockImplementation(async (callback: any) =>
      callback({
        inhouseMatchPlayer: { update: jest.fn() },
        inhouseMatch: { update: jest.fn() },
      }),
    );
    jest.spyOn(service, 'getMatch').mockResolvedValue({
      id: 'm1',
      matchId: 'm1',
      canonicalMatchId: 'm1',
      groupId: 'g1',
      groupName: 'Alpha',
      status: MatchStatus.BALANCED,
      title: null,
      notes: null,
      scheduledAt: null,
      playedAt: null,
      updatedAt: '2026-04-18T11:00:00.000Z',
      balanceMode: null,
      selectedCandidateNo: null,
      players: [],
      blueTeam: null,
      redTeam: null,
      winningTeam: null,
      resultStatus: null,
      resultSummary: null,
      candidates: null,
      manualBalance: {
        matchId: 'm1',
        updatedAt: '2026-04-18T11:00:00.000Z',
        updatedBy: 'host1',
      },
      rematchInput: {
        matchId: 'm1',
        canonicalMatchId: 'm1',
        groupId: 'g1',
        groupName: 'Alpha',
        players: [],
        options: {
          supportedStrategies: [],
          excludePreviousCombinationSupported: true,
          regenerateNonceSupported: true,
          defaultExcludePreviousCombination: true,
          excludePreviousCombinationKeys: [],
        },
      },
    });

    const response = await service.saveManualBalance('host1', 'm1', {
      blueTeam: {
        players: [
          { userId: 'u1', assignedRole: Position.TOP },
          { userId: 'u2', assignedRole: Position.JUNGLE },
          { userId: 'u3', assignedRole: Position.MID },
          { userId: 'u4', assignedRole: Position.ADC },
          { userId: 'u5', assignedRole: Position.SUPPORT },
        ],
      },
      redTeam: {
        players: [
          { userId: 'u6', assignedRole: Position.TOP },
          { userId: 'u7', assignedRole: Position.JUNGLE },
          { userId: 'u8', assignedRole: Position.MID },
          { userId: 'u9', assignedRole: Position.ADC },
          { userId: 'u10', assignedRole: Position.SUPPORT },
        ],
      },
    });

    expect(auditLogService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'MATCH_MANUAL_BALANCE_SAVED',
        entityId: 'm1',
      }),
    );
    expect(response.status).toBe(MatchStatus.BALANCED);
    expect(response.manualBalance?.updatedBy).toBe('host1');
  });

  it('filters recent match lists to realized statuses only', async () => {
    prismaService.inhouseMatch.findMany.mockResolvedValue([
      {
        id: 'm1',
        groupId: 'g1',
        group: {
          id: 'g1',
          name: 'Alpha',
        },
        title: 'Confirmed match',
        status: MatchStatus.CONFIRMED,
        scheduledAt: new Date('2026-04-18T10:00:00.000Z'),
        updatedAt: new Date('2026-04-18T12:00:00.000Z'),
        result: {
          winningTeam: 'A',
          resultStatus: ResultStatus.CONFIRMED,
        },
        players: [{ id: 'p1' }],
      },
    ]);

    const response = await service.listRecentMatches('viewer1', { groupId: 'g1', limit: 20 });

    expect(groupsService.assertGroupMember).toHaveBeenCalledWith('g1', 'viewer1');
    expect(prismaService.inhouseMatch.findMany).toHaveBeenCalledWith({
      where: {
        groupId: 'g1',
        status: {
          in: REALIZED_INHOUSE_MATCH_STATUSES,
        },
        group: {
          archivedAt: null,
          members: {
            some: {
              userId: 'viewer1',
            },
          },
        },
      },
      include: {
        group: {
          select: {
            id: true,
            name: true,
          },
        },
        result: true,
        players: {
          select: {
            id: true,
          },
        },
      },
      orderBy: [{ scheduledAt: 'desc' }, { updatedAt: 'desc' }, { createdAt: 'desc' }],
      take: 20,
    });
    expect(response.items).toEqual([
      expect.objectContaining({
        matchId: 'm1',
        status: MatchStatus.CONFIRMED,
      }),
    ]);
  });
});
