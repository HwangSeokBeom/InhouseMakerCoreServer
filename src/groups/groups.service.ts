import {
  BadRequestException,
  HttpStatus,
  Injectable,
  Logger,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { GroupRole, GroupVisibility, UserStatus } from '@prisma/client';

import { AuditLogService } from '../common/audit-log.service';
import { AppErrorCode, AppException } from '../common/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import {
  AddGroupMemberDto,
  CreateGroupDto,
  DeleteGroupResponseDto,
  GroupDetailResponseDto,
  GroupLeaderboardQueryDto,
  GroupLeaderboardResponseDto,
  GroupMemberCandidateListResponseDto,
  GroupMemberCandidateQueryDto,
  GroupMemberListResponseDto,
  GroupRecentMatchesResponseDto,
  PublicGroupListResponseDto,
  PublicGroupsQueryDto,
  RecentGroupMatchesQueryDto,
  UpdateGroupDto,
} from './dto/groups.dto';

@Injectable()
export class GroupsService {
  private readonly logger = new Logger(GroupsService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async createGroup(
    userId: string,
    dto: CreateGroupDto,
  ): Promise<GroupDetailResponseDto> {
    const group = await this.prismaService.inhouseGroup.create({
      data: {
        ownerUserId: userId,
        name: dto.name,
        region: dto.region,
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
      groupId: group.id,
      name: group.name,
      region: group.region,
      description: group.description,
      visibility: group.visibility,
      joinPolicy: group.joinPolicy,
      tags: this.toStringArray(group.tags),
      ownerUserId: group.ownerUserId,
      memberCount: 1,
      recentMatches: 0,
      ...this.resolveGroupCapabilities(
        {
          requesterUserId: userId,
          groupId: group.id,
          groupExists: true,
          groupArchivedAt: null,
          visibility: group.visibility,
          isMember: true,
          isLeader: true,
          memberRole: GroupRole.OWNER,
        },
        false,
      ),
    };
  }

  async listPublicGroups(query: PublicGroupsQueryDto): Promise<PublicGroupListResponseDto> {
    const groups = await this.prismaService.inhouseGroup.findMany({
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
      take: query.limit ?? 20,
    });

    return {
      items: groups.map((group) =>
        this.toGroupDetail(
          {
            ...group,
            archivedAt: null,
          },
          {
            requesterUserId: null,
            requesterIsSystemAdmin: false,
          },
        ),
      ),
    };
  }

  async getGroup(requesterUserId: string, groupId: string): Promise<GroupDetailResponseDto> {
    const [group, requesterIsSystemAdmin] = await Promise.all([
      this.prismaService.inhouseGroup.findFirst({
        where: {
          id: groupId,
        },
        include: {
          _count: {
            select: {
              members: true,
              matches: true,
            },
          },
          members: {
            where: {
              userId: requesterUserId,
            },
            select: {
              userId: true,
              role: true,
            },
            take: 1,
          },
        },
      }),
      this.getRequesterAdminFlag(requesterUserId),
    ]);

    if (!group) {
      const access = this.toGroupAccessContext(groupId, requesterUserId, null);
      this.logGroupAccess({
        action: 'group_detail_fetch_denied',
        operation: 'GET /groups/:groupId',
        ...access,
        resourceState: 'resource_missing',
        deniedReason: 'GROUP_NOT_FOUND',
        returnedStatusCode: 404,
      });
      throw this.createGroupUnavailableException('GROUP_NOT_FOUND');
    }

    const access = this.toGroupAccessContext(groupId, requesterUserId, group);

    if (group.archivedAt) {
      this.logGroupAccess({
        action: 'group_archived_lookup',
        operation: 'GET /groups/:groupId',
        ...access,
        resourceState: 'resource_archived',
        deniedReason: 'GROUP_UNAVAILABLE',
        returnedStatusCode: 404,
      });
      throw this.createGroupUnavailableException('GROUP_UNAVAILABLE');
    }

    if (group.visibility === GroupVisibility.PRIVATE && !access.isMember) {
      this.logGroupAccess({
        action: 'group_detail_fetch_denied',
        operation: 'GET /groups/:groupId',
        ...access,
        resourceState: 'access_denied',
        deniedReason: 'GROUP_ACCESS_FORBIDDEN',
        returnedStatusCode: 403,
      });
      throw this.createGroupAccessDeniedException(
        'You must be a group member to view this group.',
        'NOT_GROUP_MEMBER',
      );
    }

    return this.toGroupDetail(group, {
      requesterUserId,
      requesterIsSystemAdmin,
    });
  }

  async updateGroup(
    requesterUserId: string,
    groupId: string,
    dto: UpdateGroupDto,
  ): Promise<GroupDetailResponseDto> {
    const mutationLog = this.createGroupMutationLog('update', requesterUserId, groupId, {
      updateFields: Object.keys(dto),
    });
    const group = await this.prismaService.inhouseGroup.findFirst({
      where: {
        id: groupId,
        archivedAt: null,
      },
      include: {
        members: {
          where: {
            userId: requesterUserId,
          },
          select: {
            userId: true,
            role: true,
          },
          take: 1,
        },
        _count: {
          select: {
            members: true,
            matches: true,
          },
        },
      },
    });

    if (!group) {
      mutationLog.deniedReason = 'group_not_found';
      mutationLog.returnedStatusCode = 404;
      this.logGroupMutation(mutationLog);
      throw new NotFoundException('Group not found.');
    }

    mutationLog.foundResource = true;

    const requester = await this.prismaService.user.findUnique({
      where: { id: requesterUserId },
      select: { isAdmin: true },
    });
    const isLeader = group.ownerUserId === requesterUserId;
    const isAdmin = requester?.isAdmin ?? false;
    mutationLog.isLeader = isLeader;
    mutationLog.isAdmin = isAdmin;

    if (!isLeader && !isAdmin) {
      mutationLog.deniedReason = 'not_leader_or_admin';
      mutationLog.returnedStatusCode = 403;
      this.logGroupMutation(mutationLog);
      throw new ForbiddenException('Only the group owner or admin can update this group.');
    }

    const data = this.buildGroupUpdateData(dto);
    if (Object.keys(data).length === 0) {
      mutationLog.deniedReason = 'empty_update';
      mutationLog.returnedStatusCode = 400;
      this.logGroupMutation(mutationLog);
      throw new BadRequestException('At least one mutable field must be provided.');
    }

    const updated = await this.prismaService.inhouseGroup.update({
      where: { id: groupId },
      data,
      include: {
        members: {
          where: {
            userId: requesterUserId,
          },
          select: {
            userId: true,
            role: true,
          },
          take: 1,
        },
        _count: {
          select: {
            members: true,
            matches: true,
          },
        },
      },
    });

    await this.auditLogService.create({
      userId: requesterUserId,
      action: 'GROUP_UPDATED',
      entityType: 'groups',
      entityId: groupId,
      before: {
        name: group.name,
        region: group.region,
        description: group.description,
        visibility: group.visibility,
        joinPolicy: group.joinPolicy,
        tags: group.tags,
      },
      after: {
        name: updated.name,
        region: updated.region,
        description: updated.description,
        visibility: updated.visibility,
        joinPolicy: updated.joinPolicy,
        tags: updated.tags,
      },
      meta: {
        updatedFields: mutationLog.updateFields,
      },
    });

    this.logGroupMutation(mutationLog);
    return this.toGroupDetail(updated, {
      requesterUserId,
      requesterIsSystemAdmin: isAdmin,
    });
  }

  async deleteGroup(
    requesterUserId: string,
    groupId: string,
  ): Promise<DeleteGroupResponseDto> {
    const mutationLog = this.createGroupMutationLog('delete', requesterUserId, groupId, {
      deleteMode: 'archive',
    });
    const group = await this.prismaService.inhouseGroup.findFirst({
      where: {
        id: groupId,
        archivedAt: null,
      },
      include: {
        _count: {
          select: {
            members: true,
            matches: true,
            recruitingPosts: true,
          },
        },
      },
    });

    if (!group) {
      mutationLog.deniedReason = 'group_not_found';
      mutationLog.returnedStatusCode = 404;
      this.logGroupMutation(mutationLog);
      throw new NotFoundException('Group not found.');
    }

    mutationLog.foundResource = true;

    const requester = await this.prismaService.user.findUnique({
      where: { id: requesterUserId },
      select: { isAdmin: true },
    });
    const isLeader = group.ownerUserId === requesterUserId;
    const isAdmin = requester?.isAdmin ?? false;
    mutationLog.isLeader = isLeader;
    mutationLog.isAdmin = isAdmin;

    if (!isLeader && !isAdmin) {
      mutationLog.deniedReason = 'not_leader_or_admin';
      mutationLog.returnedStatusCode = 403;
      this.logGroupMutation(mutationLog);
      throw new ForbiddenException('Only the group owner or admin can delete this group.');
    }

    const archivedAt = new Date();
    await this.prismaService.inhouseGroup.update({
      where: { id: groupId },
      data: {
        archivedAt,
      },
    });

    await this.auditLogService.create({
      userId: requesterUserId,
      action: 'GROUP_ARCHIVED',
      entityType: 'groups',
      entityId: groupId,
      before: {
        archivedAt: null,
        memberCount: group._count.members,
        matchCount: group._count.matches,
        recruitingPostCount: group._count.recruitingPosts,
      },
      after: {
        archivedAt: archivedAt.toISOString(),
        memberCount: group._count.members,
        matchCount: group._count.matches,
        recruitingPostCount: group._count.recruitingPosts,
      },
      meta: {
        deleteMode: 'archive',
      },
    });

    this.logGroupMutation(mutationLog);
    return {
      id: groupId,
      archivedAt: archivedAt.toISOString(),
    };
  }

  async addMember(
    requesterUserId: string,
    groupId: string,
    dto: AddGroupMemberDto,
  ): Promise<GroupMemberListResponseDto> {
    await this.assertGroupAdmin(groupId, requesterUserId, {
      action: 'group_member_add_denied',
      operation: 'POST /groups/:groupId/members',
    });

    const role = dto.role ?? GroupRole.MEMBER;

    if (role === GroupRole.OWNER) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        AppErrorCode.INVALID_MEMBER_ROLE,
        'The owner role cannot be assigned through member invites.',
        {
          groupId,
          userId: dto.userId,
          role,
          allowedRoles: [GroupRole.ADMIN, GroupRole.MEMBER],
        },
      );
    }

    const targetUser = await this.prismaService.user.findUnique({
      where: { id: dto.userId },
      select: { id: true },
    });

    if (!targetUser) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        AppErrorCode.USER_NOT_FOUND,
        'User not found.',
        {
          groupId,
          userId: dto.userId,
        },
      );
    }

