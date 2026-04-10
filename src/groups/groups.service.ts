import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { GroupRole, GroupVisibility } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import {
  AddGroupMemberDto,
  CreateGroupDto,
  GroupDetailResponseDto,
  GroupMemberListResponseDto,
} from './dto/groups.dto';

@Injectable()
export class GroupsService {
  constructor(private readonly prismaService: PrismaService) {}

  async createGroup(
    userId: string,
    dto: CreateGroupDto,
  ): Promise<GroupDetailResponseDto> {
    const group = await this.prismaService.inhouseGroup.create({
      data: {
        ownerUserId: userId,
        name: dto.name,
        description: dto.description,
        visibility: dto.visibility,
        joinPolicy: dto.joinPolicy,
        tags: dto.tags,
        members: {
          create: {
            userId,
            role: GroupRole.OWNER,
          },
        },
      },
    });

    return {
      id: group.id,
      name: group.name,
      description: group.description,
      visibility: group.visibility,
      joinPolicy: group.joinPolicy,
      tags: this.toStringArray(group.tags),
      ownerUserId: group.ownerUserId,
      memberCount: 1,
      recentMatches: 0,
    };
  }

  async getGroup(requesterUserId: string, groupId: string): Promise<GroupDetailResponseDto> {
    const group = await this.prismaService.inhouseGroup.findUnique({
      where: { id: groupId },
      include: {
        members: true,
        matches: {
          take: 5,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!group) {
      throw new NotFoundException('Group not found.');
    }

    const isMember = group.members.some((member) => member.userId === requesterUserId);
    if (group.visibility === GroupVisibility.PRIVATE && !isMember) {
      throw new ForbiddenException('You must be a group member to view this group.');
    }

    return {
      id: group.id,
      name: group.name,
      description: group.description,
      visibility: group.visibility,
      joinPolicy: group.joinPolicy,
      tags: this.toStringArray(group.tags),
      ownerUserId: group.ownerUserId,
      memberCount: group.members.length,
      recentMatches: group.matches.length,
    };
  }

  async addMember(
    requesterUserId: string,
    groupId: string,
    dto: AddGroupMemberDto,
  ): Promise<GroupMemberListResponseDto> {
    await this.assertGroupAdmin(groupId, requesterUserId);

    const existing = await this.prismaService.groupMember.findUnique({
      where: {
        groupId_userId: {
          groupId,
          userId: dto.userId,
        },
      },
    });

    if (existing) {
      throw new ConflictException('This user is already a member of the group.');
    }

    await this.prismaService.groupMember.create({
      data: {
        groupId,
        userId: dto.userId,
        role: dto.role ?? GroupRole.MEMBER,
      },
    });

    return this.listMembers(requesterUserId, groupId);
  }

  async listMembers(
    requesterUserId: string,
    groupId: string,
  ): Promise<GroupMemberListResponseDto> {
    await this.assertGroupMember(groupId, requesterUserId);

    const members = await this.prismaService.groupMember.findMany({
      where: { groupId },
      include: {
        user: true,
      },
      orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
    });

    return {
      items: members.map((member) => ({
        id: member.id,
        userId: member.userId,
        nickname: member.user.nickname,
        role: member.role,
      })),
    };
  }

  async assertGroupMember(groupId: string, userId: string): Promise<void> {
    const member = await this.prismaService.groupMember.findUnique({
      where: {
        groupId_userId: {
          groupId,
          userId,
        },
      },
    });

    if (!member) {
      throw new ForbiddenException('You must be a group member to perform this action.');
    }
  }

  async assertGroupAdmin(groupId: string, userId: string): Promise<void> {
    const member = await this.prismaService.groupMember.findUnique({
      where: {
        groupId_userId: {
          groupId,
          userId,
        },
      },
    });

    if (!member || (member.role !== GroupRole.OWNER && member.role !== GroupRole.ADMIN)) {
      throw new ForbiddenException('You must be a group admin to perform this action.');
    }
  }

  private toStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  }
}
