import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { GroupVisibility } from '@prisma/client';

import { GroupsService } from '../groups/groups.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateRecruitingPostDto,
  RecruitingPostListResponseDto,
  RecruitingPostResponseDto,
  RecruitingQueryDto,
} from './dto/recruiting.dto';

@Injectable()
export class RecruitingService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly groupsService: GroupsService,
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

    return this.toDetail(post);
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
      items: posts.map((post) => ({
        id: post.id,
        groupId: post.groupId,
        postType: post.postType,
        title: post.title,
        status: post.status,
        scheduledAt: post.scheduledAt?.toISOString() ?? null,
      })),
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
}

