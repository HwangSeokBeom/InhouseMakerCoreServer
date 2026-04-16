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
  GroupLeaderboardQueryDto,
  GroupLeaderboardResponseDto,
  GroupMemberListResponseDto,
  GroupRecentMatchesResponseDto,
  PublicGroupListResponseDto,
  PublicGroupsQueryDto,
  RecentGroupMatchesQueryDto,
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

  async listPublicGroups(query: PublicGroupsQueryDto): Promise<PublicGroupListResponseDto> {
    const groups = await this.prismaService.inhouseGroup.findMany({
      where: {
        visibility: GroupVisibility.PUBLIC,
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
      take: query.limit ?? 20,
    });

    return {
      items: groups.map((group) => ({
        id: group.id,
        name: group.name,
        description: group.description,
        visibility: group.visibility,
        joinPolicy: group.joinPolicy,
        tags: this.toStringArray(group.tags),
        ownerUserId: group.ownerUserId,
        memberCount: group._count.members,
        recentMatches: group._count.matches,
      })),
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

  async getLeaderboard(
    requesterUserId: string,
    groupId: string,
    query: GroupLeaderboardQueryDto,
  ): Promise<GroupLeaderboardResponseDto> {
    await this.assertGroupMember(groupId, requesterUserId);

    const members = await this.prismaService.groupMember.findMany({
      where: { groupId },
      include: {
        user: {
          include: {
            powerProfile: true,
          },
        },
      },
    });
    const stats = await this.prismaService.inhousePlayerStat.findMany({
      where: {
        userId: {
          in: members.map((member) => member.userId),
        },
        match: {
          groupId,
          result: {
            is: {
              resultStatus: 'CONFIRMED',
            },
          },
        },
      },
      include: {
        match: {
          include: {
            result: true,
          },
        },
      },
    });

    const aggregates = stats.reduce<Record<string, { totalGames: number; wins: number }>>(
      (acc, stat) => {
        const record = acc[stat.userId] ?? { totalGames: 0, wins: 0 };
        record.totalGames += 1;
        if (stat.match.result?.winningTeam === stat.teamSide) {
          record.wins += 1;
        }
        acc[stat.userId] = record;
        return acc;
      },
      {},
    );

    const ranked = members
      .map((member) => {
        const aggregate = aggregates[member.userId] ?? { totalGames: 0, wins: 0 };
        const losses = aggregate.totalGames - aggregate.wins;
        const currentPower = member.user.powerProfile?.overallPower ?? 0;
        return {
          userId: member.userId,
          nickname: member.user.nickname,
          currentPower,
          totalGames: aggregate.totalGames,
          wins: aggregate.wins,
          losses,
          winRate:
            aggregate.totalGames > 0
              ? Number((aggregate.wins / aggregate.totalGames).toFixed(4))
              : 0,
        };
      })
      .sort((left, right) => {
        if (right.currentPower !== left.currentPower) {
          return right.currentPower - left.currentPower;
        }
        if (right.winRate !== left.winRate) {
          return right.winRate - left.winRate;
        }
        return left.nickname.localeCompare(right.nickname);
      })
      .slice(0, query.limit ?? 20)
      .map((item, index) => ({
        ...item,
        groupRank: index + 1,
      }));

    return {
      items: ranked,
    };
  }

  async getRecentMatches(
    requesterUserId: string,
    groupId: string,
    query: RecentGroupMatchesQueryDto,
  ): Promise<GroupRecentMatchesResponseDto> {
    await this.assertGroupMember(groupId, requesterUserId);

    const matches = await this.prismaService.inhouseMatch.findMany({
      where: { groupId },
      include: {
        result: true,
        players: {
          select: { id: true },
        },
      },
      orderBy: [{ scheduledAt: 'desc' }, { createdAt: 'desc' }],
      take: query.limit ?? 10,
    });

    return {
      items: matches.map((match) => ({
        matchId: match.id,
        title: match.title,
        status: match.status,
        scheduledAt: match.scheduledAt?.toISOString() ?? null,
        winningTeam: match.result?.winningTeam ?? null,
        resultStatus: match.result?.resultStatus ?? null,
        playerCount: match.players.length,
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
