import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  GroupRole,
  GroupVisibility,
  NotificationType,
  Position,
  RecruitingPostStatus,
  RecruitingPostType,
} from '@prisma/client';

import { GroupsService } from '../src/groups/groups.service';
import { AppException } from '../src/common/app.exception';
import { RecruitingService } from '../src/recruiting/recruiting.service';

describe('RecruitingService', () => {
  const prismaService = {
    recruitingPost: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    groupMember: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    recruitingPostApplication: {
      create: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    inhouseGroup: {
      findFirst: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn((operations: Array<Promise<unknown>>) => Promise.all(operations)),
  } as any;
  const groupsService = {
    assertGroupMember: jest.fn(),
    getGroupCapabilities: jest.fn(),
  } as any;
  const notificationService = {
    createMany: jest.fn(),
  } as any;
  const auditLogService = {
    create: jest.fn(),
  } as any;

  let service: RecruitingService;

  const getExceptionBody = (error: unknown) =>
    (error as { getResponse: () => unknown }).getResponse() as Record<string, unknown>;

  const makePost = (overrides: Record<string, unknown> = {}) => ({
    id: 'post1',
    groupId: 'group1',
    createdBy: 'author1',
    postType: RecruitingPostType.MEMBER_RECRUIT,
    title: 'Need support',
    body: null,
    tags: [],
    requiredPositionsJson: [Position.SUPPORT],
    status: RecruitingPostStatus.OPEN,
    scheduledAt: null,
    deletedAt: null,
    createdAt: new Date('2026-04-18T09:00:00.000Z'),
    updatedAt: new Date('2026-04-18T09:00:00.000Z'),
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    groupsService.getGroupCapabilities.mockResolvedValue({
      canInviteMembers: false,
      inviteMembersBlockedReason: 'NOT_GROUP_LEADER',
      canCreateMatch: true,
      createMatchBlockedReason: null,
      canViewMembers: true,
      viewMembersBlockedReason: null,
      canEditGroup: false,
      editGroupBlockedReason: 'NOT_GROUP_LEADER',
    });
    service = new RecruitingService(
      prismaService,
      groupsService,
      notificationService,
      auditLogService,
    );
  });

  it('creates a post and lets the author fetch its detail immediately', async () => {
    const createdPost = makePost();
    prismaService.recruitingPost.create.mockResolvedValue(createdPost);
    prismaService.groupMember.findMany.mockResolvedValue([]);
    prismaService.recruitingPost.findFirst.mockResolvedValue({
      ...createdPost,
      group: { visibility: GroupVisibility.PRIVATE },
    });
    prismaService.groupMember.findUnique.mockResolvedValue({
      groupId: 'group1',
      userId: 'author1',
    });

    const created = await service.createPost('author1', {
      groupId: 'group1',
      postType: RecruitingPostType.MEMBER_RECRUIT,
      title: 'Need support',
      tags: [],
      requiredPositions: [Position.SUPPORT],
    });
    const detail = await service.getPost('author1', created.id);

    expect(groupsService.assertGroupMember).toHaveBeenCalledWith(
      'group1',
      'author1',
      expect.objectContaining({
        action: 'recruiting_post_create_denied',
        operation: 'POST /recruiting-posts',
      }),
    );
    expect(prismaService.recruitingPost.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: created.id,
          deletedAt: null,
          group: {
            is: {
              archivedAt: null,
            },
          },
        },
        include: expect.objectContaining({
          group: true,
        }),
      }),
    );
    expect(detail).toMatchObject({
      id: created.id,
      createdBy: 'author1',
      groupId: 'group1',
      canApply: false,
      applyBlockedReason: 'OWN_POST',
      canCreateMatch: true,
      createMatchBlockedReason: null,
      canInviteMembers: false,
      inviteMembersBlockedReason: 'NOT_GROUP_LEADER',
    });
  });

  it('updates a recruiting post for its author', async () => {
    prismaService.recruitingPost.findFirst.mockResolvedValueOnce(
      makePost({
        title: 'Need support',
        body: 'old body',
        tags: ['weekday'],
      }),
    );
    prismaService.user.findUnique.mockResolvedValue({ isAdmin: false });
    prismaService.recruitingPost.update.mockResolvedValue(
      makePost({
        title: 'Need jungle',
        body: 'updated body',
        tags: ['weekend'],
        requiredPositionsJson: [Position.JUNGLE, Position.SUPPORT],
        status: RecruitingPostStatus.CLOSED,
        scheduledAt: new Date('2026-04-20T12:00:00.000Z'),
      }),
    );

    const result = await service.updatePost('author1', 'post1', {
      title: 'Need jungle',
      body: 'updated body',
      tags: ['weekend'],
      requiredPositions: [Position.JUNGLE, Position.SUPPORT],
      status: RecruitingPostStatus.CLOSED,
      scheduledAt: '2026-04-20T12:00:00.000Z',
    });

    expect(prismaService.recruitingPost.update).toHaveBeenCalledWith({
      where: { id: 'post1' },
      data: {
        title: 'Need jungle',
        body: 'updated body',
        tags: ['weekend'],
        requiredPositionsJson: [Position.JUNGLE, Position.SUPPORT],
        status: RecruitingPostStatus.CLOSED,
        scheduledAt: new Date('2026-04-20T12:00:00.000Z'),
      },
    });
    expect(result).toMatchObject({
      id: 'post1',
      title: 'Need jungle',
      body: 'updated body',
      tags: ['weekend'],
      requiredPositions: [Position.JUNGLE, Position.SUPPORT],
      status: RecruitingPostStatus.CLOSED,
    });
  });

  it('returns 403 when a non-owner non-admin updates a recruiting post', async () => {
    prismaService.recruitingPost.findFirst.mockResolvedValue(makePost());
    prismaService.user.findUnique.mockResolvedValue({ isAdmin: false });

    await expect(
      service.updatePost('outsider1', 'post1', {
        title: 'Unauthorized edit',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns 404 when updating a missing recruiting post', async () => {
    prismaService.recruitingPost.findFirst.mockResolvedValue(null);

    await expect(
      service.updatePost('author1', 'missing-post', {
        title: 'Missing',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('soft deletes a recruiting post and clears applicants', async () => {
    prismaService.recruitingPost.findFirst.mockResolvedValue(
      makePost({
        applications: [{ id: 'app1' }, { id: 'app2' }],
      }),
    );
    prismaService.user.findUnique.mockResolvedValue({ isAdmin: false });
    prismaService.recruitingPostApplication.deleteMany.mockResolvedValue({ count: 2 });
    prismaService.recruitingPost.update.mockResolvedValue(
      makePost({
        status: RecruitingPostStatus.CANCELLED,
        deletedAt: new Date('2026-04-18T10:00:00.000Z'),
      }),
    );

    const result = await service.deletePost('author1', 'post1');

    expect(prismaService.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaService.recruitingPostApplication.deleteMany).toHaveBeenCalledWith({
      where: { postId: 'post1' },
    });
    expect(prismaService.recruitingPost.update).toHaveBeenCalledWith({
      where: { id: 'post1' },
      data: {
        deletedAt: expect.any(Date),
        status: RecruitingPostStatus.CANCELLED,
      },
    });
    expect(result).toEqual(
      expect.objectContaining({
        id: 'post1',
        deletedAt: expect.any(String),
      }),
    );
  });

  it('returns 403 when a non-owner non-admin deletes a recruiting post', async () => {
    prismaService.recruitingPost.findFirst.mockResolvedValue(
      makePost({
        applications: [],
      }),
    );
    prismaService.user.findUnique.mockResolvedValue({ isAdmin: false });

    await expect(service.deletePost('outsider1', 'post1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('returns 404 when deleting a missing recruiting post', async () => {
    prismaService.recruitingPost.findFirst.mockResolvedValue(null);

    await expect(service.deletePost('author1', 'missing-post')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('excludes deleted posts from the default list query', async () => {
    prismaService.recruitingPost.findMany.mockResolvedValue([]);

    await service.listPosts('viewer1', {});

    const where = prismaService.recruitingPost.findMany.mock.calls[0][0].where;
    expect(where).toEqual(
      expect.objectContaining({
        AND: expect.arrayContaining([expect.objectContaining({ deletedAt: null })]),
      }),
    );
  });

  it('keeps the public recruiting list scoped to public groups only', async () => {
    prismaService.recruitingPost.findMany.mockResolvedValue([]);

    await service.listPublicPosts({});

    const where = prismaService.recruitingPost.findMany.mock.calls[0][0].where;
    expect(where).toEqual(
      expect.objectContaining({
        AND: expect.arrayContaining([
          { deletedAt: null },
          { status: RecruitingPostStatus.OPEN },
          expect.objectContaining({
            group: {
              is: {
                archivedAt: null,
                visibility: GroupVisibility.PUBLIC,
              },
            },
          }),
        ]),
      }),
    );
  });

  it('applies a scheduled date range filter', async () => {
    prismaService.recruitingPost.findMany.mockResolvedValue([]);

    await service.listPosts('viewer1', {
      scheduledFrom: '2026-04-01',
      scheduledTo: '2026-04-30',
    });

    const where = prismaService.recruitingPost.findMany.mock.calls[0][0].where;
    expect(where).toEqual(
      expect.objectContaining({
        AND: expect.arrayContaining([
          expect.objectContaining({
            scheduledAt: {
              gte: new Date('2026-04-01T00:00:00.000Z'),
              lte: new Date('2026-04-30T23:59:59.999Z'),
            },
          }),
        ]),
      }),
    );
  });

  it('includes unscheduled posts when includeUnscheduled is true for a scheduled range', async () => {
    prismaService.recruitingPost.findMany.mockResolvedValue([]);

    await service.listPosts('viewer1', {
      status: RecruitingPostStatus.OPEN,
      scheduledFrom: '2026-04-01',
      scheduledTo: '2026-04-30',
      includeUnscheduled: true,
    });

    const where = prismaService.recruitingPost.findMany.mock.calls[0][0].where;
    expect(where).toEqual(
      expect.objectContaining({
        AND: expect.arrayContaining([
          { status: RecruitingPostStatus.OPEN },
          expect.objectContaining({
            OR: [
              {
                scheduledAt: {
                  gte: new Date('2026-04-01T00:00:00.000Z'),
                  lte: new Date('2026-04-30T23:59:59.999Z'),
                },
              },
              {
                scheduledAt: null,
              },
            ],
          }),
        ]),
      }),
    );
  });

  it('treats includeUnscheduled=false the same as the existing scheduled range filter', async () => {
    prismaService.recruitingPost.findMany.mockResolvedValue([]);

    await service.listPosts('viewer1', {
      scheduledFrom: '2026-04-01',
      scheduledTo: '2026-04-30',
      includeUnscheduled: false,
    });

    const where = prismaService.recruitingPost.findMany.mock.calls[0][0].where;
    expect(where).toEqual(
      expect.objectContaining({
        AND: expect.arrayContaining([
          expect.objectContaining({
            scheduledAt: {
              gte: new Date('2026-04-01T00:00:00.000Z'),
              lte: new Date('2026-04-30T23:59:59.999Z'),
            },
          }),
        ]),
      }),
    );
    const unscheduledClause = where.AND.find(
      (condition: any) =>
        Array.isArray(condition?.OR) &&
        condition.OR.some((candidate: any) => candidate?.scheduledAt === null),
    );
    expect(unscheduledClause).toBeUndefined();
  });

  it('preserves the default list behavior when includeUnscheduled is true without a scheduled range', async () => {
    prismaService.recruitingPost.findMany.mockResolvedValue([]);

    await service.listPosts('viewer1', {
      status: RecruitingPostStatus.OPEN,
      includeUnscheduled: true,
    });

    const where = prismaService.recruitingPost.findMany.mock.calls[0][0].where;
    expect(where).toEqual(
      expect.objectContaining({
        AND: expect.arrayContaining([
          { deletedAt: null },
          { status: RecruitingPostStatus.OPEN },
        ]),
      }),
    );
    expect(JSON.stringify(where)).not.toContain('scheduledAt');
  });

  it('rejects an invalid scheduled date range', async () => {
    await expect(
      service.listPosts('viewer1', {
        scheduledFrom: '2026-04-30',
        scheduledTo: '2026-04-01',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('applies a required position filter', async () => {
    prismaService.recruitingPost.findMany.mockResolvedValue([]);

    await service.listPosts('viewer1', {
      requiredPositions: [Position.SUPPORT, Position.JUNGLE],
    });

    const where = prismaService.recruitingPost.findMany.mock.calls[0][0].where;
    expect(where).toEqual(
      expect.objectContaining({
        AND: expect.arrayContaining([
          expect.objectContaining({
            OR: [
              {
                requiredPositionsJson: {
                  array_contains: [Position.SUPPORT],
                },
              },
              {
                requiredPositionsJson: {
                  array_contains: [Position.JUNGLE],
                },
              },
            ],
          }),
        ]),
      }),
    );
  });

  it('applies a region filter through the group relation', async () => {
    prismaService.recruitingPost.findMany.mockResolvedValue([]);

    await service.listPosts('viewer1', {
      region: ['kr'],
    });

    const where = prismaService.recruitingPost.findMany.mock.calls[0][0].where;
    expect(where).toEqual(
      expect.objectContaining({
        AND: expect.arrayContaining([
          expect.objectContaining({
            group: {
              is: {
                archivedAt: null,
                region: {
                  in: ['kr'],
                },
              },
            },
          }),
        ]),
      }),
    );
  });

  it('applies a tags filter', async () => {
    prismaService.recruitingPost.findMany.mockResolvedValue([]);

    await service.listPosts('viewer1', {
      tags: ['competitive', 'weekday'],
    });

    const where = prismaService.recruitingPost.findMany.mock.calls[0][0].where;
    expect(where).toEqual(
      expect.objectContaining({
        AND: expect.arrayContaining([
          expect.objectContaining({
            OR: [
              {
                tags: {
                  array_contains: ['competitive'],
                },
              },
              {
                tags: {
                  array_contains: ['weekday'],
                },
              },
            ],
          }),
        ]),
      }),
    );
  });

  it('combines post type, status, date, includeUnscheduled, position, region, and tag filters in one query', async () => {
    prismaService.recruitingPost.findMany.mockResolvedValue([]);

    await service.listPosts('viewer1', {
      postType: RecruitingPostType.MEMBER_RECRUIT,
      status: RecruitingPostStatus.OPEN,
      scheduledFrom: '2026-04-01T00:00:00.000Z',
      scheduledTo: '2026-04-30T23:59:59.000Z',
      includeUnscheduled: true,
      requiredPositions: [Position.MID],
      region: ['kr'],
      tags: ['macro'],
    });

    const where = prismaService.recruitingPost.findMany.mock.calls[0][0].where;
    expect(where).toEqual(
      expect.objectContaining({
        AND: expect.arrayContaining([
          { deletedAt: null },
          { postType: RecruitingPostType.MEMBER_RECRUIT },
          { status: RecruitingPostStatus.OPEN },
          expect.objectContaining({
            OR: [
              {
                scheduledAt: {
                  gte: new Date('2026-04-01T00:00:00.000Z'),
                  lte: new Date('2026-04-30T23:59:59.000Z'),
                },
              },
              {
                scheduledAt: null,
              },
            ],
          }),
          expect.objectContaining({
            OR: [
              {
                requiredPositionsJson: {
                  array_contains: [Position.MID],
                },
              },
            ],
          }),
          expect.objectContaining({
            group: {
              is: {
                archivedAt: null,
                region: {
                  in: ['kr'],
                },
              },
            },
          }),
          expect.objectContaining({
            OR: [
              {
                tags: {
                  array_contains: ['macro'],
                },
              },
            ],
          }),
        ]),
      }),
    );
  });

  it('logs the received query, parsed filters, includeUnscheduled presence, and final condition', async () => {
    prismaService.recruitingPost.findMany.mockResolvedValue([]);
    const loggerSpy = jest
      .spyOn(service['logger'], 'log')
      .mockImplementation(() => undefined);

    await service.listPosts('viewer1', {
      status: RecruitingPostStatus.OPEN,
      scheduledFrom: '2026-04-01',
      includeUnscheduled: true,
    });

    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringContaining('recruiting_post_list_query_received'),
    );
    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringContaining('"includeUnscheduled":true'),
    );
    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringContaining('recruiting_post_list_query_built'),
    );
    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringContaining('"includeUnscheduledPresent":true'),
    );
    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringContaining('"scheduledFilterMode":"range_or_unscheduled"'),
    );
  });

  it('creates an application and notifies the post author', async () => {
    prismaService.recruitingPost.findFirst
      .mockResolvedValueOnce({
        ...makePost(),
        _count: {
          applications: 0,
        },
        applications: [],
        group: { visibility: GroupVisibility.PUBLIC },
      })
      .mockResolvedValueOnce({
        ...makePost(),
        createdAt: new Date('2026-04-18T10:00:00.000Z'),
        updatedAt: new Date('2026-04-18T10:05:00.000Z'),
        _count: {
          applications: 1,
        },
        applications: [
          {
            userId: 'user2',
            createdAt: new Date('2026-04-18T10:05:00.000Z'),
            position: Position.SUPPORT,
            memo: 'Can sub after 9pm',
          },
        ],
        group: { visibility: GroupVisibility.PUBLIC },
      });

    const result = await service.applyToPost('user2', 'post1', {
      position: Position.SUPPORT,
      memo: 'Can sub after 9pm',
    });

    expect(prismaService.recruitingPostApplication.create).toHaveBeenCalledWith({
      data: {
        postId: 'post1',
        userId: 'user2',
        position: Position.SUPPORT,
        memo: 'Can sub after 9pm',
      },
    });
    expect(notificationService.createMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          userId: 'author1',
          type: NotificationType.RECRUITING_APPLIED,
        }),
      ]),
    );
    expect(result.id).toBe('post1');
    expect(result.isApplied).toBe(true);
    expect(result.myApplication).toMatchObject({
      userId: 'user2',
      position: Position.SUPPORT,
      memo: 'Can sub after 9pm',
    });
  });

  it('returns GROUP_ACCESS_FORBIDDEN when a non-member fetches a private recruiting post detail', async () => {
    prismaService.recruitingPost.findFirst.mockResolvedValue({
      ...makePost(),
      group: { visibility: GroupVisibility.PRIVATE },
    });
    prismaService.groupMember.findUnique.mockResolvedValue(null);

    try {
      await service.getPost('outsider1', 'post1');
      throw new Error('Expected private recruiting post access to fail');
    } catch (error) {
      expect(getExceptionBody(error)).toMatchObject({
        code: 'GROUP_ACCESS_FORBIDDEN',
        message: 'You must be a group member to access this post.',
        details: {
          reason: 'NOT_GROUP_MEMBER',
          groupId: 'group1',
          postId: 'post1',
        },
      });
    }
  });

  it('returns 404 with archived reason when creating a recruiting post for a deleted group', async () => {
    const actualGroupsService = new GroupsService(prismaService, auditLogService);
    const recruitingService = new RecruitingService(
      prismaService,
      actualGroupsService,
      notificationService,
      auditLogService,
    );
    const loggerSpy = jest
      .spyOn(actualGroupsService['logger'], 'warn')
      .mockImplementation(() => undefined);

    prismaService.inhouseGroup.findFirst.mockResolvedValue({
      id: 'group1',
      ownerUserId: 'owner1',
      archivedAt: new Date('2026-04-18T10:00:00.000Z'),
      visibility: GroupVisibility.PRIVATE,
      members: [{ userId: 'author1', role: GroupRole.MEMBER }],
    });

    try {
      await recruitingService.createPost('author1', {
        groupId: 'group1',
        postType: RecruitingPostType.MEMBER_RECRUIT,
        title: 'Need support',
        tags: [],
        requiredPositions: [Position.SUPPORT],
      });
      throw new Error('Expected archived group create to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AppException);
      expect(getExceptionBody(error)).toMatchObject({
        message: 'The target group no longer exists or is unavailable.',
        details: {
          reason: 'GROUP_UNAVAILABLE',
        },
      });
    }

    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringContaining('"action":"recruiting_post_create_denied"'),
    );
    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringContaining('"deniedReason":"GROUP_UNAVAILABLE"'),
    );
  });

  it('distinguishes missing, archived, and unauthorized group failures when creating a recruiting post', async () => {
    const actualGroupsService = new GroupsService(prismaService, auditLogService);
    const recruitingService = new RecruitingService(
      prismaService,
      actualGroupsService,
      notificationService,
      auditLogService,
    );
    const loggerSpy = jest
      .spyOn(actualGroupsService['logger'], 'warn')
      .mockImplementation(() => undefined);

    prismaService.inhouseGroup.findFirst.mockResolvedValueOnce(null);

    try {
      await recruitingService.createPost('author1', {
        groupId: 'missing-group',
        postType: RecruitingPostType.MEMBER_RECRUIT,
        title: 'Need support',
        tags: [],
        requiredPositions: [Position.SUPPORT],
      });
      throw new Error('Expected missing group create to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AppException);
      expect(getExceptionBody(error)).toMatchObject({
        details: {
          reason: 'GROUP_NOT_FOUND',
        },
      });
    }

    prismaService.inhouseGroup.findFirst.mockResolvedValueOnce({
      id: 'group1',
      ownerUserId: 'owner1',
      archivedAt: null,
      visibility: GroupVisibility.PRIVATE,
      members: [],
    });

    try {
      await recruitingService.createPost('outsider1', {
        groupId: 'group1',
        postType: RecruitingPostType.MEMBER_RECRUIT,
        title: 'Need support',
        tags: [],
        requiredPositions: [Position.SUPPORT],
      });
      throw new Error('Expected unauthorized create to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AppException);
      expect(getExceptionBody(error)).toMatchObject({
        code: 'GROUP_ACCESS_FORBIDDEN',
        details: {
          reason: 'NOT_GROUP_MEMBER',
        },
      });
    }

    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringContaining('"deniedReason":"GROUP_NOT_FOUND"'),
    );
    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringContaining('"deniedReason":"GROUP_ACCESS_FORBIDDEN"'),
    );
  });
});