    if (dto.userId === requesterUserId) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        AppErrorCode.CANNOT_ADD_SELF,
        'You cannot add yourself through the invite flow.',
        {
          groupId,
          userId: dto.userId,
        },
      );
    }

    const existing = await this.prismaService.groupMember.findUnique({
      where: {
        groupId_userId: {
          groupId,
          userId: dto.userId,
        },
      },
    });

    if (existing) {
      throw new AppException(
        HttpStatus.CONFLICT,
        AppErrorCode.GROUP_MEMBER_ALREADY_EXISTS,
        'This user is already a member of the group.',
        {
          groupId,
          userId: dto.userId,
          role: existing.role,
        },
      );
    }

    await this.prismaService.groupMember.create({
      data: {
        groupId,
        userId: dto.userId,
        role,
      },
    });

    return this.listMembers(requesterUserId, groupId);
  }

  async searchMemberCandidates(
    requesterUserId: string,
    groupId: string,
    query: GroupMemberCandidateQueryDto,
  ): Promise<GroupMemberCandidateListResponseDto> {
    await this.assertGroupAdmin(groupId, requesterUserId, {
      action: 'group_member_candidate_search_denied',
      operation: 'GET /groups/:groupId/member-candidates',
    });

    const users = await this.prismaService.user.findMany({
      where: {
        status: UserStatus.ACTIVE,
        nickname: {
          contains: query.query,
          mode: 'insensitive',
        },
      },
      select: {
        id: true,
        nickname: true,
        primaryPosition: true,
        powerProfile: {
          select: {
            overallPower: true,
          },
        },
        riotAccounts: {
          where: {
            isPrimary: true,
          },
          select: {
            riotGameName: true,
            tagLine: true,
            region: true,
            profileIconId: true,
            summonerLevel: true,
          },
          take: 1,
        },
        groupMemberships: {
          where: {
            groupId,
          },
          select: {
            role: true,
          },
          take: 1,
        },
      },
      orderBy: [{ nickname: 'asc' }],
      take: query.limit ?? 20,
    });

    return {
      items: users.map((user) => {
        const membership = user.groupMemberships[0] ?? null;
        const isSelf = user.id === requesterUserId;
        const alreadyMember = membership !== null;
        const inviteBlockedReason = isSelf
          ? 'CANNOT_ADD_SELF'
          : alreadyMember
            ? 'ALREADY_MEMBER'
            : null;
        const primaryRiotAccount = user.riotAccounts[0] ?? null;

        return {
          id: user.id,
          userId: user.id,
          nickname: user.nickname,
          profileImageUrl: null,
          riotAccountSummary: primaryRiotAccount
            ? {
                gameName: primaryRiotAccount.riotGameName,
                tagLine: primaryRiotAccount.tagLine,
                region: primaryRiotAccount.region,
                profileIconId: primaryRiotAccount.profileIconId,
                summonerLevel: primaryRiotAccount.summonerLevel,
              }
            : null,
          representativePosition: user.primaryPosition,
          recentPower: user.powerProfile?.overallPower ?? null,
          alreadyMember,
          memberRole: membership?.role ?? null,
          selectable: inviteBlockedReason === null,
          inviteBlockedReason,
        };
      }),
    };
  }

  async listMembers(
    requesterUserId: string,
    groupId: string,
  ): Promise<GroupMemberListResponseDto> {
    await this.assertGroupMember(groupId, requesterUserId, {
      action: 'group_member_list_denied',
      operation: 'GET /groups/:groupId/members',
    });

    const members = await this.prismaService.groupMember.findMany({
      where: { groupId },
      include: {
        user: {
          include: {
            powerProfile: {
              select: {
                overallPower: true,
              },
            },
          },
        },
      },
      orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
    });

    return {
      items: members.map((member) => ({
        id: member.id,
        userId: member.userId,
        nickname: member.user.nickname,
        primaryPosition: member.user.primaryPosition,
        mainPosition: member.user.primaryPosition,
        secondaryPosition: member.user.secondaryPosition,
        recentPower: member.user.powerProfile?.overallPower ?? null,
        profileVisible: true,
        role: member.role,
      })),
    };
  }

  async getLeaderboard(
    requesterUserId: string,
    groupId: string,
    query: GroupLeaderboardQueryDto,
  ): Promise<GroupLeaderboardResponseDto> {
    await this.assertGroupMember(groupId, requesterUserId, {
      action: 'group_leaderboard_fetch_denied',
      operation: 'GET /groups/:groupId/leaderboard',
    });

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
          group: {
            archivedAt: null,
          },
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
    await this.assertGroupMember(groupId, requesterUserId, {
      action: 'group_recent_matches_fetch_denied',
      operation: 'GET /groups/:groupId/matches/recent',
    });

    const matches = await this.prismaService.inhouseMatch.findMany({
      where: {
        groupId,
        group: {
          archivedAt: null,
        },
      },
      include: {
        result: true,
        group: {
          select: {
            id: true,
            name: true,
          },
        },
        players: {
          select: { id: true },
        },
      },
      orderBy: [{ scheduledAt: 'desc' }, { createdAt: 'desc' }],
      take: query.limit ?? 10,
    });

    return {
      items: matches.map((match) => ({
        id: match.id,
        matchId: match.id,
        canonicalMatchId: match.id,
        groupId: match.groupId,
        groupName: match.group.name,
        title: match.title,
        status: match.status,
        scheduledAt: match.scheduledAt?.toISOString() ?? null,
        winningTeam: match.result?.winningTeam ?? null,
        resultStatus: match.result?.resultStatus ?? null,
        playerCount: match.players.length,
        updatedAt: match.updatedAt.toISOString(),
      })),
    };
  }

  async getGroupAccessContext(
    groupId: string,
    requesterUserId: string | null,
  ): Promise<GroupAccessContext> {
    const group = await this.prismaService.inhouseGroup.findFirst({
      where: {
        id: groupId,
      },
      select: {
        id: true,
        archivedAt: true,
        visibility: true,
        ownerUserId: true,
        ...(requesterUserId
          ? {
              members: {
                where: {
                  userId: requesterUserId,
                },
                select: {
                  userId: true,
                  role: true,
                },
                take: 1,
              },
            }
          : {}),
      },
    });

    return this.toGroupAccessContext(groupId, requesterUserId, group);
  }

  async getGroupCapabilities(
    groupId: string,
    requesterUserId: string | null,
  ): Promise<GroupCapabilitySnapshot> {
    const [access, requesterIsSystemAdmin] = await Promise.all([
      this.getGroupAccessContext(groupId, requesterUserId),
      this.getRequesterAdminFlag(requesterUserId),
    ]);

    return this.resolveGroupCapabilities(access, requesterIsSystemAdmin);
  }

  resolveGroupCapabilities(
    access: GroupAccessContext,
    requesterIsSystemAdmin = false,
  ): GroupCapabilitySnapshot {
    const invite = this.resolveCapability(access, requesterIsSystemAdmin, 'invite');
    const createMatch = this.resolveCapability(
      access,
      requesterIsSystemAdmin,
      'createMatch',
    );
    const viewMembers = this.resolveCapability(
      access,
      requesterIsSystemAdmin,
      'viewMembers',
    );
    const editGroup = this.resolveCapability(access, requesterIsSystemAdmin, 'editGroup');

    return {
      canInviteMembers: invite.allowed,
      inviteMembersBlockedReason: invite.blockedReason,
      canCreateMatch: createMatch.allowed,
      createMatchBlockedReason: createMatch.blockedReason,
      canViewMembers: viewMembers.allowed,
      viewMembersBlockedReason: viewMembers.blockedReason,
      canEditGroup: editGroup.allowed,
      editGroupBlockedReason: editGroup.blockedReason,
    };
  }

  async assertGroupMember(
    groupId: string,
    userId: string,
    options: GroupAccessAssertionOptions = {},
  ): Promise<GroupAccessContext> {
    const access = await this.getGroupAccessContext(groupId, userId);

    this.assertActiveGroupAccess(access, options);

    if (!access.isMember) {
      this.logGroupAccess({
        action: options.action ?? 'group_member_access_denied',
        operation: options.operation ?? 'group_member_action',
        ...access,
        resourceState: 'access_denied',
        deniedReason: 'GROUP_ACCESS_FORBIDDEN',
        returnedStatusCode: 403,
      });
      throw this.createGroupAccessDeniedException(
        options.accessDeniedMessage ?? 'You must be a group member to perform this action.',
        'NOT_GROUP_MEMBER',
      );
    }

    return access;
  }

  async assertGroupAdmin(
    groupId: string,
    userId: string,
    options: GroupAccessAssertionOptions = {},
  ): Promise<GroupAccessContext> {
    const access = await this.getGroupAccessContext(groupId, userId);

    this.assertActiveGroupAccess(access, options);

    if (
      !access.isMember ||
      (access.memberRole !== GroupRole.OWNER && access.memberRole !== GroupRole.ADMIN)
    ) {
      this.logGroupAccess({
        action: options.action ?? 'group_admin_access_denied',
        operation: options.operation ?? 'group_admin_action',
        ...access,
        resourceState: 'access_denied',
        deniedReason: 'GROUP_ACCESS_FORBIDDEN',
        returnedStatusCode: 403,
      });
      const reason = !access.isMember ? 'NOT_GROUP_MEMBER' : 'NOT_GROUP_LEADER';
      throw this.createGroupAccessDeniedException(
        options.accessDeniedMessage ?? 'You must be a group admin to perform this action.',
        reason,
      );
    }

    return access;
  }

  private buildGroupUpdateData(dto: UpdateGroupDto) {
    const data: {
      name?: string;
      region?: string | null;
      description?: string | null;
      visibility?: GroupVisibility;
      joinPolicy?: CreateGroupDto['joinPolicy'];
      tags?: string[];
    } = {};

    if (dto.name !== undefined) {
      data.name = dto.name;
    }

    if (dto.region !== undefined) {
      data.region = dto.region;
    }

    if (dto.description !== undefined) {
      data.description = dto.description;
    }

    if (dto.visibility !== undefined) {
      data.visibility = dto.visibility;
    }

    if (dto.joinPolicy !== undefined) {
      data.joinPolicy = dto.joinPolicy;
    }

    if (dto.tags !== undefined) {
      data.tags = dto.tags;
    }

    return data;
  }

  private toGroupDetail(group: {
    id: string;
    name: string;
    region: string | null;
    description: string | null;
    archivedAt?: Date | null;
    visibility: GroupVisibility;
    joinPolicy: GroupDetailResponseDto['joinPolicy'];
    tags: unknown;
    ownerUserId: string;
    members?: Array<{
      userId: string;
      role?: GroupRole;
    }>;
    matches?: Array<unknown>;
    _count?: {
      members: number;
      matches: number;
    };
  },
  options: {
    requesterUserId: string | null;
    requesterIsSystemAdmin?: boolean;
  } = {
    requesterUserId: null,
    requesterIsSystemAdmin: false,
  },
  ): GroupDetailResponseDto {
    const access = this.toGroupAccessContext(group.id, options.requesterUserId, {
      archivedAt: group.archivedAt ?? null,
      visibility: group.visibility,
      ownerUserId: group.ownerUserId,
      members: group.members,
    });
    const capabilities = this.resolveGroupCapabilities(
      access,
      options.requesterIsSystemAdmin ?? false,
    );

    return {
      id: group.id,
      groupId: group.id,
      name: group.name,
      region: group.region,
      description: group.description,
      visibility: group.visibility,
      joinPolicy: group.joinPolicy,
      tags: this.toStringArray(group.tags),
      ownerUserId: group.ownerUserId,
      memberCount: group._count?.members ?? group.members?.length ?? 0,
      recentMatches: group._count?.matches ?? group.matches?.length ?? 0,
      ...capabilities,
    };
  }

  private createGroupMutationLog(
    action: 'update' | 'delete',
    requesterUserId: string,
    requestedGroupId: string,
    extras: Partial<GroupMutationLog> = {},
  ): GroupMutationLog {
    return {
      action,
      requestedGroupId,
      requesterUserId,
      foundResource: false,
      isLeader: false,
      isAdmin: false,
      deniedReason: null,
      updateFields: null,
      deleteMode: null,
      returnedStatusCode: 200,
      ...extras,
    };
  }

  private logGroupMutation(log: GroupMutationLog): void {
    const payload = `group_mutation ${JSON.stringify(log)}`;

    if (log.returnedStatusCode >= 400) {
      this.logger.warn(payload);
      return;
    }

    this.logger.log(payload);
  }

  private toStringArray(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  }

  private async getRequesterAdminFlag(
    requesterUserId: string | null,
  ): Promise<boolean> {
    if (!requesterUserId) {
      return false;
    }

    const requester = await this.prismaService.user.findUnique({
      where: { id: requesterUserId },
      select: { isAdmin: true },
    });

    return requester?.isAdmin ?? false;
  }

  private toGroupAccessContext(
    groupId: string,
    requesterUserId: string | null,
    group:
      | {
          archivedAt: Date | null;
          visibility: GroupVisibility;
          ownerUserId: string;
          members?: Array<{
            userId: string;
            role?: GroupRole;
          }>;
        }
      | null,
  ): GroupAccessContext {
    if (!group) {
      return {
        requesterUserId,
        groupId,
        groupExists: false,
        groupArchivedAt: null,
        visibility: null,
        isMember: false,
        isLeader: false,
        memberRole: null,
      };
    }

    const membership =
      requesterUserId === null
        ? null
        : group.members?.find((member) => member.userId === requesterUserId) ?? null;

    return {
      requesterUserId,
      groupId,
      groupExists: true,
      groupArchivedAt: group.archivedAt?.toISOString() ?? null,
      visibility: group.visibility,
      isMember: membership !== null,
      isLeader: requesterUserId !== null && group.ownerUserId === requesterUserId,
      memberRole: membership?.role ?? null,
    };
  }

  private resolveCapability(
    access: GroupAccessContext,
    requesterIsSystemAdmin: boolean,
    capability:
      | 'invite'
      | 'createMatch'
      | 'viewMembers'
      | 'editGroup',
  ): {
    allowed: boolean;
    blockedReason: GroupCapabilityBlockedReason | null;
  } {
    const blockedReason = this.resolveCapabilityBlockedReason(
      access,
      requesterIsSystemAdmin,
      capability,
    );
    return {
      allowed: blockedReason === null,
      blockedReason,
    };
  }

  private resolveCapabilityBlockedReason(
    access: GroupAccessContext,
    requesterIsSystemAdmin: boolean,
    capability:
      | 'invite'
      | 'createMatch'
      | 'viewMembers'
      | 'editGroup',
  ): GroupCapabilityBlockedReason | null {
    if (!access.requesterUserId) {
      return 'AUTH_REQUIRED';
    }

    if (!access.groupExists) {
      return 'GROUP_NOT_FOUND';
    }

    if (access.groupArchivedAt) {
      return 'GROUP_ARCHIVED';
    }

    if (capability === 'editGroup' && requesterIsSystemAdmin) {
      return null;
    }

    if (!access.isMember) {
      return 'NOT_GROUP_MEMBER';
    }

    if (capability === 'invite') {
      return access.memberRole === GroupRole.OWNER || access.memberRole === GroupRole.ADMIN
        ? null
        : 'NOT_GROUP_LEADER';
    }

    if (capability === 'editGroup') {
      return access.isLeader ? null : 'NOT_GROUP_LEADER';
    }

    return null;
  }

  private assertActiveGroupAccess(
    access: GroupAccessContext,
    options: GroupAccessAssertionOptions,
  ): void {
    if (!access.groupExists) {
      this.logGroupAccess({
        action: options.action ?? 'group_access_denied',
        operation: options.operation ?? 'group_access',
        ...access,
        resourceState: 'resource_missing',
        deniedReason: 'GROUP_NOT_FOUND',
        returnedStatusCode: 404,
      });
      throw this.createGroupUnavailableException(
        'GROUP_NOT_FOUND',
        options.unavailableMessage,
      );
    }

    if (access.groupArchivedAt) {
      this.logGroupAccess({
        action: options.archivedAction ?? options.action ?? 'group_archived_lookup',
        operation: options.operation ?? 'group_access',
        ...access,
        resourceState: 'resource_archived',
        deniedReason: 'GROUP_UNAVAILABLE',
        returnedStatusCode: 404,
      });
      throw this.createGroupUnavailableException(
        'GROUP_UNAVAILABLE',
        options.unavailableMessage,
      );
    }
  }

  private createGroupUnavailableException(
    reason: GroupDeniedReason,
    message = 'The group no longer exists or is unavailable.',
  ): AppException {
    return new AppException(
      HttpStatus.NOT_FOUND,
      reason === 'GROUP_NOT_FOUND'
        ? AppErrorCode.GROUP_NOT_FOUND
        : AppErrorCode.GROUP_UNAVAILABLE,
      message,
      {
        reason,
      },
    );
  }

  private createGroupAccessDeniedException(
    message: string,
    reason: GroupCapabilityBlockedReason = 'NOT_GROUP_MEMBER',
  ): AppException {
    return new AppException(
      HttpStatus.FORBIDDEN,
      AppErrorCode.GROUP_ACCESS_FORBIDDEN,
      message,
      {
        reason,
      },
    );
  }

  private logGroupAccess(log: GroupAccessLog): void {
    const payload = `group_access ${JSON.stringify(log)}`;

    if (log.returnedStatusCode >= 400) {
      this.logger.warn(payload);
      return;
    }

    this.logger.log(payload);
  }
}

