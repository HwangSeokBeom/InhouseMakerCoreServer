import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { GroupVisibility, NotificationType, RecruitingPostStatus, RecruitingPostType } from '@prisma/client';

import { RecruitingService } from '../src/recruiting/recruiting.service';

describe('RecruitingService', () => {
  const prismaService = {
    recruitingPost: {
      findUnique: jest.fn(),
    },
    recruitingPostApplication: {
      create: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
  } as any;
  const groupsService = {
    assertGroupMember: jest.fn(),
  } as any;
  const notificationService = {
    createMany: jest.fn(),
  } as any;
  const auditLogService = {
    create: jest.fn(),
  } as any;

  let service: RecruitingService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new RecruitingService(
      prismaService,
      groupsService,
      notificationService,
      auditLogService,
    );
  });

  it('creates an application and notifies the post author', async () => {
    prismaService.recruitingPost.findUnique.mockResolvedValue({
      id: 'post1',
      groupId: 'group1',
      createdBy: 'author1',
      postType: RecruitingPostType.MEMBER_RECRUIT,
      title: 'Need support',
      body: null,
      tags: [],
      requiredPositionsJson: ['SUPPORT'],
      status: RecruitingPostStatus.OPEN,
      scheduledAt: null,
      applications: [],
      group: { visibility: GroupVisibility.PUBLIC },
    });

    const result = await service.applyToPost('user2', 'post1');

    expect(prismaService.recruitingPostApplication.create).toHaveBeenCalledWith({
      data: { postId: 'post1', userId: 'user2' },
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
  });

  it('rejects duplicate applications', async () => {
    prismaService.recruitingPost.findUnique.mockResolvedValue({
      id: 'post1',
      groupId: 'group1',
      createdBy: 'author1',
      postType: RecruitingPostType.MEMBER_RECRUIT,
      title: 'Need support',
      body: null,
      tags: [],
      requiredPositionsJson: ['SUPPORT'],
      status: RecruitingPostStatus.OPEN,
      scheduledAt: null,
      applications: [{ userId: 'user2' }],
      group: { visibility: GroupVisibility.PUBLIC },
    });

    await expect(service.applyToPost('user2', 'post1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects applications to closed posts', async () => {
    prismaService.recruitingPost.findUnique.mockResolvedValue({
      id: 'post1',
      groupId: 'group1',
      createdBy: 'author1',
      postType: RecruitingPostType.MEMBER_RECRUIT,
      title: 'Need support',
      body: null,
      tags: [],
      requiredPositionsJson: ['SUPPORT'],
      status: RecruitingPostStatus.CLOSED,
      scheduledAt: null,
      applications: [],
      group: { visibility: GroupVisibility.PUBLIC },
    });

    await expect(service.applyToPost('user2', 'post1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('cancels an existing application', async () => {
    prismaService.recruitingPost.findUnique.mockResolvedValue({
      id: 'post1',
      groupId: 'group1',
      createdBy: 'author1',
      postType: RecruitingPostType.MEMBER_RECRUIT,
      title: 'Need support',
      body: null,
      tags: [],
      requiredPositionsJson: ['SUPPORT'],
      status: RecruitingPostStatus.OPEN,
      scheduledAt: null,
    });
    prismaService.recruitingPostApplication.findUnique.mockResolvedValue({
      id: 'app1',
      postId: 'post1',
      userId: 'user2',
    });

    const result = await service.cancelApplication('user2', 'post1');

    expect(prismaService.recruitingPostApplication.delete).toHaveBeenCalledWith({
      where: { id: 'app1' },
    });
    expect(result.id).toBe('post1');
  });
});
