import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { GroupVisibility, NotificationType, RecruitingPostStatus } from '@prisma/client';

import { AuditLogService } from '../common/audit-log.service';
import { GroupsService } from '../groups/groups.service';
import { NotificationService } from '../notifications/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateRecruitingPostDto,
  PublicRecruitingQueryDto,
  RecruitingApplicantListResponseDto,
  RecruitingPostListResponseDto,
  RecruitingPostResponseDto,
  RecruitingQueryDto,
} from './dto/recruiting.dto';

@Injectable()
export class RecruitingService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly groupsService: GroupsService,
    private readonly notificationService: NotificationService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async createPost(
    requesterUserId: string,
    dto: CreateRecruitingPostDto,
  ): Promise<RecruitingPostResponseDto> {
    await this.groupsService.assertGroupMember(dto.groupId, requesterUserId);

    const post = await this.prismaService.recruitingPost.create({
      data: {
        groupId: dto.groupId,
        createdBy: requesterUserId,
        postType: dto.postType,
        title: dto.title,
        body: dto.body,
        tags: dto.tags,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
        requiredPositionsJson: dto.requiredPositions ?? [],
      },
    });

    const recipients = await this.prismaService.groupMember.findMany({
      where: {
        groupId: dto.groupId,
        userId: {
          not: requesterUserId,
        },
      },
      select: {
        userId: true,
      },
    });

    await this.notificationService.createMany(
      recipients.map((recipient) => ({
        userId: recipient.userId,
        type: NotificationType.RECRUITING_POSTED,
        title: '새 모집 글이 등록되었습니다',
        body: dto.title,
        payload: {
          groupId: dto.groupId,
          postId: post.id,
          postType: dto.postType,
        },
        relatedEntityType: 'recruiting_post',
        relatedEntityId: post.id,
      })),
    );

    return this.toDetail(post);
  }

  async listPublicPosts(
    query: PublicRecruitingQueryDto,
  ): Promise<RecruitingPostListResponseDto> {
    if (query.groupId) {
      const group = await this.prismaService.inhouseGroup.findUnique({
        where: { id: query.groupId },
      });

      if (!group || group.visibility !== GroupVisibility.PUBLIC) {
        throw new NotFoundException('Group not found.');
      }
    }

    const posts = await this.prismaService.recruitingPost.findMany({
      where: {
        ...(query.groupId ? { groupId: query.groupId } : {}),
        ...(query.postType ? { postType: query.postType } : {}),
        status: query.status ?? RecruitingPostStatus.OPEN,
        group: {
          is: {
            visibility: GroupVisibility.PUBLIC,
          },
        },
      },
      orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'desc' }],
      take: query.limit ?? 20,
    });

    return {
      items: posts.map((post) => this.toListItem(post)),
    };
  }

  async listPosts(
    requesterUserId: string,
    query: RecruitingQueryDto,
  ): Promise<RecruitingPostListResponseDto> {
    if (query.groupId) {
      const group = await this.prismaService.inhouseGroup.findUnique({
        where: { id: query.groupId },
      });

      if (!group) {
        throw new NotFoundException('Group not found.');
      }

      if (group.visibility === GroupVisibility.PRIVATE) {
        await this.groupsService.assertGroupMember(query.groupId, requesterUserId);
      }
    }

    const posts = await this.prismaService.recruitingPost.findMany({
      where: {
        ...(query.groupId ? { groupId: query.groupId } : {}),
        ...(query.postType ? { postType: query.postType } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'desc' }],
    });

    return {
      items: posts.map((post) => this.toListItem(post)),
    };
  }

  async getPost(
    requesterUserId: string,
    postId: string,
  ): Promise<RecruitingPostResponseDto> {
    const post = await this.prismaService.recruitingPost.findUnique({
      where: { id: postId },
      include: {
        group: true,
      },
    });

    if (!post) {
      throw new NotFoundException('Recruiting post not found.');
    }

    if (post.group.visibility === GroupVisibility.PRIVATE) {
      const membership = await this.prismaService.groupMember.findUnique({
        where: {
          groupId_userId: {
            groupId: post.groupId,
            userId: requesterUserId,
          },
        },
      });

      if (!membership) {
        throw new ForbiddenException('You must be a group member to access this post.');
      }
    }

    return this.toDetail(post);
  }

  async applyToPost(
    requesterUserId: string,
    postId: string,
  ): Promise<RecruitingPostResponseDto> {
    const post = await this.prismaService.recruitingPost.findUnique({
      where: { id: postId },
      include: {
        applications: true,
        group: true,
      },
    });

    if (!post) {
      throw new NotFoundException('Recruiting post not found.');
    }

    if (post.createdBy === requesterUserId) {
      throw new BadRequestException('You cannot apply to your own recruiting post.');
    }

    if (post.status !== RecruitingPostStatus.OPEN) {
      throw new BadRequestException('This recruiting post is not open for applications.');
    }

    if (post.group.visibility === GroupVisibility.PRIVATE) {
      await this.groupsService.assertGroupMember(post.groupId, requesterUserId);
    }

    const existingApplication = post.applications.find(
      (application) => application.userId === requesterUserId,
    );

    if (existingApplication) {
      throw new ConflictException('You have already applied to this recruiting post.');
    }

    const capacity = this.resolveApplicantCapacity(post.requiredPositionsJson);
    if (capacity !== null && post.applications.length >= capacity) {
      throw new BadRequestException('This recruiting post is already full.');
    }

    await this.prismaService.recruitingPostApplication.create({
      data: {
        postId,
        userId: requesterUserId,
      },
    });

    await this.auditLogService.create({
      userId: requesterUserId,
      action: 'RECRUITING_APPLY',
      entityType: 'recruiting_posts',
      entityId: postId,
      meta: { createdBy: post.createdBy },
    });

    await this.notificationService.createMany([
      {
        userId: post.createdBy,
        type: NotificationType.RECRUITING_APPLIED,
        title: '모집 글에 새 신청이 도착했습니다',
        body: post.title,
        payload: {
          postId,
          applicantUserId: requesterUserId,
        },
        relatedEntityType: 'recruiting_post',
        relatedEntityId: postId,
      },
    ]);

    return this.toDetail(post);
  }

  async cancelApplication(
    requesterUserId: string,
    postId: string,
  ): Promise<RecruitingPostResponseDto> {
    const post = await this.prismaService.recruitingPost.findUnique({
      where: { id: postId },
    });

    if (!post) {
      throw new NotFoundException('Recruiting post not found.');
    }

    const application = await this.prismaService.recruitingPostApplication.findUnique({
      where: {
        postId_userId: {
          postId,
          userId: requesterUserId,
        },
      },
    });

    if (!application) {
      throw new NotFoundException('Recruiting application not found.');
    }

    await this.prismaService.recruitingPostApplication.delete({
      where: { id: application.id },
    });

    await this.auditLogService.create({
      userId: requesterUserId,
      action: 'RECRUITING_CANCEL',
      entityType: 'recruiting_posts',
      entityId: postId,
      meta: { createdBy: post.createdBy },
    });

    await this.notificationService.createMany([
      {
        userId: post.createdBy,
        type: NotificationType.RECRUITING_APPLICATION_CANCELLED,
        title: '모집 신청이 취소되었습니다',
        body: post.title,
        payload: {
          postId,
          applicantUserId: requesterUserId,
        },
        relatedEntityType: 'recruiting_post',
        relatedEntityId: postId,
      },
    ]);

    return this.toDetail(post);
  }

  async listApplicants(
    requesterUserId: string,
    postId: string,
  ): Promise<RecruitingApplicantListResponseDto> {
    const post = await this.prismaService.recruitingPost.findUnique({
      where: { id: postId },
      include: {
        applications: {
          include: {
            user: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!post) {
      throw new NotFoundException('Recruiting post not found.');
    }

    const requester = await this.prismaService.user.findUnique({
      where: { id: requesterUserId },
      select: { isAdmin: true },
    });

    if (post.createdBy !== requesterUserId && !requester?.isAdmin) {
      throw new ForbiddenException('Only the author or admin can view applicants.');
    }

    return {
      items: post.applications.map((application) => ({
        userId: application.userId,
        nickname: application.user.nickname,
        appliedAt: application.createdAt.toISOString(),
      })),
    };
  }

  private toDetail(post: {
    id: string;
    groupId: string;
    postType: any;
    title: string;
    body: string | null;
    tags: unknown;
    requiredPositionsJson: unknown;
    status: any;
    scheduledAt: Date | null;
    createdBy: string;
  }): RecruitingPostResponseDto {
    return {
      id: post.id,
      groupId: post.groupId,
      postType: post.postType,
      title: post.title,
      body: post.body,
      tags: Array.isArray(post.tags) ? post.tags.filter((item): item is string => typeof item === 'string') : [],
      requiredPositions: Array.isArray(post.requiredPositionsJson)
        ? post.requiredPositionsJson.filter((item): item is string => typeof item === 'string')
        : [],
      status: post.status,
      scheduledAt: post.scheduledAt?.toISOString() ?? null,
      createdBy: post.createdBy,
    };
  }

  private toListItem(post: {
    id: string;
    groupId: string;
    postType: any;
    title: string;
    status: any;
    scheduledAt: Date | null;
  }) {
    return {
      id: post.id,
      groupId: post.groupId,
      postType: post.postType,
      title: post.title,
      status: post.status,
      scheduledAt: post.scheduledAt?.toISOString() ?? null,
    };
  }

  private resolveApplicantCapacity(requiredPositionsJson: unknown): number | null {
    if (!Array.isArray(requiredPositionsJson)) {
      return null;
    }

    const positions = requiredPositionsJson.filter((item): item is string => typeof item === 'string');
    return positions.length > 0 ? positions.length : null;
  }
}
