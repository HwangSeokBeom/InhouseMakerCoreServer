import {
  BadRequestException,
  ForbiddenException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  GroupVisibility,
  NotificationType,
  Position,
  Prisma,
  RecruitingPostStatus,
} from '@prisma/client';

import { AuditLogService } from '../common/audit-log.service';
import { AppErrorCode, AppException } from '../common/app.exception';
import { GroupsService } from '../groups/groups.service';
import { NotificationService } from '../notifications/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  ApplyRecruitingPostDto,
  CreateRecruitingPostDto,
  DeleteRecruitingPostResponseDto,
  PublicRecruitingQueryDto,
  RecruitingApplicantListResponseDto,
  RecruitingPostListResponseDto,
  RecruitingPostResponseDto,
  RecruitingQueryDto,
  UpdateRecruitingPostDto,
} from './dto/recruiting.dto';

@Injectable()
export class RecruitingService {
  private readonly logger = new Logger(RecruitingService.name);

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
    await this.groupsService.assertGroupMember(dto.groupId, requesterUserId, {
      action: 'recruiting_post_create_denied',
      operation: 'POST /recruiting-posts',
      unavailableMessage: 'The target group no longer exists or is unavailable.',
      accessDeniedMessage: 'You must be a group member to create a recruiting post.',
    });

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

