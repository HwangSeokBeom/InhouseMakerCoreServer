import { UserStatus } from '@prisma/client';

import { BlocksService } from '../src/blocks/blocks.service';

describe('BlocksService', () => {
  const prismaService = {
    user: {
      findFirst: jest.fn(),
    },
    userBlock: {
      upsert: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn(),
    },
  } as any;

  let service: BlocksService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BlocksService(prismaService);
  });

  it('blocks another active user idempotently', async () => {
    const createdAt = new Date('2026-04-20T01:00:00.000Z');
    prismaService.user.findFirst.mockResolvedValue({ id: 'target-user' });
    prismaService.userBlock.upsert.mockResolvedValue({
      userId: 'me',
      targetUserId: 'target-user',
      createdAt,
    });

    const response = await service.blockUser('me', 'target-user');

    expect(prismaService.userBlock.upsert).toHaveBeenCalledWith({
      where: {
        userId_targetUserId: {
          userId: 'me',
          targetUserId: 'target-user',
        },
      },
      create: {
        userId: 'me',
        targetUserId: 'target-user',
      },
      update: {},
    });
    expect(response).toEqual({
      targetUserId: 'target-user',
      blocked: true,
      createdAt: createdAt.toISOString(),
    });
  });

  it('rejects blocking yourself', async () => {
    await expect(service.blockUser('me', 'me')).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'BLOCK_SELF_NOT_ALLOWED',
      }),
    });
  });

  it('unblocks idempotently', async () => {
    prismaService.userBlock.deleteMany.mockResolvedValue({ count: 0 });

    await expect(service.unblockUser('me', 'target-user')).resolves.toEqual({
      targetUserId: 'target-user',
      blocked: false,
      createdAt: null,
    });
    expect(prismaService.userBlock.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: 'me',
        targetUserId: 'target-user',
      },
    });
  });

  it('lists my blocks with target profile metadata', async () => {
    prismaService.userBlock.findMany.mockResolvedValue([
      {
        createdAt: new Date('2026-04-20T01:00:00.000Z'),
        targetUser: {
          id: 'target-user',
          nickname: 'Target',
          profileImageUrl: '/uploads/profile-images/target.png',
          status: UserStatus.ACTIVE,
        },
      },
    ]);

    const response = await service.listMyBlocks('me');

    expect(response.items).toEqual([
      {
        id: 'target-user',
        userId: 'target-user',
        nickname: 'Target',
        profileImageUrl: '/uploads/profile-images/target.png',
        status: UserStatus.ACTIVE,
        blockedAt: '2026-04-20T01:00:00.000Z',
      },
    ]);
  });
});
