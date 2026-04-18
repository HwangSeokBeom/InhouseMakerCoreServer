import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { GroupRole, GroupVisibility, JoinPolicy } from '@prisma/client';

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
    },
  } as any;
  const auditLogService = {
    create: jest.fn(),
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
    service = new GroupsService(prismaService, auditLogService);
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
      await service.getGroup('owner1', 'missing-group');
      throw new Error('Expected missing group lookup to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AppException);
      expect(getExceptionBody(error)).toMatchObject({
        details: {
          reason: 'GROUP_NOT_FOUND',
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
          reason: 'GROUP_ACCESS_FORBIDDEN',
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
});