    return this.getAccessiblePostDetail(requesterUserId, post.id);
  }

  async listPublicPosts(
    query: PublicRecruitingQueryDto,
  ): Promise<RecruitingPostListResponseDto> {
    this.logPostListQuery('received', {
      scope: 'public',
      requesterUserId: null,
      query: this.toListQueryPayload(query),
    });

    if (query.groupId) {
      const group = await this.prismaService.inhouseGroup.findFirst({
        where: {
          id: query.groupId,
          archivedAt: null,
        },
      });

      if (!group || group.visibility !== GroupVisibility.PUBLIC) {
        throw new NotFoundException('Group not found.');
      }
    }

    const { where, parsedFilters } = this.buildPostWhere(query, {
      requesterUserId: null,
      publicOnly: true,
      defaultStatus: RecruitingPostStatus.OPEN,
    });
    this.logPostListQuery('built', {
      scope: 'public',
      requesterUserId: null,
      parsedFilters,
      includeUnscheduledPresent: query.includeUnscheduled !== undefined,
      finalCondition: where,
    });

    const posts = await this.prismaService.recruitingPost.findMany({
      where,
      include: {
        _count: {
          select: {
            applications: true,
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
    this.logPostListQuery('received', {
      scope: 'authenticated',
      requesterUserId,
      query: this.toListQueryPayload(query),
    });

    if (query.groupId) {
      const group = await this.prismaService.inhouseGroup.findFirst({
        where: {
          id: query.groupId,
          archivedAt: null,
        },
      });

      if (!group) {
        throw new NotFoundException('Group not found.');
      }

      if (group.visibility === GroupVisibility.PRIVATE) {
        await this.groupsService.assertGroupMember(query.groupId, requesterUserId);
      }
    }

    const { where, parsedFilters } = this.buildPostWhere(query, {
      requesterUserId,
      publicOnly: false,
    });
    this.logPostListQuery('built', {
      scope: 'authenticated',
      requesterUserId,
      parsedFilters,
      includeUnscheduledPresent: query.includeUnscheduled !== undefined,
      finalCondition: where,
    });

    const posts = await this.prismaService.recruitingPost.findMany({
      where,
      include: {
        _count: {
          select: {
            applications: true,
          },
        },
        applications: {
          where: {
            userId: requesterUserId,
          },
          select: {
            userId: true,
            createdAt: true,
            position: true,
            memo: true,
          },
          take: 1,
        },
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
    const accessLog: RecruitingPostDetailAccessLog = {
      requestedPostId: postId,
      requesterUserId,
      authPresent: true,
      foundPost: false,
      deniedReason: null,
      returnedStatusCode: 200,
    };
    const post = await this.findPostDetail(postId, requesterUserId);

    if (!post) {
      accessLog.deniedReason = 'post_not_found';
      accessLog.returnedStatusCode = 404;
      this.logPostDetailAccess(accessLog);
      throw this.createRecruitingNotFoundException(postId);
    }

    accessLog.foundPost = true;

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
        accessLog.deniedReason = AppErrorCode.GROUP_ACCESS_FORBIDDEN;
        accessLog.returnedStatusCode = 403;
        this.logPostDetailAccess(accessLog);
        throw new AppException(
          HttpStatus.FORBIDDEN,
          AppErrorCode.GROUP_ACCESS_FORBIDDEN,
          'You must be a group member to access this post.',
          {
            reason: AppErrorCode.GROUP_ACCESS_FORBIDDEN,
            groupId: post.groupId,
            postId,
          },
        );
      }
    }

    this.logPostDetailAccess(accessLog);
    return this.toDetail(post, requesterUserId);
  }

  async updatePost(
    requesterUserId: string,
    postId: string,
    dto: UpdateRecruitingPostDto,
  ): Promise<RecruitingPostResponseDto> {
    const mutationLog = this.createPostMutationLog('update', requesterUserId, postId, {
      updateFields: Object.keys(dto),
    });
    const post = await this.prismaService.recruitingPost.findFirst({
      where: {
        id: postId,
        deletedAt: null,
        group: {
          is: {
            archivedAt: null,
          },
        },
      },
    });

    if (!post) {
      mutationLog.deniedReason = 'post_not_found';
      mutationLog.returnedStatusCode = 404;
      this.logPostMutation(mutationLog);
      throw new NotFoundException('Recruiting post not found.');
    }

    mutationLog.foundResource = true;

    const requester = await this.prismaService.user.findUnique({
      where: { id: requesterUserId },
      select: { isAdmin: true },
    });
    const isOwner = post.createdBy === requesterUserId;
    const isAdmin = requester?.isAdmin ?? false;
    mutationLog.isOwner = isOwner;
    mutationLog.isAdmin = isAdmin;

    if (!isOwner && !isAdmin) {
      mutationLog.deniedReason = 'not_owner_or_admin';
      mutationLog.returnedStatusCode = 403;
      this.logPostMutation(mutationLog);
      throw new ForbiddenException('Only the author or admin can update this post.');
    }

    const data = this.buildPostUpdateData(dto);
    if (Object.keys(data).length === 0) {
      mutationLog.deniedReason = 'empty_update';
      mutationLog.returnedStatusCode = 400;
      this.logPostMutation(mutationLog);
      throw new BadRequestException('At least one mutable field must be provided.');
    }

    const updated = await this.prismaService.recruitingPost.update({
      where: { id: postId },
      data,
    });

    await this.auditLogService.create({
      userId: requesterUserId,
      action: 'RECRUITING_UPDATED',
      entityType: 'recruiting_posts',
      entityId: postId,
      before: {
        title: post.title,
        body: post.body,
        tags: post.tags,
        requiredPositionsJson: post.requiredPositionsJson,
        scheduledAt: post.scheduledAt?.toISOString() ?? null,
        status: post.status,
      },
      after: {
        title: updated.title,
        body: updated.body,
        tags: updated.tags,
        requiredPositionsJson: updated.requiredPositionsJson,
        scheduledAt: updated.scheduledAt?.toISOString() ?? null,
        status: updated.status,
      },
      meta: {
        updatedFields: mutationLog.updateFields,
      },
    });

    this.logPostMutation(mutationLog);
    return this.toDetail(updated);
  }

  async deletePost(
    requesterUserId: string,
    postId: string,
  ): Promise<DeleteRecruitingPostResponseDto> {
    const mutationLog = this.createPostMutationLog('delete', requesterUserId, postId, {
      deleteMode: 'soft_delete',
    });
    const post = await this.prismaService.recruitingPost.findFirst({
      where: {
        id: postId,
        deletedAt: null,
        group: {
          is: {
            archivedAt: null,
          },
        },
      },
      include: {
        applications: {
          select: {
            id: true,
          },
        },
      },
    });

    if (!post) {
      mutationLog.deniedReason = 'post_not_found';
      mutationLog.returnedStatusCode = 404;
      this.logPostMutation(mutationLog);
      throw new NotFoundException('Recruiting post not found.');
    }

    mutationLog.foundResource = true;

    const requester = await this.prismaService.user.findUnique({
      where: { id: requesterUserId },
      select: { isAdmin: true },
    });
    const isOwner = post.createdBy === requesterUserId;
    const isAdmin = requester?.isAdmin ?? false;
    mutationLog.isOwner = isOwner;
    mutationLog.isAdmin = isAdmin;

    if (!isOwner && !isAdmin) {
      mutationLog.deniedReason = 'not_owner_or_admin';
      mutationLog.returnedStatusCode = 403;
      this.logPostMutation(mutationLog);
      throw new ForbiddenException('Only the author or admin can delete this post.');
    }

    const deletedAt = new Date();
    await this.prismaService.$transaction([
      this.prismaService.recruitingPostApplication.deleteMany({
        where: { postId },
      }),
      this.prismaService.recruitingPost.update({
        where: { id: postId },
        data: {
          deletedAt,
          status: RecruitingPostStatus.CANCELLED,
        },
      }),
    ]);

    await this.auditLogService.create({
      userId: requesterUserId,
      action: 'RECRUITING_DELETED',
      entityType: 'recruiting_posts',
      entityId: postId,
      before: {
        status: post.status,
        deletedAt: null,
        applicationCount: post.applications.length,
      },
      after: {
        status: RecruitingPostStatus.CANCELLED,
        deletedAt: deletedAt.toISOString(),
        applicationCount: 0,
      },
      meta: {
        deleteMode: 'soft_delete',
        clearedApplicationCount: post.applications.length,
      },
    });

    this.logPostMutation(mutationLog);
    return {
      id: postId,
      deletedAt: deletedAt.toISOString(),
    };
  }

  async applyToPost(
    requesterUserId: string,
    postId: string,
    dto: ApplyRecruitingPostDto,
  ): Promise<RecruitingPostResponseDto> {
    const post = await this.prismaService.recruitingPost.findFirst({
      where: {
        id: postId,
        deletedAt: null,
        group: {
          is: {
            archivedAt: null,
          },
        },
      },
      include: {
        _count: {
          select: {
            applications: true,
          },
        },
        group: true,
        applications: {
          where: {
            userId: requesterUserId,
          },
          select: {
            id: true,
          },
          take: 1,
        },
      },
    });

    if (!post) {
      throw this.createRecruitingNotFoundException(postId);
    }

    if (post.createdBy === requesterUserId) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        AppErrorCode.FORBIDDEN,
        'You cannot apply to your own recruiting post.',
        {
          reason: 'self_apply_not_allowed',
          postId,
        },
      );
    }

    if (post.status !== RecruitingPostStatus.OPEN) {
      throw new AppException(
        HttpStatus.CONFLICT,
        AppErrorCode.RECRUITING_CLOSED,
        'This recruiting post is not open for applications.',
        {
          reason: 'status_closed',
          postId,
          status: post.status,
        },
      );
    }

    if (post.group.visibility === GroupVisibility.PRIVATE) {
      await this.groupsService.assertGroupMember(post.groupId, requesterUserId);
    }

    if (post.applications.length > 0) {
      throw new AppException(
        HttpStatus.CONFLICT,
        AppErrorCode.ALREADY_APPLIED,
        'You have already applied to this recruiting post.',
        {
          postId,
        },
      );
    }

    const capacity = this.resolveApplicantCapacity(post.requiredPositionsJson);
    if (capacity !== null && post._count.applications >= capacity) {
      throw new AppException(
        HttpStatus.CONFLICT,
        AppErrorCode.RECRUITING_CLOSED,
        'This recruiting post is already full.',
        {
          reason: 'capacity_reached',
          postId,
          capacity,
          applicantCount: post._count.applications,
        },
      );
    }

    try {
      await this.prismaService.recruitingPostApplication.create({
        data: {
          postId,
          userId: requesterUserId,
          position: dto.position ?? null,
          memo: dto.memo ?? null,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new AppException(
          HttpStatus.CONFLICT,
          AppErrorCode.ALREADY_APPLIED,
          'You have already applied to this recruiting post.',
          {
            postId,
          },
        );
      }

      throw error;
    }

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

    return this.getAccessiblePostDetail(requesterUserId, postId);
  }

  async cancelApplication(
    requesterUserId: string,
    postId: string,
  ): Promise<RecruitingPostResponseDto> {
    const post = await this.prismaService.recruitingPost.findFirst({
      where: {
        id: postId,
        deletedAt: null,
        group: {
          is: {
            archivedAt: null,
          },
        },
      },
    });

    if (!post) {
      throw this.createRecruitingNotFoundException(postId);
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

    return this.getAccessiblePostDetail(requesterUserId, postId);
  }

  async listApplicants(
    requesterUserId: string,
    postId: string,
  ): Promise<RecruitingApplicantListResponseDto> {
    const post = await this.prismaService.recruitingPost.findFirst({
      where: {
        id: postId,
        deletedAt: null,
        group: {
          is: {
            archivedAt: null,
          },
        },
      },
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
        position: application.position,
        memo: application.memo ?? null,
      })),
    };
  }

  private buildPostWhere(
    query: RecruitingQueryDto,
    options: {
      requesterUserId: string | null;
      publicOnly: boolean;
      defaultStatus?: RecruitingPostStatus;
    },
  ): RecruitingPostWhereBuildResult {
    const and: Prisma.RecruitingPostWhereInput[] = [
      { deletedAt: null },
      {
        group: {
          is: {
            archivedAt: null,
          },
        },
      },
    ];

    if (query.groupId) {
      and.push({ groupId: query.groupId });
    }

    if (query.postType) {
      and.push({ postType: query.postType });
    }

    const status = query.status ?? options.defaultStatus;
    if (status) {
      and.push({ status });
    }

    const scheduledAt = this.buildScheduledAtFilter(query);
    if (scheduledAt.condition) {
      and.push(scheduledAt.condition);
    }

    if (query.requiredPositions?.length) {
      and.push({
        OR: query.requiredPositions.map((position) => ({
          requiredPositionsJson: {
            array_contains: [position] as Prisma.InputJsonValue,
          },
        })),
      });
    }

    if (query.region?.length) {
      and.push({
        group: {
          is: {
            archivedAt: null,
            region: {
              in: query.region,
            },
          },
        },
      });
    }

    if (query.tags?.length) {
      and.push({
        OR: query.tags.map((tag) => ({
          tags: {
            array_contains: [tag] as Prisma.InputJsonValue,
          },
        })),
      });
    }

    const visibility = this.buildPostVisibilityWhere(query, options);
    if (visibility.condition) {
      and.push(visibility.condition);
    }

    const where = and.length === 1 ? and[0] : { AND: and };

    return {
      where,
      parsedFilters: {
        groupId: query.groupId ?? null,
        postType: query.postType ?? null,
        status: status ?? null,
        statusSource: query.status
          ? 'query'
          : options.defaultStatus
            ? 'default'
            : 'unset',
        scheduledFrom: scheduledAt.scheduledFrom?.toISOString() ?? null,
        scheduledTo: scheduledAt.scheduledTo?.toISOString() ?? null,
        scheduledFilterMode: scheduledAt.mode,
        includeUnscheduled: query.includeUnscheduled ?? null,
        requiredPositions: query.requiredPositions ?? [],
        region: query.region ?? [],
        tags: query.tags ?? [],
        visibilityScope: visibility.scope,
      },
    };
  }

  private buildPostVisibilityWhere(
    query: Pick<RecruitingQueryDto, 'groupId'>,
    options: {
      requesterUserId: string | null;
      publicOnly: boolean;
    },
  ): RecruitingPostVisibilityBuildResult {
    if (options.publicOnly) {
      return {
        scope: 'public',
        condition: {
          group: {
            is: {
              archivedAt: null,
              visibility: GroupVisibility.PUBLIC,
            },
          },
        },
      };
    }

    if (query.groupId) {
      return {
        scope: 'group_member',
      };
    }

    if (options.requesterUserId) {
      return {
        scope: 'member',
        condition: {
          OR: [
            {
              group: {
                is: {
                  archivedAt: null,
                  visibility: GroupVisibility.PUBLIC,
                },
              },
            },
            {
              group: {
                is: {
                  archivedAt: null,
                  members: {
                    some: {
                      userId: options.requesterUserId,
                    },
                  },
                },
              },
            },
          ],
        },
      };
    }

    return {
      scope: 'unknown',
    };
  }

  private buildScheduledAtFilter(
    query: Pick<RecruitingQueryDto, 'scheduledFrom' | 'scheduledTo' | 'includeUnscheduled'>,
  ): ScheduledAtFilterBuildResult {
    const scheduledFrom = query.scheduledFrom
      ? this.parseDateBoundary(query.scheduledFrom, 'start')
      : undefined;
    const scheduledTo = query.scheduledTo
      ? this.parseDateBoundary(query.scheduledTo, 'end')
      : undefined;

    if (!scheduledFrom && !scheduledTo) {
      return {
        condition: undefined,
        scheduledFrom: null,
        scheduledTo: null,
        mode: 'none',
      };
    }

    if (scheduledFrom && scheduledTo && scheduledFrom > scheduledTo) {
      throw new BadRequestException('scheduledFrom must be earlier than or equal to scheduledTo.');
    }

    const range: Prisma.DateTimeNullableFilter = {
      ...(scheduledFrom ? { gte: scheduledFrom } : {}),
      ...(scheduledTo ? { lte: scheduledTo } : {}),
    };

    if (query.includeUnscheduled === true) {
      return {
        condition: {
          OR: [{ scheduledAt: range }, { scheduledAt: null }],
        },
        scheduledFrom: scheduledFrom ?? null,
        scheduledTo: scheduledTo ?? null,
        mode: 'range_or_unscheduled',
      };
    }

    return {
      condition: { scheduledAt: range },
      scheduledFrom: scheduledFrom ?? null,
      scheduledTo: scheduledTo ?? null,
      mode: 'range_only',
    };
  }

  private parseDateBoundary(value: string, boundary: 'start' | 'end'): Date {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return new Date(
        boundary === 'start'
          ? `${value}T00:00:00.000Z`
          : `${value}T23:59:59.999Z`,
      );
    }

    return new Date(value);
  }

  private buildPostUpdateData(dto: UpdateRecruitingPostDto): Prisma.RecruitingPostUpdateInput {
    const data: Prisma.RecruitingPostUpdateInput = {};

    if (dto.title !== undefined) {
      data.title = dto.title;
    }

    if (dto.body !== undefined) {
      data.body = dto.body;
    }

    if (dto.tags !== undefined) {
      data.tags = dto.tags;
    }

    if (dto.requiredPositions !== undefined) {
      data.requiredPositionsJson = dto.requiredPositions;
    }

    if (dto.scheduledAt !== undefined) {
      data.scheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : null;
    }

    if (dto.status !== undefined) {
      data.status = dto.status;
    }

    return data;
  }

  private toDetail(
    post: {
    id: string;
    groupId: string;
    postType: RecruitingPostResponseDto['postType'];
    title: string;
    body: string | null;
    tags: unknown;
    requiredPositionsJson: unknown;
    status: RecruitingPostResponseDto['status'];
    scheduledAt: Date | null;
    createdBy: string;
    createdAt: Date;
    updatedAt: Date;
    _count?: {
      applications: number;
    };
    applications?: Array<{
      userId: string;
      createdAt: Date;
      position: Position | null;
      memo: string | null;
    }>;
    },
    requesterUserId: string | null = null,
  ): RecruitingPostResponseDto {
    const capacity = this.resolveApplicantCapacity(post.requiredPositionsJson);
    const applicantCount = post._count?.applications ?? 0;
    const myApplication = post.applications?.[0] ?? null;
    const isApplied = Boolean(myApplication);
    const canApply =
      post.status === RecruitingPostStatus.OPEN &&
      applicantCount < (capacity ?? Number.POSITIVE_INFINITY) &&
      !isApplied &&
      post.createdBy !== requesterUserId;

    return {
      id: post.id,
      postId: post.id,
      groupId: post.groupId,
      postType: post.postType,
      title: post.title,
      body: post.body,
      tags: this.toStringArray(post.tags),
      requiredPositions: this.toStringArray(post.requiredPositionsJson),
      status: post.status,
      scheduledAt: post.scheduledAt?.toISOString() ?? null,
      createdBy: post.createdBy,
      createdAt: post.createdAt.toISOString(),
      updatedAt: post.updatedAt.toISOString(),
      capacity,
      remainingSlots: capacity === null ? null : Math.max(0, capacity - applicantCount),
      applicantCount,
      isApplied,
      canApply,
      myApplication: myApplication
        ? {
            userId: myApplication.userId,
            appliedAt: myApplication.createdAt.toISOString(),
            position: myApplication.position,
            memo: myApplication.memo,
          }
        : null,
    };
  }

  private toListItem(post: {
    id: string;
    groupId: string;
    postType: RecruitingPostResponseDto['postType'];
    title: string;
    status: RecruitingPostResponseDto['status'];
    scheduledAt: Date | null;
    requiredPositionsJson?: unknown;
    _count?: {
      applications: number;
    };
    applications?: Array<{
      userId: string;
      createdAt: Date;
      position: Position | null;
      memo: string | null;
    }>;
  }) {
    const capacity = this.resolveApplicantCapacity(post.requiredPositionsJson);
    const applicantCount = post._count?.applications ?? 0;
    return {
      id: post.id,
      postId: post.id,
      groupId: post.groupId,
      postType: post.postType,
      title: post.title,
      status: post.status,
      scheduledAt: post.scheduledAt?.toISOString() ?? null,
      capacity,
      remainingSlots: capacity === null ? null : Math.max(0, capacity - applicantCount),
      applicantCount,
    };
  }

  private async getAccessiblePostDetail(
    requesterUserId: string,
    postId: string,
  ): Promise<RecruitingPostResponseDto> {
    const post = await this.findPostDetail(postId, requesterUserId);

    if (!post) {
      throw this.createRecruitingNotFoundException(postId);
    }

    if (post.group.visibility === GroupVisibility.PRIVATE) {
      await this.groupsService.assertGroupMember(post.groupId, requesterUserId);
    }

    return this.toDetail(post, requesterUserId);
  }

  private findPostDetail(postId: string, requesterUserId: string | null) {
    return this.prismaService.recruitingPost.findFirst({
      where: {
        id: postId,
        deletedAt: null,
        group: {
          is: {
            archivedAt: null,
          },
        },
      },
      include: {
        group: true,
        _count: {
          select: {
            applications: true,
          },
        },
        applications: requesterUserId
          ? {
              where: {
                userId: requesterUserId,
              },
              select: {
                userId: true,
                createdAt: true,
                position: true,
                memo: true,
              },
              take: 1,
            }
          : false,
      },
    });
  }

  private createRecruitingNotFoundException(postId: string): AppException {
    return new AppException(
      HttpStatus.NOT_FOUND,
      AppErrorCode.RECRUITING_NOT_FOUND,
      'Recruiting post not found.',
      {
        postId,
      },
    );
  }

  private toStringArray(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  }

  private resolveApplicantCapacity(requiredPositionsJson: unknown): number | null {
    const positions = this.toStringArray(requiredPositionsJson);
    return positions.length > 0 ? positions.length : null;
  }

  private createPostMutationLog(
    action: 'update' | 'delete',
    requesterUserId: string,
    requestedPostId: string,
    extras: Partial<RecruitingPostMutationLog> = {},
  ): RecruitingPostMutationLog {
    return {
      action,
      requestedPostId,
      requesterUserId,
      foundResource: false,
      isOwner: false,
      isAdmin: false,
      deniedReason: null,
      updateFields: null,
      deleteMode: null,
      returnedStatusCode: 200,
      ...extras,
    };
  }

  private logPostMutation(log: RecruitingPostMutationLog): void {
    const payload = `recruiting_post_mutation ${JSON.stringify(log)}`;

    if (log.returnedStatusCode >= 400) {
      this.logger.warn(payload);
      return;
    }

    this.logger.log(payload);
  }

  private logPostDetailAccess(accessLog: RecruitingPostDetailAccessLog): void {
    const payload = `recruiting_post_detail_access ${JSON.stringify(accessLog)}`;

    if (accessLog.returnedStatusCode >= 400) {
      this.logger.warn(payload);
      return;
    }

    this.logger.log(payload);
  }

  private toListQueryPayload(
    query: RecruitingQueryDto | PublicRecruitingQueryDto,
  ): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      groupId: query.groupId ?? null,
      postType: query.postType ?? null,
      status: query.status ?? null,
      scheduledFrom: query.scheduledFrom ?? null,
      scheduledTo: query.scheduledTo ?? null,
      includeUnscheduled: query.includeUnscheduled ?? null,
      requiredPositions: query.requiredPositions ?? [],
      region: query.region ?? [],
      tags: query.tags ?? [],
    };

    if ('limit' in query) {
      payload.limit = (query as PublicRecruitingQueryDto).limit ?? null;
    }

    return payload;
  }

  private logPostListQuery(
    stage: 'received' | 'built',
    payload: Record<string, unknown>,
  ): void {
    this.logger.log(`recruiting_post_list_query_${stage} ${JSON.stringify(payload)}`);
  }
}

interface RecruitingPostWhereBuildResult {
  where: Prisma.RecruitingPostWhereInput;
  parsedFilters: {
    groupId: string | null;
    postType: RecruitingPostResponseDto['postType'] | null;
    status: RecruitingPostResponseDto['status'] | null;
    statusSource: 'query' | 'default' | 'unset';
    scheduledFrom: string | null;
    scheduledTo: string | null;
    scheduledFilterMode: ScheduledAtFilterBuildResult['mode'];
    includeUnscheduled: boolean | null;
    requiredPositions: string[];
    region: string[];
    tags: string[];
    visibilityScope: RecruitingPostVisibilityBuildResult['scope'];
  };
}

interface RecruitingPostVisibilityBuildResult {
  condition?: Prisma.RecruitingPostWhereInput;
  scope: 'public' | 'member' | 'group_member' | 'unknown';
}

interface ScheduledAtFilterBuildResult {
  condition?: Prisma.RecruitingPostWhereInput;
  scheduledFrom: Date | null;
  scheduledTo: Date | null;
  mode: 'none' | 'range_only' | 'range_or_unscheduled';
}

interface RecruitingPostDetailAccessLog {
  requestedPostId: string;
  requesterUserId: string | null;
  authPresent: boolean;
  foundPost: boolean | null;
  deniedReason: string | null;
  returnedStatusCode: number;
}

interface RecruitingPostMutationLog {
  action: 'update' | 'delete';
  requestedPostId: string;
  requesterUserId: string;
  foundResource: boolean;
  isOwner: boolean;
  isAdmin: boolean;
  deniedReason: string | null;
  updateFields: string[] | null;
  deleteMode: 'soft_delete' | null;
  returnedStatusCode: number;
}
