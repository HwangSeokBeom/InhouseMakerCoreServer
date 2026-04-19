import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { GroupRole, GroupVisibility, JoinPolicy, Position, Prisma } from '@prisma/client';

import { AppException } from '../src/common/app.exception';
import { GroupsService } from '../src/groups/groups.service';

describe('GroupsService', () => {
  const prismaService = {
    inhouseGroup: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    groupMember: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
    inhousePlayerStat: {
      findMany: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
  } as any;
  const auditLogService = {
    create: jest.fn(),
  } as any;
  const usersService = {
    findInviteUsers: jest.fn(),
  } as any;

  let service: GroupsService;

  const getExceptionBody = (error: unknown) =>
    (error as { getResponse: () => unknown }).getResponse() as Record<string, unknown>;

  const makeGroup = (overrides: Record<string, unknown> = {}) => ({
    id: 'group1',
    ownerUserId: 'owner1',
    name: 'Alpha Inhouse',
    region: 'kr',
    description: 'Seed group',
    visibility: GroupVisibility.PRIVATE,
    joinPolicy: JoinPolicy.INVITE_ONLY,
    tags: ['competitive'],
    archivedAt: null,
    _count: {
      members: 3,
      matches: 2,
      recruitingPosts: 1,
    },
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    service = new GroupsService(prismaService, auditLogService, usersService);
  });

  it('updates a group for its owner', async () => {
    prismaService.inhouseGroup.findFirst.mockResolvedValueOnce(makeGroup());
    prismaService.user.findUnique.mockResolvedValue({ isAdmin: false });
    prismaService.inhouseGroup.update.mockResolvedValue(
      makeGroup({
        name: 'Beta Inhouse',
        region: 'na',
        description: 'Updated',
        visibility: GroupVisibility.PUBLIC,
        tags: ['casual'],
      }),
    );

    const result = await service.updateGroup('owner1', 'group1', {
      name: 'Beta Inhouse',
      region: 'na',
      description: 'Updated',
      visibility: GroupVisibility.PUBLIC,
      tags: ['casual'],
    });

    expect(prismaService.inhouseGroup.update).toHaveBeenCalledWith({
      where: { id: 'group1' },
      data: {
        name: 'Beta Inhouse',
        region: 'na',
        description: 'Updated',
        visibility: GroupVisibility.PUBLIC,
        tags: ['casual'],
      },
      include: {
        members: {
          where: {
            userId: 'owner1',
          },
          select: {
            userId: true,
            role: true,
          },
          take: 1,
        },
        _count: {
          select: {
            members: true,
            matches: true,
          },
        },
      },
    });
    expect(result).toMatchObject({
      id: 'group1',
      name: 'Beta Inhouse',
      region: 'na',
      visibility: GroupVisibility.PUBLIC,
      tags: ['casual'],
    });
  });

  it('returns 403 when a non-owner non-admin updates a group', async () => {
    prismaService.inhouseGroup.findFirst.mockResolvedValue(makeGroup());
    prismaService.user.findUnique.mockResolvedValue({ isAdmin: false });

    await expect(
      service.updateGroup('member1', 'group1', {
        name: 'Unauthorized',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns 404 when updating a missing group', async () => {
    prismaService.inhouseGroup.findFirst.mockResolvedValue(null);

    await expect(
      service.updateGroup('owner1', 'missing-group', {
        name: 'Missing',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('archives a group for its owner instead of hard deleting it', async () => {
    prismaService.inhouseGroup.findFirst.mockResolvedValue(makeGroup());
    prismaService.user.findUnique.mockResolvedValue({ isAdmin: false });
    prismaService.inhouseGroup.update.mockResolvedValue(
      makeGroup({
        archivedAt: new Date('2026-04-18T10:00:00.000Z'),
      }),
    );

    const result = await service.deleteGroup('owner1', 'group1');

    expect(prismaService.inhouseGroup.update).toHaveBeenCalledWith({
      where: { id: 'group1' },
      data: {
        archivedAt: expect.any(Date),
      },
    });
    expect(result).toEqual(
      expect.objectContaining({
        id: 'group1',
        archivedAt: expect.any(String),
      }),
    );
  });

  it('returns 403 when a non-owner non-admin deletes a group', async () => {
    prismaService.inhouseGroup.findFirst.mockResolvedValue(makeGroup());
    prismaService.user.findUnique.mockResolvedValue({ isAdmin: false });

    await expect(service.deleteGroup('member1', 'group1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('returns 404 when deleting a missing group', async () => {
    prismaService.inhouseGroup.findFirst.mockResolvedValue(null);

    await expect(service.deleteGroup('owner1', 'missing-group')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('filters archived groups out of the public list', async () => {
    prismaService.inhouseGroup.findMany.mockResolvedValue([]);

    await service.listPublicGroups({});

    expect(prismaService.inhouseGroup.findMany).toHaveBeenCalledWith({
      where: {
        visibility: GroupVisibility.PUBLIC,
        archivedAt: null,
      },
      include: {
        _count: {
          select: {
            members: true,
            matches: true,
          },
        },
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      take: 20,
    });
  });

  it('treats archived groups as not found on detail fetches', async () => {
    const archivedAt = new Date('2026-04-18T10:00:00.000Z');
    prismaService.inhouseGroup.findFirst.mockResolvedValue(
      makeGroup({
        archivedAt,
        members: [{ userId: 'owner1', role: GroupRole.OWNER }],
        matches: [],
      }),
    );
    const loggerSpy = jest
      .spyOn(service['logger'], 'warn')
      .mockImplementation(() => undefined);

    try {
      await service.getGroup('owner1', 'group1');
      throw new Error('Expected archived group lookup to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AppException);
      expect(getExceptionBody(error)).toMatchObject({
        message: 'The group no longer exists or is unavailable.',
        details: {
          reason: 'GROUP_UNAVAILABLE',
        },
      });
    }

    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringContaining('"action":"group_archived_lookup"'),
    );
    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringContaining('"deniedReason":"GROUP_UNAVAILABLE"'),
    );
    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringContaining('"groupArchivedAt":"2026-04-18T10:00:00.000Z"'),
    );
  });

  it('distinguishes missing groups from archived groups on detail fetches', async () => {
    prismaService.inhouseGroup.findFirst.mockResolvedValue(null);
    const loggerSpy = jest
      .spyOn(service['logger'], 'warn')
      .mockImplementation(() => undefined);

    try {
      await service.getGroup('owner1', 'group-ui-test');
      throw new Error('Expected missing group lookup to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AppException);
      expect(getExceptionBody(error)).toMatchObject({
        details: {
          reason: 'GROUP_NOT_FOUND',
          groupId: 'group-ui-test',
          probableCause: 'stale_client_reference',
          fixtureHint: 'removed_fixture',
        },
      });
    }

    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringContaining('"resourceState":"resource_missing"'),
    );
    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringContaining('"deniedReason":"GROUP_NOT_FOUND"'),
    );
  });

  it('keeps access denied separate from archived group failures on detail fetches', async () => {
    prismaService.inhouseGroup.findFirst.mockResolvedValue(
      makeGroup({
        visibility: GroupVisibility.PRIVATE,
        archivedAt: null,
        members: [{ userId: 'member1', role: GroupRole.MEMBER }],
        matches: [],
      }),
    );
    const loggerSpy = jest
      .spyOn(service['logger'], 'warn')
      .mockImplementation(() => undefined);

    try {
      await service.getGroup('outsider1', 'group1');
      throw new Error('Expected access denied');
    } catch (error) {
      expect(error).toBeInstanceOf(AppException);
      expect(getExceptionBody(error)).toMatchObject({
        code: 'GROUP_ACCESS_FORBIDDEN',
        details: {
          groupId: 'group1',
          reason: 'NOT_GROUP_MEMBER',
          probableCause: 'not_member',
        },
      });
    }

    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringContaining('"resourceState":"access_denied"'),
    );
    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringContaining('"deniedReason":"GROUP_ACCESS_FORBIDDEN"'),
    );
  });

  it('uses archived reason for member-only group endpoints after deletion', async () => {
    prismaService.inhouseGroup.findFirst.mockResolvedValue({
      id: 'group1',
      ownerUserId: 'owner1',
      archivedAt: new Date('2026-04-18T10:00:00.000Z'),
      visibility: GroupVisibility.PRIVATE,
      members: [{ userId: 'requester', role: GroupRole.MEMBER }],
    });

    try {
      await service.assertGroupMember('group1', 'requester', {
        action: 'group_member_list_denied',
        operation: 'GET /groups/:groupId/members',
      });
      throw new Error('Expected archived member assertion to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AppException);
      expect(getExceptionBody(error)).toMatchObject({
        details: {
          reason: 'GROUP_UNAVAILABLE',
        },
      });
    }
  });

  it('keeps existing leaderboard ordering by current power', async () => {
    prismaService.inhouseGroup.findFirst.mockResolvedValue({
      id: 'group1',
      ownerUserId: 'owner1',
      archivedAt: null,
      visibility: GroupVisibility.PRIVATE,
      members: [{ userId: 'requester', role: GroupRole.MEMBER }],
    });
    prismaService.groupMember.findMany.mockResolvedValue([
      {
        userId: 'u1',
        user: { nickname: 'Alpha', powerProfile: { overallPower: 70 } },
      },
      {
        userId: 'u2',
        user: { nickname: 'Bravo', powerProfile: { overallPower: 74 } },
      },
    ]);
    prismaService.inhousePlayerStat.findMany.mockResolvedValue([
      {
        userId: 'u1',
        teamSide: 'A',
        match: { result: { winningTeam: 'A' } },
      },
      {
        userId: 'u2',
        teamSide: 'B',
        match: { result: { winningTeam: 'B' } },
      },
    ]);

    const result = await service.getLeaderboard('requester', 'group1', { limit: 10 });

    expect(result.items[0]).toEqual(
      expect.objectContaining({
        userId: 'u2',
        groupRank: 1,
      }),
    );
  });

  it('returns USER_NOT_FOUND before Prisma FK errors when adding a missing user', async () => {
    prismaService.inhouseGroup.findFirst.mockResolvedValue(
      makeGroup({
        members: [{ userId: 'leader1', role: GroupRole.OWNER }],
      }),
    );
    prismaService.user.findUnique.mockResolvedValue(null);

    try {
      await service.addMember('leader1', 'group1', {
        userId: 'missing-user',
      });
      throw new Error('Expected addMember to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AppException);
      expect(getExceptionBody(error)).toMatchObject({
        code: 'USER_NOT_FOUND',
        details: {
          groupId: 'group1',
          userId: 'missing-user',
        },
      });
    }

    expect(prismaService.groupMember.create).not.toHaveBeenCalled();
  });

  it('returns GROUP_MEMBER_ALREADY_EXISTS when adding an existing member', async () => {
    prismaService.inhouseGroup.findFirst.mockResolvedValue(
      makeGroup({
        members: [{ userId: 'leader1', role: GroupRole.OWNER }],
      }),
    );
    prismaService.user.findUnique.mockResolvedValue({ id: 'member1' });
    prismaService.groupMember.findUnique.mockResolvedValue({
      id: 'membership1',
      role: GroupRole.MEMBER,
    });

    try {
      await service.addMember('leader1', 'group1', {
        userId: 'member1',
      });
      throw new Error('Expected duplicate member add to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AppException);
      expect(getExceptionBody(error)).toMatchObject({
        code: 'GROUP_MEMBER_ALREADY_EXISTS',
        details: {
          groupId: 'group1',
          userId: 'member1',
          role: GroupRole.MEMBER,
        },
      });
    }

    expect(prismaService.groupMember.create).not.toHaveBeenCalled();
  });

  it('returns GROUP_ACCESS_FORBIDDEN when a non-leader tries to add members', async () => {
    prismaService.inhouseGroup.findFirst.mockResolvedValue(
      makeGroup({
        members: [{ userId: 'member1', role: GroupRole.MEMBER }],
      }),
    );

    try {
      await service.addMember('member1', 'group1', {
        userId: 'target1',
      });
      throw new Error('Expected non-admin addMember to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AppException);
      expect(getExceptionBody(error)).toMatchObject({
        code: 'GROUP_ACCESS_FORBIDDEN',
        details: {
          reason: 'NOT_GROUP_LEADER',
        },
      });
    }
  });

  it('adds a member successfully after domain validation', async () => {
    prismaService.inhouseGroup.findFirst.mockResolvedValue(
      makeGroup({
        members: [{ userId: 'leader1', role: GroupRole.OWNER }],
      }),
    );
    prismaService.user.findUnique.mockResolvedValue({ id: 'target1' });
    prismaService.groupMember.findUnique.mockResolvedValue(null);
    prismaService.groupMember.create.mockResolvedValue({
      id: 'membership2',
    });
    const listMembersSpy = jest
      .spyOn(service, 'listMembers')
      .mockResolvedValue({ items: [] });

    const result = await service.addMember('leader1', 'group1', {
      userId: 'target1',
    });

    expect(prismaService.groupMember.create).toHaveBeenCalledWith({
      data: {
        groupId: 'group1',
        userId: 'target1',
        role: GroupRole.MEMBER,
      },
    });
    expect(listMembersSpy).toHaveBeenCalledWith('leader1', 'group1');
    expect(result).toEqual({ items: [] });
  });

  it('maps group membership FK races back to USER_NOT_FOUND or GROUP_NOT_FOUND', async () => {
    prismaService.inhouseGroup.findFirst.mockResolvedValue(
      makeGroup({
        members: [{ userId: 'leader1', role: GroupRole.OWNER }],
      }),
    );
    prismaService.user.findUnique.mockResolvedValue({ id: 'target1' });
    prismaService.groupMember.findUnique.mockResolvedValue(null);

    const userForeignKeyError = new Error(
      'Foreign key constraint failed on the field: `group_members_user_id_fkey`',
    ) as any;
    Object.setPrototypeOf(userForeignKeyError, Prisma.PrismaClientKnownRequestError.prototype);
    userForeignKeyError.code = 'P2003';
    userForeignKeyError.meta = { field_name: 'group_members_user_id_fkey' };

    prismaService.groupMember.create.mockRejectedValueOnce(userForeignKeyError);

    await expect(
      service.addMember('leader1', 'group1', {
        userId: 'target1',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'USER_NOT_FOUND',
      }),
    });

    const groupForeignKeyError = new Error(
      'Foreign key constraint failed on the field: `group_members_group_id_fkey`',
    ) as any;
    Object.setPrototypeOf(groupForeignKeyError, Prisma.PrismaClientKnownRequestError.prototype);
    groupForeignKeyError.code = 'P2003';
    groupForeignKeyError.meta = { field_name: 'group_members_group_id_fkey' };

    prismaService.groupMember.create.mockRejectedValueOnce(groupForeignKeyError);

    await expect(
      service.addMember('leader1', 'group1', {
        userId: 'target1',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'GROUP_NOT_FOUND',
      }),
    });
  });

  it('includes capability flags on group detail for public non-members', async () => {
    prismaService.inhouseGroup.findFirst.mockResolvedValue(
      makeGroup({
        visibility: GroupVisibility.PUBLIC,
        members: [],
      }),
    );
    prismaService.user.findUnique.mockResolvedValue({ isAdmin: false });

    const result = await service.getGroup('viewer1', 'group1');

    expect(result).toMatchObject({
      canInviteMembers: false,
      inviteMembersBlockedReason: 'NOT_GROUP_MEMBER',
      canCreateMatch: false,
      createMatchBlockedReason: 'NOT_GROUP_MEMBER',
      canViewMembers: false,
      viewMembersBlockedReason: 'NOT_GROUP_MEMBER',
      canEditGroup: false,
      editGroupBlockedReason: 'NOT_GROUP_MEMBER',
    });
  });

  it('returns invite candidate states the client can render directly', async () => {
    prismaService.inhouseGroup.findFirst.mockResolvedValue(
      makeGroup({
        members: [{ userId: 'leader1', role: GroupRole.OWNER }],
      }),
    );
    usersService.findInviteUsers.mockResolvedValue([
      {
        id: 'leader1',
        userId: 'leader1',
        nickname: 'Leader',
        primaryPosition: null,
        mainPosition: null,
        secondaryPosition: null,
        recentPower: 72,
        riotDisplayName: null,
        riotGameName: null,
        tagLine: null,
        region: null,
        profileIconId: null,
        summonerLevel: null,
        profileImageUrl: null,
        isSelf: true,
        alreadyMember: true,
        memberRole: GroupRole.OWNER,
      },
      {
        id: 'member1',
        userId: 'member1',
        nickname: 'ExistingMember',
        primaryPosition: Position.MID,
        mainPosition: Position.MID,
        secondaryPosition: Position.TOP,
        recentPower: 80,
        riotDisplayName: null,
        riotGameName: null,
        tagLine: null,
        region: null,
        profileIconId: null,
        summonerLevel: null,
        profileImageUrl: null,
        isSelf: false,
        alreadyMember: true,
        memberRole: GroupRole.MEMBER,
      },
      {
        id: 'candidate1',
        userId: 'candidate1',
        nickname: 'Candidate',
        primaryPosition: Position.SUPPORT,
        mainPosition: Position.SUPPORT,
        secondaryPosition: Position.ADC,
        recentPower: 88,
        riotDisplayName: 'Candidate#KR1',
        riotGameName: 'Candidate',
        tagLine: 'KR1',
        region: 'kr',
        profileIconId: 12,
        summonerLevel: 300,
        profileImageUrl: null,
        isSelf: false,
        alreadyMember: false,
        memberRole: null,
      },
    ]);

    const result = await service.searchMemberCandidates('leader1', 'group1', {
      query: 'ca',
      limit: 20,
    });

    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: 'leader1',
          selectable: false,
          inviteBlockedReason: 'CANNOT_ADD_SELF',
        }),
        expect.objectContaining({
          userId: 'member1',
          alreadyMember: true,
          selectable: false,
          inviteBlockedReason: 'ALREADY_MEMBER',
          memberRole: GroupRole.MEMBER,
        }),
        expect.objectContaining({
          userId: 'candidate1',
          alreadyMember: false,
          selectable: true,
          inviteBlockedReason: null,
          representativePosition: Position.SUPPORT,
          riotDisplayName: 'Candidate#KR1',
          riotAccountSummary: expect.objectContaining({
            gameName: 'Candidate',
            tagLine: 'KR1',
          }),
        }),
      ]),
    );
  });
});
