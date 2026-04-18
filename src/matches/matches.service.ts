import {
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import {
  BalanceMode,
  GroupRole,
  MatchStatus,
  ParticipationStatus,
  Position,
  Prisma,
  ResultStatus,
  TeamSide,
} from '@prisma/client';

import { AuditLogService } from '../common/audit-log.service';
import { AppErrorCode, AppException } from '../common/app.exception';
import { GroupsService } from '../groups/groups.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  AddMatchPlayersDto,
  CreateMatchDto,
  MatchRematchInputResponseDto,
  MatchResponseDto,
  RecentMatchListResponseDto,
  RecentMatchesQueryDto,
  SaveManualBalanceDto,
  MatchSummaryResponseDto,
  UpdateMatchPlayerDto,
} from './dto/matches.dto';

@Injectable()
export class MatchesService {
  private readonly roleOrder = [
    Position.TOP,
    Position.JUNGLE,
    Position.MID,
    Position.ADC,
    Position.SUPPORT,
    Position.FILL,
  ] as Position[];

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

    return this.getMatch(requesterUserId, match.id);
  }

  async getMatch(
    requesterUserId: string,
    matchId: string,
  ): Promise<MatchResponseDto> {
    const match = await this.getMatchWithPlayers(matchId);
    await this.groupsService.assertGroupMember(match.groupId, requesterUserId);
    return this.buildMatchDetailResponse(match);
  }

  async getRematchInput(
    requesterUserId: string,
    matchId: string,
  ): Promise<MatchRematchInputResponseDto> {
    const match = await this.getMatchWithPlayers(matchId);
    await this.groupsService.assertGroupMember(match.groupId, requesterUserId);

    if (match.players.length === 0) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        AppErrorCode.REMATCH_INPUT_UNAVAILABLE,
        'No rematch-ready players were found for this match.',
        {
          matchId,
          playerCount: 0,
        },
      );
    }

    return this.toRematchInputResponse(match);
  }

  async listRecentMatches(
    requesterUserId: string,
    query: RecentMatchesQueryDto,
  ): Promise<RecentMatchListResponseDto> {
    if (query.groupId) {
      await this.groupsService.assertGroupMember(query.groupId, requesterUserId);
    }

    const matches = await this.prismaService.inhouseMatch.findMany({
      where: {
        ...(query.groupId ? { groupId: query.groupId } : {}),
        group: {
          archivedAt: null,
          members: {
            some: {
              userId: requesterUserId,
            },
          },
        },
      },
      include: {
        group: {
          select: {
            id: true,
            name: true,
          },
        },
        result: true,
        players: {
          select: {
            id: true,
          },
        },
      },
      orderBy: [{ scheduledAt: 'desc' }, { updatedAt: 'desc' }, { createdAt: 'desc' }],
      take: query.limit ?? 20,
    });

    return {
      items: matches.map((match) => this.toRecentMatchItem(match)),
    };
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
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        AppErrorCode.MATCH_EDIT_NOT_ALLOWED,
        'Players can only be added before the match is locked.',
        {
          matchId,
          status: match.status,
        },
      );
    }

    const currentUserIds = new Set(match.players.map((player) => player.userId));
    const addedUserIds = dto.players
      .map((player) => player.userId)
      .filter((userId) => !currentUserIds.has(userId));
    const snapshotSeedByUserId = await this.getSnapshotSeedByUserId(addedUserIds);
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
        positionPrefSnapshot: this.createPositionPreferenceSnapshot(
          snapshotSeedByUserId.get(player.userId),
        ),
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
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        AppErrorCode.MATCH_EDIT_NOT_ALLOWED,
        'This match can no longer be edited.',
        {
          matchId,
          status: match.status,
        },
      );
    }

    if (
      match.status === MatchStatus.BALANCED ||
      match.status === MatchStatus.RESULT_PENDING ||
      match.status === MatchStatus.DISPUTED
    ) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        AppErrorCode.MATCH_EDIT_NOT_ALLOWED,
        'Reopen the match before editing players at this stage.',
        {
          matchId,
          status: match.status,
        },
      );
    }

    const player = match.players.find((item) => item.id === playerId);
    if (!player) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        AppErrorCode.MATCH_PLAYER_NOT_FOUND,
        'Match player not found.',
        {
          matchId,
          playerId,
        },
      );
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
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        AppErrorCode.MATCH_LOCK_NOT_READY,
        'Exactly 10 players are required to lock a match.',
        {
          matchId,
          playerCount: match.players.length,
        },
      );
    }

    const acceptedPlayers = match.players.filter(
      (player) =>
        player.participationStatus === ParticipationStatus.ACCEPTED ||
        player.participationStatus === ParticipationStatus.LOCKED_IN,
    );

    if (acceptedPlayers.length !== 10) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        AppErrorCode.MATCH_LOCK_NOT_READY,
        'All 10 players must accept before locking the match.',
        {
          matchId,
          acceptedPlayerCount: acceptedPlayers.length,
        },
      );
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

  async saveManualBalance(
    requesterUserId: string,
    matchId: string,
    dto: SaveManualBalanceDto,
  ): Promise<MatchResponseDto> {
    await this.assertMatchHostOrCaptain(matchId, requesterUserId);

    const match = await this.getMatchWithPlayers(matchId);
    this.assertManualBalanceEditable(match);

    const teamAssignments = this.normalizeManualBalanceAssignments(match, dto);

    await this.prismaService.$transaction(async (tx) => {
      for (const assignment of teamAssignments) {
        await tx.inhouseMatchPlayer.update({
          where: {
            matchId_userId: {
              matchId,
              userId: assignment.userId,
            },
          },
          data: {
            teamSide: assignment.teamSide,
            assignedRole: assignment.assignedRole,
            participationStatus: ParticipationStatus.LOCKED_IN,
          },
        });
      }

      await tx.inhouseMatch.update({
        where: { id: matchId },
        data: {
          status: MatchStatus.BALANCED,
          selectedCandidateNo: null,
          balanceMode: match.balanceMode ?? BalanceMode.BALANCED,
        },
      });
    });

    await this.auditLogService.create({
      userId: requesterUserId,
      action: 'MATCH_MANUAL_BALANCE_SAVED',
      entityType: 'inhouse_matches',
      entityId: matchId,
      after: {
        blueTeam: dto.blueTeam.players,
        redTeam: dto.redTeam.players,
      },
      meta: {
        matchId,
      },
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
      throw new AppException(
        HttpStatus.NOT_FOUND,
        AppErrorCode.MATCH_CANDIDATE_NOT_FOUND,
        'Candidate not found for this match.',
        {
          matchId,
          candidateNo,
        },
      );
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
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        AppErrorCode.MATCH_REOPEN_NOT_ALLOWED,
        'Confirmed or in-progress matches cannot be reopened.',
        {
          matchId,
          status: match.status,
          resultStatus: match.result?.resultStatus ?? null,
        },
      );
    }

    if (
      match.status !== MatchStatus.LOCKED &&
      match.status !== MatchStatus.BALANCED &&
      match.status !== MatchStatus.RESULT_PENDING &&
      match.status !== MatchStatus.DISPUTED
    ) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        AppErrorCode.MATCH_REOPEN_NOT_ALLOWED,
        'Only locked, balanced, or unconfirmed result matches can be reopened.',
        {
          matchId,
          status: match.status,
        },
      );
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
    const statMap = new Map(stats.map((stat) => [stat.userId, stat]));
    const toSummaryPlayer = (player: (typeof match.players)[number]) => {
      const stat = statMap.get(player.userId);
      const recentPower = player.user.powerProfile?.overallPower ?? null;
      return {
        userId: player.userId,
        nickname: player.user.nickname,
        mainPosition: player.user.primaryPosition,
        recentPower,
        profileVisible: true,
        assignedRole: player.assignedRole,
        currentPower: recentPower ?? 0,
        kda: stat ? `${stat.kills}/${stat.deaths}/${stat.assists}` : null,
        laneResult: stat?.laneResult ?? null,
      };
    };
    const teamA = match.players.filter((player) => player.teamSide === TeamSide.A).map(toSummaryPlayer);
    const teamB = match.players.filter((player) => player.teamSide === TeamSide.B).map(toSummaryPlayer);

    return {
      id: match.id,
      matchId: match.id,
      canonicalMatchId: match.id,
      groupId: match.groupId,
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

  async assertMatchHostOrCaptain(
    matchId: string,
    userId: string,
    options: {
      notFoundCode?: AppErrorCode;
      forbiddenCode?: AppErrorCode;
      forbiddenMessage?: string;
    } = {},
  ): Promise<void> {
    const match = await this.prismaService.inhouseMatch.findUnique({
      where: { id: matchId },
      include: {
        players: true,
      },
    });

    if (!match) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        options.notFoundCode ?? AppErrorCode.MATCH_NOT_FOUND,
        'Match not found.',
        {
          matchId,
        },
      );
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
      throw new AppException(
        HttpStatus.FORBIDDEN,
        options.forbiddenCode ?? AppErrorCode.FORBIDDEN,
        options.forbiddenMessage ??
          'Only the host, captain, or group admin can perform this action.',
        {
          matchId,
          userId,
        },
      );
    }
  }

  async getMatchWithPlayers(
    matchId: string,
    notFoundCode: AppErrorCode = AppErrorCode.MATCH_NOT_FOUND,
  ) {
    const match = await this.prismaService.inhouseMatch.findUnique({
      where: { id: matchId },
      include: {
        group: {
          select: {
            id: true,
            name: true,
          },
        },
        players: {
          include: {
            user: {
              select: {
                id: true,
                nickname: true,
                primaryPosition: true,
                secondaryPosition: true,
                isFillAvailable: true,
                powerProfile: {
                  select: {
                    overallPower: true,
                    lanePowerJson: true,
                    calculatedAt: true,
                    version: true,
                  },
                },
              },
            },
            riotAccount: true,
          },
        },
        result: true,
      },
    });

    if (!match) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        notFoundCode,
        'Match not found.',
        {
          matchId,
        },
      );
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
      throw new AppException(
        HttpStatus.FORBIDDEN,
        AppErrorCode.FORBIDDEN,
        'Only the match host or group admin can perform this action.',
        {
          matchId: match.id,
          userId,
        },
      );
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

    throw new AppException(
      HttpStatus.FORBIDDEN,
      AppErrorCode.FORBIDDEN,
      'Only admins or group admins can perform this action.',
      {
        matchId: match.id,
        userId,
      },
    );
  }

  private async buildMatchDetailResponse(
    match: Awaited<ReturnType<MatchesService['getMatchWithPlayers']>>,
  ): Promise<MatchResponseDto> {
    const hasManualAssignments =
      match.selectedCandidateNo === null &&
      match.players.some((player) => player.teamSide && player.assignedRole);
    const [manualBalance, stats] = await Promise.all([
      hasManualAssignments ? this.getLatestManualBalanceMetadata(match.id) : Promise.resolve(null),
      this.getMatchStats(match.id),
    ]);

    return this.toMatchResponse(match, manualBalance, stats);
  }

  private toMatchResponse(
    match: Awaited<ReturnType<MatchesService['getMatchWithPlayers']>>,
    manualBalance: MatchResponseDto['manualBalance'] = null,
    stats: Awaited<ReturnType<MatchesService['getMatchStats']>> = [],
  ): MatchResponseDto {
    const statMap = new Map(stats.map((stat) => [stat.userId, stat]));
    const players = match.players.map((player) =>
      this.toMatchPlayerResponse(player, statMap.get(player.userId) ?? null),
    );
    const blueTeamPlayers = players.filter((player) => player.teamSide === TeamSide.A);
    const redTeamPlayers = players.filter((player) => player.teamSide === TeamSide.B);

    return {
      id: match.id,
      matchId: match.id,
      canonicalMatchId: match.id,
      groupId: match.groupId,
      groupName: match.group?.name ?? null,
      status: match.status,
      title: match.title ?? null,
      notes: match.notes ?? null,
      scheduledAt: match.scheduledAt?.toISOString() ?? null,
      playedAt:
        match.result?.confirmedAt?.toISOString() ??
        match.result?.updatedAt?.toISOString() ??
        null,
      updatedAt: match.updatedAt.toISOString(),
      balanceMode: (match.balanceMode as BalanceMode | null) ?? null,
      selectedCandidateNo: match.selectedCandidateNo,
      players,
      blueTeam: this.toMatchTeamResponse(TeamSide.A, 'blue', blueTeamPlayers),
      redTeam: this.toMatchTeamResponse(TeamSide.B, 'red', redTeamPlayers),
      winningTeam: match.result?.winningTeam ?? null,
      resultStatus: match.result?.resultStatus ?? null,
      resultSummary: this.toResultSummary(match, stats),
      candidates: match.candidatesJson ?? null,
      manualBalance,
      rematchInput: this.toRematchInputResponse(match),
    };
  }

  private toMatchPlayerResponse(
    player: Awaited<ReturnType<MatchesService['getMatchWithPlayers']>>['players'][number],
    stat: Awaited<ReturnType<MatchesService['getMatchStats']>>[number] | null,
  ): MatchResponseDto['players'][number] {
    const powerSnapshot = this.resolvePlayerPowerSnapshot(player);

    return {
      id: player.id,
      userId: player.userId,
      nickname: player.user.nickname,
      primaryPosition: player.user.primaryPosition,
      mainPosition: player.user.primaryPosition,
      secondaryPosition: player.user.secondaryPosition,
      recentPower: powerSnapshot?.overallPower ?? null,
      profileVisible: true,
      teamSide: player.teamSide,
      assignedRole: player.assignedRole,
      participationStatus: player.participationStatus,
      isCaptain: player.isCaptain,
      resultStats: stat
        ? {
            kills: stat.kills,
            deaths: stat.deaths,
            assists: stat.assists,
            kda: `${stat.kills}/${stat.deaths}/${stat.assists}`,
            laneResult: stat.laneResult,
            contributionRating: stat.contributionRating,
          }
        : null,
      powerSnapshot,
      powerChange: {
        before: null,
        after: null,
        delta: null,
        available: false,
      },
    };
  }

  private toMatchTeamResponse(
    teamSide: TeamSide,
    label: 'blue' | 'red',
    players: MatchResponseDto['players'],
  ): MatchResponseDto['blueTeam'] {
    if (players.length === 0) {
      return null;
    }

    const totalPower = Number(
      players.reduce((sum, player) => sum + (player.powerSnapshot?.overallPower ?? 0), 0).toFixed(2),
    );

    return {
      teamSide,
      label,
      playerCount: players.length,
      totalPower,
      players,
    };
  }

  private toResultSummary(
    match: Awaited<ReturnType<MatchesService['getMatchWithPlayers']>>,
    stats: Awaited<ReturnType<MatchesService['getMatchStats']>>,
  ): MatchResponseDto['resultSummary'] {
    if (!match.result) {
      return null;
    }

    return {
      resultId: match.result.id,
      resultStatus: match.result.resultStatus,
      winningTeam: match.result.winningTeam,
      mvpUserId: match.result.mvpUserId,
      balanceRating: match.result.balanceRating,
      balanceFeeling: match.result.balanceRating,
      submittedBy: match.result.submittedBy,
      updatedAt: match.result.updatedAt.toISOString(),
      confirmedAt: match.result.confirmedAt?.toISOString() ?? null,
      adminResolvedAt: match.result.adminResolvedAt?.toISOString() ?? null,
      playerStatsCount: stats.length,
    };
  }

  private toRematchInputResponse(
    match: Awaited<ReturnType<MatchesService['getMatchWithPlayers']>>,
  ): MatchRematchInputResponseDto {
    const selectedCombinationKey = this.extractSelectedCombinationKey(match);

    return {
      matchId: match.id,
      canonicalMatchId: match.id,
      groupId: match.groupId,
      groupName: match.group?.name ?? null,
      players: match.players.map((player) => {
        const powerSnapshot = this.resolvePlayerPowerSnapshot(player);
        return {
          userId: player.userId,
          nickname: player.user.nickname,
          primaryPosition: powerSnapshot?.primaryPosition ?? player.user.primaryPosition,
          secondaryPosition:
            powerSnapshot?.secondaryPosition ?? player.user.secondaryPosition,
          isFillAvailable: powerSnapshot?.isFillAvailable ?? player.user.isFillAvailable,
          overallPower: powerSnapshot?.overallPower ?? 50,
          lanePower: powerSnapshot?.lanePower ?? this.defaultLanePower(powerSnapshot?.overallPower ?? 50),
          sameTeamPreferenceUserIds: this.toStringArray(player.sameTeamPreferencesJson),
          avoidTeamPreferenceUserIds: this.toStringArray(player.avoidTeamPreferencesJson),
          lockedTeamSide: player.teamSide,
          lockedRole: player.assignedRole,
          powerSnapshot,
        };
      }),
      options: {
        supportedStrategies: [
          BalanceMode.BALANCED,
          BalanceMode.POSITION_FIRST,
          BalanceMode.SKILL_FIRST,
        ],
        excludePreviousCombinationSupported: true,
        regenerateNonceSupported: true,
        defaultExcludePreviousCombination: true,
        excludePreviousCombinationKeys: selectedCombinationKey
          ? [selectedCombinationKey]
          : [],
      },
    };
  }

  private toRecentMatchItem(match: {
    id: string;
    groupId: string;
    group: {
      id: string;
      name: string;
    };
    title: string | null;
    status: MatchStatus;
    scheduledAt: Date | null;
    updatedAt: Date;
    result: {
      winningTeam: TeamSide | null;
      resultStatus: ResultStatus;
    } | null;
    players: Array<{ id: string }>;
  }) {
    return {
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
    };
  }

  private async getMatchStats(matchId: string) {
    return this.prismaService.inhousePlayerStat.findMany({
      where: { matchId },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async getSnapshotSeedByUserId(userIds: string[]) {
    if (userIds.length === 0) {
      return new Map<
        string,
        {
          primaryPosition: Position | null;
          secondaryPosition: Position | null;
          isFillAvailable: boolean;
          powerProfile: {
            overallPower: number;
            lanePowerJson: unknown;
            calculatedAt: Date;
            version: string;
          } | null;
        }
      >();
    }

    const users = await this.prismaService.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        primaryPosition: true,
        secondaryPosition: true,
        isFillAvailable: true,
        powerProfile: {
          select: {
            overallPower: true,
            lanePowerJson: true,
            calculatedAt: true,
            version: true,
          },
        },
      },
    });

    return new Map(users.map((user) => [user.id, user]));
  }

  private createPositionPreferenceSnapshot(
    seed:
      | {
          primaryPosition: Position | null;
          secondaryPosition: Position | null;
          isFillAvailable: boolean;
          powerProfile: {
            overallPower: number;
            lanePowerJson: unknown;
            calculatedAt: Date;
            version: string;
          } | null;
        }
      | undefined,
  ) {
    if (!seed) {
      return {};
    }

    const overallPower = seed.powerProfile?.overallPower ?? 50;

    return {
      primaryPosition: seed.primaryPosition,
      secondaryPosition: seed.secondaryPosition,
      isFillAvailable: seed.isFillAvailable,
      overallPower,
      lanePower: this.normalizeLanePower(
        overallPower,
        seed.powerProfile?.lanePowerJson ?? null,
      ),
      calculatedAt: seed.powerProfile?.calculatedAt?.toISOString() ?? null,
      version: seed.powerProfile?.version ?? null,
      source: 'MATCH_SNAPSHOT',
    };
  }

  private resolvePlayerPowerSnapshot(
    player: Awaited<ReturnType<MatchesService['getMatchWithPlayers']>>['players'][number],
  ): MatchResponseDto['players'][number]['powerSnapshot'] {
    const snapshot = this.parsePositionPreferenceSnapshot(player.positionPrefSnapshot);

    if (snapshot) {
      return snapshot;
    }

    const currentProfile = player.user.powerProfile;
    if (currentProfile) {
      return {
        overallPower: currentProfile.overallPower,
        lanePower: this.normalizeLanePower(
          currentProfile.overallPower,
          currentProfile.lanePowerJson ?? null,
        ),
        primaryPosition: player.user.primaryPosition,
        secondaryPosition: player.user.secondaryPosition,
        isFillAvailable: player.user.isFillAvailable,
        calculatedAt: currentProfile.calculatedAt.toISOString(),
        version: currentProfile.version,
        source: 'CURRENT_PROFILE',
      };
    }

    return {
      overallPower: 50,
      lanePower: this.defaultLanePower(50),
      primaryPosition: player.user.primaryPosition,
      secondaryPosition: player.user.secondaryPosition,
      isFillAvailable: player.user.isFillAvailable,
      calculatedAt: null,
      version: null,
      source: 'DEFAULT_FALLBACK',
    };
  }

  private parsePositionPreferenceSnapshot(
    snapshot: unknown,
  ): MatchResponseDto['players'][number]['powerSnapshot'] | null {
    if (!snapshot || typeof snapshot !== 'object') {
      return null;
    }

    const raw = snapshot as Record<string, unknown>;
    const overallPower =
      typeof raw.overallPower === 'number' ? raw.overallPower : null;

    if (overallPower === null) {
      return null;
    }

    return {
      overallPower,
      lanePower: this.normalizeLanePower(overallPower, raw.lanePower ?? null),
      primaryPosition: this.toPositionOrNull(raw.primaryPosition),
      secondaryPosition: this.toPositionOrNull(raw.secondaryPosition),
      isFillAvailable:
        typeof raw.isFillAvailable === 'boolean' ? raw.isFillAvailable : true,
      calculatedAt:
        typeof raw.calculatedAt === 'string' ? raw.calculatedAt : null,
      version: typeof raw.version === 'string' ? raw.version : null,
      source: typeof raw.source === 'string' ? raw.source : 'MATCH_SNAPSHOT',
    };
  }

  private defaultLanePower(overallPower: number): Record<string, number> {
    return {
      [Position.TOP]: overallPower,
      [Position.JUNGLE]: overallPower,
      [Position.MID]: overallPower,
      [Position.ADC]: overallPower,
      [Position.SUPPORT]: overallPower,
    };
  }

  private normalizeLanePower(
    overallPower: number,
    lanePower: unknown,
  ): Record<string, number> {
    const defaults = this.defaultLanePower(overallPower);
    const raw =
      lanePower && typeof lanePower === 'object'
        ? (lanePower as Record<string, unknown>)
        : {};

    return {
      [Position.TOP]:
        typeof raw[Position.TOP] === 'number'
          ? Number(raw[Position.TOP])
          : defaults[Position.TOP],
      [Position.JUNGLE]:
        typeof raw[Position.JUNGLE] === 'number'
          ? Number(raw[Position.JUNGLE])
          : defaults[Position.JUNGLE],
      [Position.MID]:
        typeof raw[Position.MID] === 'number'
          ? Number(raw[Position.MID])
          : defaults[Position.MID],
      [Position.ADC]:
        typeof raw[Position.ADC] === 'number'
          ? Number(raw[Position.ADC])
          : defaults[Position.ADC],
      [Position.SUPPORT]:
        typeof raw[Position.SUPPORT] === 'number'
          ? Number(raw[Position.SUPPORT])
          : defaults[Position.SUPPORT],
    };
  }

  private extractSelectedCombinationKey(
    match: Awaited<ReturnType<MatchesService['getMatchWithPlayers']>>,
  ): string | null {
    const candidates = Array.isArray(match.candidatesJson)
      ? (match.candidatesJson as Array<Record<string, unknown>>)
      : [];
    const selectedCandidate = candidates.find(
      (candidate) => Number(candidate.candidateNo ?? 0) === match.selectedCandidateNo,
    );

    if (typeof selectedCandidate?.combinationKey === 'string') {
      return selectedCandidate.combinationKey;
    }

    const teamAPlayers = match.players
      .filter(
        (player) =>
          player.teamSide === TeamSide.A &&
          player.assignedRole !== null,
      )
      .sort(
        (left, right) =>
          this.getRoleSortIndex(left.assignedRole) -
          this.getRoleSortIndex(right.assignedRole),
      );

    if (teamAPlayers.length !== 5) {
      return null;
    }

    return teamAPlayers
      .map((player) => `${player.userId}-${player.assignedRole}`)
      .join('|');
  }

  private toPositionOrNull(value: unknown): Position | null {
    return Object.values(Position).includes(value as Position)
      ? (value as Position)
      : null;
  }

  private getRoleSortIndex(role: Position | null): number {
    if (role === null) {
      return Number.MAX_SAFE_INTEGER;
    }

    const index = this.roleOrder.indexOf(role);
    return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
  }

  private toStringArray(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  }

  private assertManualBalanceEditable(
    match: Awaited<ReturnType<MatchesService['getMatchWithPlayers']>>,
  ): void {
    if (
      match.status === MatchStatus.IN_PROGRESS ||
      match.status === MatchStatus.CONFIRMED ||
      match.status === MatchStatus.CLOSED
    ) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        AppErrorCode.MATCH_BALANCE_INVALID,
        'This match can no longer accept manual team changes.',
        {
          matchId: match.id,
          status: match.status,
        },
      );
    }

    if (match.players.length !== 10) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        AppErrorCode.MATCH_BALANCE_INVALID,
        'Manual balance requires exactly 10 current match players.',
        {
          matchId: match.id,
          playerCount: match.players.length,
        },
      );
    }
  }

  private normalizeManualBalanceAssignments(
    match: Awaited<ReturnType<MatchesService['getMatchWithPlayers']>>,
    dto: SaveManualBalanceDto,
  ): Array<{ userId: string; assignedRole: Position; teamSide: TeamSide }> {
    const blueTeam = dto.blueTeam.players.map((player) => ({
      ...player,
      teamSide: TeamSide.A,
    }));
    const redTeam = dto.redTeam.players.map((player) => ({
      ...player,
      teamSide: TeamSide.B,
    }));
    const assignments = [...blueTeam, ...redTeam];
    const currentUserIds = new Set(match.players.map((player) => player.userId));

    if (blueTeam.length !== 5 || redTeam.length !== 5) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        AppErrorCode.MATCH_BALANCE_INVALID,
        'Manual balance requires exactly 5 players on each team.',
        {
          matchId: match.id,
          blueCount: blueTeam.length,
          redCount: redTeam.length,
        },
      );
    }

    if (assignments.length !== currentUserIds.size) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        AppErrorCode.MATCH_BALANCE_INVALID,
        'Manual balance must assign every current match player exactly once.',
        {
          matchId: match.id,
        },
      );
    }

    if (new Set(assignments.map((player) => player.userId)).size !== assignments.length) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        AppErrorCode.MATCH_BALANCE_INVALID,
        'Manual balance contains duplicate players.',
        {
          matchId: match.id,
        },
      );
    }

    const unknownUserIds = assignments
      .map((player) => player.userId)
      .filter((userId) => !currentUserIds.has(userId));
    if (unknownUserIds.length > 0) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        AppErrorCode.MATCH_BALANCE_INVALID,
        'Manual balance contains players who are not part of the current match.',
        {
          matchId: match.id,
          unknownUserIds,
        },
      );
    }

    for (const team of [blueTeam, redTeam]) {
      const roleSet = new Set(team.map((player) => player.assignedRole));
      if (roleSet.size !== team.length) {
        throw new AppException(
          HttpStatus.BAD_REQUEST,
          AppErrorCode.MATCH_BALANCE_INVALID,
          'Manual balance must assign each role at most once per team.',
          {
            matchId: match.id,
          },
        );
      }
    }

    return assignments;
  }

  private async getLatestManualBalanceMetadata(
    matchId: string,
  ): Promise<MatchResponseDto['manualBalance']> {
    const latestManualSave = await this.prismaService.auditLog.findFirst({
      where: {
        entityType: 'inhouse_matches',
        entityId: matchId,
        action: 'MATCH_MANUAL_BALANCE_SAVED',
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        userId: true,
        createdAt: true,
      },
    });

    if (!latestManualSave?.userId) {
      return null;
    }

    return {
      matchId,
      updatedAt: latestManualSave.createdAt.toISOString(),
      updatedBy: latestManualSave.userId,
    };
  }
}