interface GroupMutationLog {
  action: 'update' | 'delete';
  requestedGroupId: string;
  requesterUserId: string;
  foundResource: boolean;
  isLeader: boolean;
  isAdmin: boolean;
  deniedReason: string | null;
  updateFields: string[] | null;
  deleteMode: 'archive' | null;
  returnedStatusCode: number;
}

export interface GroupAccessContext {
  requesterUserId: string | null;
  groupId: string;
  groupExists: boolean;
  groupArchivedAt: string | null;
  visibility: GroupVisibility | null;
  isMember: boolean;
  isLeader: boolean;
  memberRole: GroupRole | null;
}

export interface GroupAccessAssertionOptions {
  action?: string;
  operation?: string;
  archivedAction?: string;
  unavailableMessage?: string;
  accessDeniedMessage?: string;
}

export interface GroupCapabilitySnapshot {
  canInviteMembers: boolean;
  inviteMembersBlockedReason: GroupCapabilityBlockedReason | null;
  canCreateMatch: boolean;
  createMatchBlockedReason: GroupCapabilityBlockedReason | null;
  canViewMembers: boolean;
  viewMembersBlockedReason: GroupCapabilityBlockedReason | null;
  canEditGroup: boolean;
  editGroupBlockedReason: GroupCapabilityBlockedReason | null;
}

export type GroupCapabilityBlockedReason =
  | 'AUTH_REQUIRED'
  | 'GROUP_NOT_FOUND'
  | 'GROUP_ARCHIVED'
  | 'NOT_GROUP_MEMBER'
  | 'NOT_GROUP_LEADER';

type GroupDeniedReason =
  | 'GROUP_NOT_FOUND'
  | 'GROUP_UNAVAILABLE'
  | 'GROUP_ACCESS_FORBIDDEN';
type GroupResourceState = 'resource_missing' | 'resource_archived' | 'access_denied';

interface GroupAccessLog extends GroupAccessContext {
  action: string;
  operation: string;
  resourceState: GroupResourceState;
  deniedReason: GroupDeniedReason;
  returnedStatusCode: number;
}
