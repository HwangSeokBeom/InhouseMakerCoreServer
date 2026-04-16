import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BalanceMode,
  GroupRole,
  LaneResult,
  MatchStatus,
  ParticipationStatus,
  Position,
  Prisma,
  ResultStatus,
  TeamSide,
} from '@prisma/client';

import { AuditLogService } from '../common/audit-log.service';
import { GroupsService } from '../groups/groups.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  AddMatchPlayersDto,
  CreateMatchDto,
  MatchResponseDto,
  MatchSummaryResponseDto,
  UpdateMatchPlayerDto,
} from './dto/matches.dto';

@Injectable()
export class MatchesService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly groupsService: GroupsService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async createMatch(
    requesterUserId: string,
    groupId: string,
    dto: CreateMatchDto,
  ): Promise<MatchResponseDto> {
    await this.groupsService.assertGroupMember(groupId, requesterUserId);

    const match = await this.prismaService.inhouseMatch.create({
      data: {
        groupId,
        createdBy: requesterUserId,
        title: dto.title,
        notes: dto.notes,
        status: MatchStatus.RECRUITING,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
      },
      include: {
        players: {
          include: {
            user: true,
          },
        },
      },
    });

    return this.toMatchResponse(match);
  }

  async getMatch(
    requesterUserId: string,
    matchId: string,
  ): Promise<MatchResponseDto> {
    const match = await this.getMatchWithPlayers(matchId);
    await this.groupsService.assertGroupMember(match.groupId, requesterUserId);
    return this.toMatchResponse(match);
  }

  async addPlayers(
    requesterUserId: string,
    matchId: string,
    dto: AddMatchPlayersDto,
  ): Promise<MatchResponseDto> {
    const match = await this.getMatchWithPlayers(matchId);
    await this.assertMatchHostOrGroupAdmin(match, requesterUserId);

    if (
      match.status !== MatchStatus.DRAFT &&
      match.status !== MatchStatus.RECRUITING
    ) {
      throw new BadRequestException('Players can only be added before the match is locked.');
    }

    const currentUserIds = new Set(match.players.map((player) => player.userId));
    const createInputs: Prisma.InhouseMatchPlayerCreateManyInput[] = [];

    for (const player of dto.players) {
      if (currentUserIds.has(player.userId)) {
        continue;
      }

      createInputs.push({
        matchId,
        userId: player.userId,
        riotAccountId: player.riotAccountId,
        participationStatus: player.participationStatus ?? ParticipationStatus.ACCEPTED,
        sameTeamPreferencesJson: player.sameTeamPreferenceUserIds ?? [],
        avoidTeamPreferencesJson: player.avoidTeamPreferenceUserIds ?? [],
        positionPrefSnapshot: {},
        isCaptain: player.isCaptain ?? false,
      });
    }

    if (createInputs.length > 0) {
      await this.prismaService.inhouseMatchPlayer.createMany({
        data: createInputs,
      });
    }

    return this.getMatch(requesterUserId, matchId);
  }

  async updatePlayer(
    requesterUserId: string,
    matchId: string,
    playerId: string,
    dto: UpdateMatchPlayerDto,
  ): Promise<MatchResponseDto> {
    const match = await this.getMatchWithPlayers(matchId);
    await this.assertAdminOrGroupAdmin(match, requesterUserId);

    if (
      match.status === MatchStatus.IN_PROGRESS ||
      match.status === MatchStatus.CONFIRMED ||
      match.status === MatchStatus.CLOSED
    ) {
      throw new BadRequestException('This match can no longer be edited.');
    }

    if (
      match.status === MatchStatus.BALANCED ||
      match.status === MatchStatus.RESULT_PENDING ||
      match.status === MatchStatus.DISPUTED
    ) {
      throw new BadRequestException('Reopen the match before editing players at this stage.');
    }

    const player = match.players.find((item) => item.id === playerId);
    if (!player) {
      throw new NotFoundException('Match player not found.');
    }

    const shouldReopen = match.status === MatchStatus.LOCKED;

    await this.prismaService.$transaction(async (tx) => {
      await tx.inhouseMatchPlayer.update({
        where: { id: playerId },
        data: {
          riotAccountId: dto.riotAccountId,
          participationStatus: dto.participationStatus,
          sameTeamPreferencesJson: dto.sameTeamPreferenceUserIds,
          avoidTeamPreferencesJson: dto.avoidTeamPreferenceUserIds,
          isCaptain: dto.isCaptain,
        },
      });

      if (shouldReopen) {
        await tx.inhouseMatchPlayer.updateMany({
          where: {
            matchId,
            participationStatus: ParticipationStatus.LOCKED_IN,
          },
          data: {
            participationStatus: ParticipationStatus.ACCEPTED,
          },
        });

        await tx.inhouseMatch.update({
          where: { id: matchId },
          data: {
            status: MatchStatus.RECRUITING,
            balanceMode: null,
            selectedCandidateNo: null,
            candidatesJson: Prisma.JsonNull,
          },
        });
      }
    });

    await this.auditLogService.create({
      userId: requesterUserId,
      action: 'MATCH_PLAYER_UPDATED',
      entityType: 'inhouse_match_players',
      entityId: playerId,
      before: {
        riotAccountId: player.riotAccountId,
        participationStatus: player.participationStatus,
        sameTeamPreferencesJson: player.sameTeamPreferencesJson,
        avoidTeamPreferencesJson: player.avoidTeamPreferencesJson,
        isCaptain: player.isCaptain,
      },
      after: dto,
      meta: {
        matchId,
        reopenedToRecruiting: shouldReopen,
      },
    });

    return this.getMatch(requesterUserId, matchId);
  }

  async lockMatch(requesterUserId: string, matchId: string): Promise<MatchResponseDto> {
    const match = await this.getMatchWithPlayers(matchId);
    await this.assertMatchHostOrGroupAdmin(match, requesterUserId);

    if (match.players.length !== 10) {
      throw new BadRequestException('Exactly 10 players are required to lock a match.');
    }

    const acceptedPlayers = match.players.filter(
      (player) =>
        player.participationStatus === ParticipationStatus.ACCEPTED ||
        player.participationStatus === ParticipationStatus.LOCKED_IN,
    );

    if (acceptedPlayers.length !== 10) {
      throw new BadRequestException('All 10 players must accept before locking the match.');
    }

    await this.prismaService.$transaction([
      this.prismaService.inhouseMatchPlayer.updateMany({
        where: { matchId },
        data: { participationStatus: ParticipationStatus.LOCKED_IN },
      }),
      this.prismaService.inhouseMatch.update({
        where: { id: matchId },
        data: { status: MatchStatus.LOCKED },
      }),
    ]);

    await this.auditLogService.create({
      userId: requesterUserId,
      action: 'MATCH_LOCKED',
      entityType: 'inhouse_matches',
      entityId: matchId,
      after: { status: MatchStatus.LOCKED },
    });

    return this.getMatch(requesterUserId, matchId);
  }

  async assignCandidate(
    requesterUserId: string,
    matchId: string,
    candidateNo: number,
  ): Promise<MatchResponseDto> {
    const match = await this.getMatchWithPlayers(matchId);
    await this.assertMatchHostOrCaptain(matchId, requesterUserId);

    const candidates = Array.isArray(match.candidatesJson)
      ? (match.candidatesJson as Array<Record<string, unknown>>)
      : [];
    const candidate = candidates.find(
      (item) => Number(item.candidateNo ?? 0) === candidateNo,
    );

    if (!candidate) {
      throw new NotFoundException('Candidate not found for this match.');
    }

    const teamA = Array.isArray(candidate.teamA)
      ? (candidate.teamA as Array<Record<string, unknown>>)
      : [];
    const teamB = Array.isArray(candidate.teamB)
      ? (candidate.teamB as Array<Record<string, unknown>>)
      : [];

    await this.prismaService.$transaction(async (tx) => {
      for (const player of [...teamA, ...teamB]) {
        await tx.inhouseMatchPlayer.update({
          where: {
            matchId_userId: {
              matchId,
              userId: String(player.userId),
            },
          },
          data: {
            teamSide: String(player.teamSide) as 'A' | 'B',
            assignedRole: String(player.assignedRole) as Position,
            participationStatus: ParticipationStatus.LOCKED_IN,
          },
        });
      }

      await tx.inhouseMatch.update({
        where: { id: matchId },
        data: {
          balanceMode: candidate.type as BalanceMode,
          selectedCandidateNo: candidateNo,
          status: MatchStatus.BALANCED,
        },
      });
    });

    await this.auditLogService.create({
      userId: requesterUserId,
      action: 'MATCH_BALANCED',
      entityType: 'inhouse_matches',
      entityId: matchId,
      after: {
        status: MatchStatus.BALANCED,
        candidateNo,
      },
    });

    return this.getMatch(requesterUserId, matchId);
  }

  async reopenMatch(
    requesterUserId: string,
    matchId: string,
  ): Promise<MatchResponseDto> {
    const match = await this.getMatchWithPlayers(matchId);
    await this.assertAdminOrGroupAdmin(match, requesterUserId);

    if (
      match.status === MatchStatus.IN_PROGRESS ||
      match.status === MatchStatus.CONFIRMED ||
      match.status === MatchStatus.CLOSED ||
      match.result?.resultStatus === ResultStatus.CONFIRMED
    ) {
      throw new BadRequestException('Confirmed or in-progress matches cannot be reopened.');
    }

    if (
      match.status !== MatchStatus.LOCKED &&
      match.status !== MatchStatus.BALANCED &&
      match.status !== MatchStatus.RESULT_PENDING &&
      match.status !== MatchStatus.DISPUTED
    ) {
      throw new BadRequestException('Only locked, balanced, or unconfirmed result matches can be reopened.');
    }

    await this.prismaService.$transaction(async (tx) => {
      if (match.result) {
        await tx.inhousePlayerStat.deleteMany({
          where: { matchId },
        });

        await tx.inhouseMatchResult.delete({
          where: { id: match.result.id },
        });
      }

      await tx.inhouseMatchPlayer.updateMany({
        where: { matchId },
        data: {
          teamSide: null,
          assignedRole: null,
          participationStatus: ParticipationStatus.ACCEPTED,
        },
      });

      await tx.inhouseMatch.update({
        where: { id: matchId },
        data: {
          status: MatchStatus.RECRUITING,
          balanceMode: null,
          selectedCandidateNo: null,
          candidatesJson: Prisma.JsonNull,
        },
      });
    });

    await this.auditLogService.create({
      userId: requesterUserId,
      action: 'MATCH_REOPENED',
      entityType: 'inhouse_matches',
      entityId: matchId,
      meta: {
        previousStatus: match.status,
        previousResultStatus: match.result?.resultStatus ?? null,
      },
    });

    return this.getMatch(requesterUserId, matchId);
  }

  async getMatchSummary(
    requesterUserId: string,
    matchId: string,
  ): Promise<MatchSummaryResponseDto> {
    const match = await this.getMatchWithPlayers(matchId);
    await this.groupsService.assertGroupMember(match.groupId, requesterUserId);

    const stats = await this.prismaService.inhousePlayerStat.findMany({
      where: { matchId },
    });
    const powerProfiles = await this.prismaService.playerPowerProfile.findMany({
      where: {
        userId: {
          in: match.players.map((player) => player.userId),
        },
      },
      select: {
        userId: true,
        overallPower: true,
      },
    });

    const powerMap = new Map(powerProfiles.map((profile) => [profile.userId, profile.overallPower]));
    const statMap = new Map(stats.map((stat) => [stat.userId, stat]));
    const toSummaryPlayer = (player: (typeof match.players)[number]) => {
      const stat = statMap.get(player.userId);
      return {
        userId: player.userId,
        nickname: player.user.nickname,
        assignedRole: player.assignedRole,
        currentPower: powerMap.get(player.userId) ?? 0,
        kda: stat ? `${stat.kills}/${stat.deaths}/${stat.assists}` : null,
        laneResult: stat?.laneResult ?? null,
      };
    };
    const teamA = match.players.filter((player) => player.teamSide === TeamSide.A).map(toSummaryPlayer);
    const teamB = match.players.filter((player) => player.teamSide === TeamSide.B).map(toSummaryPlayer);

    return {
      matchId: match.id,
      status: match.status,
      winningTeam: match.result?.winningTeam ?? null,
      resultStatus: match.result?.resultStatus ?? null,
      mvpUserId: match.result?.mvpUserId ?? null,
      balanceRating: match.result?.balanceRating ?? null,
      teamAPower: Number(teamA.reduce((sum, player) => sum + player.currentPower, 0).toFixed(2)),
      teamBPower: Number(teamB.reduce((sum, player) => sum + player.currentPower, 0).toFixed(2)),
      teamA,
      teamB,
    };
  }

  async assertMatchHostOrCaptain(matchId: string, userId: string): Promise<void> {
    const match = await this.prismaService.inhouseMatch.findUnique({
      where: { id: matchId },
      include: {
        players: true,
      },
    });

    if (!match) {
      throw new NotFoundException('Match not found.');
    }

    const member = await this.prismaService.groupMember.findUnique({
      where: {
        groupId_userId: {
          groupId: match.groupId,
          userId,
        },
      },
    });
    const player = match.players.find((item) => item.userId === userId);
    const isCaptain = Boolean(player?.isCaptain);
    const isHost = match.createdBy === userId;
    const isAdmin = member
      ? member.role === GroupRole.OWNER || member.role === GroupRole.ADMIN
      : false;

    if (!isHost && !isCaptain && !isAdmin) {
      throw new ForbiddenException('Only the host, captain, or group admin can perform this action.');
    }
  }

  async getMatchWithPlayers(matchId: string) {
    const match = await this.prismaService.inhouseMatch.findUnique({
      where: { id: matchId },
      include: {
        players: {
          include: {
            user: true,
            riotAccount: true,
          },
        },
        result: true,
      },
    });

    if (!match) {
      throw new NotFoundException('Match not found.');
    }

    return match;
  }

  private async assertMatchHostOrGroupAdmin(
    match: Awaited<ReturnType<MatchesService['getMatchWithPlayers']>>,
    userId: string,
  ): Promise<void> {
    const membership = await this.prismaService.groupMember.findUnique({
      where: {
        groupId_userId: {
          groupId: match.groupId,
          userId,
        },
      },
    });

    if (
      match.createdBy !== userId &&
      (!membership ||
        (membership.role !== GroupRole.OWNER && membership.role !== GroupRole.ADMIN))
    ) {
      throw new ForbiddenException('Only the match host or group admin can perform this action.');
    }
  }

  private async assertAdminOrGroupAdmin(
    match: Awaited<ReturnType<MatchesService['getMatchWithPlayers']>>,
    userId: string,
  ): Promise<void> {
    const [membership, user] = await Promise.all([
      this.prismaService.groupMember.findUnique({
        where: {
          groupId_userId: {
            groupId: match.groupId,
            userId,
          },
        },
      }),
      this.prismaService.user.findUnique({
        where: { id: userId },
        select: { isAdmin: true },
      }),
    ]);

    if (
      user?.isAdmin ||
      (membership &&
        (membership.role === GroupRole.OWNER || membership.role === GroupRole.ADMIN))
    ) {
      return;
    }

    throw new ForbiddenException('Only admins or group admins can perform this action.');
  }

  private toMatchResponse(match: {
    id: string;
    groupId: string;
    status: MatchStatus;
    scheduledAt: Date | null;
    balanceMode: string | null;
    selectedCandidateNo: number | null;
    candidatesJson?: unknown;
    players: Array<{
      id: string;
      userId: string;
      user: { nickname: string };
      teamSide: string | null;
      assignedRole: Position | null;
      participationStatus: ParticipationStatus;
      isCaptain: boolean;
    }>;
  }): MatchResponseDto {
    return {
      id: match.id,
      groupId: match.groupId,
      status: match.status,
      scheduledAt: match.scheduledAt?.toISOString() ?? null,
      balanceMode: (match.balanceMode as BalanceMode | null) ?? null,
      selectedCandidateNo: match.selectedCandidateNo,
      players: match.players.map((player) => ({
        id: player.id,
        userId: player.userId,
        nickname: player.user.nickname,
        teamSide: (player.teamSide as 'A' | 'B' | null) ?? null,
        assignedRole: player.assignedRole,
        participationStatus: player.participationStatus,
        isCaptain: player.isCaptain,
      })),
      candidates: match.candidatesJson ?? null,
    };
  }
}
