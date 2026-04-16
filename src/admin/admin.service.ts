import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RecruitingPostStatus } from '@prisma/client';

import { AuditLogService } from '../common/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  AdminAuditLogsQueryDto,
  AdminAuditLogsResponseDto,
  AdminDisputedResultsQueryDto,
  AdminDisputedResultsResponseDto,
  AdminRecruitingPostStatusResponseDto,
  AdminRecruitingPostsQueryDto,
  AdminRecruitingPostsResponseDto,
  AdminUserAdminFlagResponseDto,
  AdminUserDetailResponseDto,
  AdminUsersQueryDto,
  AdminUsersResponseDto,
  UpdateAdminFlagDto,
  UpdateRecruitingPostStatusDto,
} from './dto/admin.dto';

@Injectable()
export class AdminService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async listUsers(
    requesterUserId: string,
    query: AdminUsersQueryDto,
  ): Promise<AdminUsersResponseDto> {
    await this.assertAdmin(requesterUserId);

    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    const where = {
      ...(query.isAdmin === undefined ? {} : { isAdmin: query.isAdmin }),
      ...(query.query
        ? {
            OR: [
              { email: { contains: query.query, mode: 'insensitive' as const } },
              { nickname: { contains: query.query, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const orderBy = {
      [(query.sortBy ?? 'createdAt')]: query.sortOrder ?? 'desc',
    } as const;

    const [users, totalCount] = await Promise.all([
      this.prismaService.user.findMany({
        where,
        orderBy,
        skip: offset,
        take: limit,
        include: {
          powerProfile: true,
          groupMemberships: true,
          riotAccounts: true,
        },
      }),
      this.prismaService.user.count({ where }),
    ]);

    return {
      items: users.map((user) => ({
        id: user.id,
        email: user.email,
        nickname: user.nickname,
        isAdmin: user.isAdmin,
        primaryPosition: user.primaryPosition,
        currentPower: user.powerProfile?.overallPower ?? 0,
        groupCount: user.groupMemberships.length,
        riotAccountCount: user.riotAccounts.length,
        createdAt: user.createdAt.toISOString(),
      })),
      pagination: this.buildPagination(limit, offset, totalCount, users.length),
    };
  }

  async getUserDetail(
    requesterUserId: string,
    userId: string,
  ): Promise<AdminUserDetailResponseDto> {
    await this.assertAdmin(requesterUserId);

    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
      include: {
        powerProfile: true,
        groupMemberships: {
          include: {
            group: true,
          },
        },
        riotAccounts: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    return {
      id: user.id,
      email: user.email,
      nickname: user.nickname,
      isAdmin: user.isAdmin,
      primaryPosition: user.primaryPosition,
      secondaryPosition: user.secondaryPosition,
      isFillAvailable: user.isFillAvailable,
      mannerScore: user.mannerScore,
      noshowCount: user.noshowCount,
      createdAt: user.createdAt.toISOString(),
      groupMemberships: user.groupMemberships.map((membership) => ({
        groupId: membership.groupId,
        groupName: membership.group.name,
        role: membership.role,
      })),
      riotAccounts: user.riotAccounts.map((account) => ({
        id: account.id,
        riotId: `${account.riotGameName}#${account.tagLine}`,
        syncStatus: account.syncStatus,
        lastSyncSucceededAt: account.lastSyncSucceededAt?.toISOString() ?? null,
      })),
      powerProfile: user.powerProfile
        ? {
            currentPower: user.powerProfile.overallPower,
            inhouseMmr: user.powerProfile.inhouseMmr,
            confidence: user.powerProfile.inhouseConfidence,
          }
        : null,
    };
  }

  async updateAdminFlag(
    requesterUserId: string,
    targetUserId: string,
    dto: UpdateAdminFlagDto,
  ): Promise<AdminUserAdminFlagResponseDto> {
    await this.assertAdmin(requesterUserId);

    const targetUser = await this.prismaService.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, isAdmin: true },
    });

    if (!targetUser) {
      throw new NotFoundException('User not found.');
    }

    const updated = await this.prismaService.user.update({
      where: { id: targetUserId },
      data: {
        isAdmin: dto.isAdmin,
      },
    });

    await this.auditLogService.create({
      userId: requesterUserId,
      action: 'ADMIN_FLAG_CHANGED',
      entityType: 'users',
      entityId: targetUserId,
      before: { isAdmin: targetUser.isAdmin },
      after: { isAdmin: updated.isAdmin },
    });

    return {
      userId: updated.id,
      isAdmin: updated.isAdmin,
    };
  }

  async listAuditLogs(
    requesterUserId: string,
    query: AdminAuditLogsQueryDto,
  ): Promise<AdminAuditLogsResponseDto> {
    await this.assertAdmin(requesterUserId);

    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    const where = {
      ...(query.actorUserId ? { userId: query.actorUserId } : {}),
      ...(query.targetType ? { entityType: query.targetType } : {}),
      ...(query.eventType ? { action: query.eventType } : {}),
      ...((query.from || query.to)
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };

    const [items, totalCount] = await Promise.all([
      this.prismaService.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      this.prismaService.auditLog.count({ where }),
    ]);

    return {
      items: items.map((item) => ({
        id: item.id,
        actorUserId: item.userId,
        action: item.action,
        entityType: item.entityType,
        entityId: item.entityId,
        meta: (item.metaJson as Record<string, unknown> | null) ?? null,
        createdAt: item.createdAt.toISOString(),
      })),
      pagination: this.buildPagination(limit, offset, totalCount, items.length),
    };
  }

  async listDisputedResults(
    requesterUserId: string,
    query: AdminDisputedResultsQueryDto,
  ): Promise<AdminDisputedResultsResponseDto> {
    await this.assertAdmin(requesterUserId);

    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    const where = {
      resultStatus: 'DISPUTED' as const,
      match: {
        ...(query.groupId ? { groupId: query.groupId } : {}),
      },
    };

    const [items, totalCount] = await Promise.all([
      this.prismaService.inhouseMatchResult.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
        include: {
          match: {
            select: {
              id: true,
              groupId: true,
              title: true,
            },
          },
        },
      }),
      this.prismaService.inhouseMatchResult.count({ where }),
    ]);

    return {
      items: items.map((item) => ({
        resultId: item.id,
        matchId: item.matchId,
        groupId: item.match.groupId,
        matchTitle: item.match.title,
        submittedBy: item.submittedBy,
        version: item.version,
        createdAt: item.createdAt.toISOString(),
      })),
      pagination: this.buildPagination(limit, offset, totalCount, items.length),
    };
  }

  async listRecruitingPosts(
    requesterUserId: string,
    query: AdminRecruitingPostsQueryDto,
  ): Promise<AdminRecruitingPostsResponseDto> {
    await this.assertAdmin(requesterUserId);

    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    const where = {
      ...(query.groupId ? { groupId: query.groupId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    const [items, totalCount] = await Promise.all([
      this.prismaService.recruitingPost.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
        include: {
          _count: {
            select: {
              applications: true,
            },
          },
        },
      }),
      this.prismaService.recruitingPost.count({ where }),
    ]);

    return {
      items: items.map((item) => ({
        id: item.id,
        groupId: item.groupId,
        title: item.title,
        status: item.status,
        applicantCount: item._count.applications,
        createdAt: item.createdAt.toISOString(),
      })),
      pagination: this.buildPagination(limit, offset, totalCount, items.length),
    };
  }

  async updateRecruitingPostStatus(
    requesterUserId: string,
    postId: string,
    dto: UpdateRecruitingPostStatusDto,
  ): Promise<AdminRecruitingPostStatusResponseDto> {
    await this.assertAdmin(requesterUserId);

    const post = await this.prismaService.recruitingPost.findUnique({
      where: { id: postId },
      select: { id: true, status: true },
    });

    if (!post) {
      throw new NotFoundException('Recruiting post not found.');
    }

    const updated = await this.prismaService.recruitingPost.update({
      where: { id: postId },
      data: {
        status: dto.status,
      },
    });

    await this.auditLogService.create({
      userId: requesterUserId,
      action: 'RECRUITING_STATUS_CHANGED',
      entityType: 'recruiting_posts',
      entityId: postId,
      before: { status: post.status },
      after: { status: updated.status },
      meta: { note: dto.note ?? null },
    });

    return {
      postId: updated.id,
      status: updated.status,
    };
  }

  async assertAdmin(userId: string): Promise<void> {
    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
      select: { isAdmin: true },
    });

    if (!user?.isAdmin) {
      throw new ForbiddenException('Admin privileges are required.');
    }
  }

  private buildPagination(
    limit: number,
    offset: number,
    totalCount: number,
    currentCount: number,
  ) {
    const nextOffset = offset + currentCount < totalCount ? offset + currentCount : null;

    return {
      limit,
      offset,
      hasMore: nextOffset !== null,
      nextOffset,
    };
  }
}
