import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ConfirmationAction,
  GroupRole,
  InputMode,
  LaneResult,
  MatchStatus,
  NotificationType,
  ParticipationStatus,
  ResultStatus,
  TeamSide,
} from '@prisma/client';

import { AuditLogService } from '../common/audit-log.service';
import { toPrismaJson } from '../common/prisma-json.util';
import { MatchesService } from '../matches/matches.service';
import { NotificationService } from '../notifications/notification.service';
import { QueueService } from '../queue/queue.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  AdminResolveResultDto,
  AdminResolveResultResponseDto,
  ConfirmResultDto,
  MatchResultResponseDto,
  QuickResultDto,
  QuickResultPreviewDto,
  QuickResultPreviewResponseDto,
  ResultDisputeResponseDto,
  ResultSubmissionResponseDto,
} from './dto/results.dto';
import { ResultConfirmationPolicyService } from './result-confirmation-policy.service';

@Injectable()
export class ResultsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly matchesService: MatchesService,
    private readonly notificationService: NotificationService,
    private readonly queueService: QueueService,
    private readonly auditLogService: AuditLogService,
    private readonly resultConfirmationPolicyService: ResultConfirmationPolicyService,
  ) {}

  previewQuickResult(dto: QuickResultPreviewDto): QuickResultPreviewResponseDto {
    if (dto.players.length !== 10) {
      throw new BadRequestException('Result preview requires exactly 10 players.');
    }

    const uniqueUserIds = new Set(dto.players.map((player) => player.userId));
    if (uniqueUserIds.size !== dto.players.length) {
      throw new BadRequestException('Result preview players must be unique.');
    }

    if (!dto.players.some((player) => player.userId === dto.mvpUserId)) {
      throw new BadRequestException('MVP user must be one of the preview players.');
    }

    const teamSummaries = [TeamSide.A, TeamSide.B].map((teamSide) => {
      const players = dto.players.filter((player) => player.teamSide === teamSide);

      if (players.length !== 5) {
        throw new BadRequestException('Result preview requires exactly 5 players on each team.');
      }

      return {
        teamSide,
        playerCount: players.length,
        kills: players.reduce((sum, player) => sum + player.kills, 0),
        deaths: players.reduce((sum, player) => sum + player.deaths, 0),
        assists: players.reduce((sum, player) => sum + player.assists, 0),
      };
    });

    return {
      validated: true,
      playerCount: dto.players.length,
      mvpUserId: dto.mvpUserId,
      winningTeam: dto.winningTeam,
      balanceRating: dto.balanceRating,
      teams: teamSummaries,
    };
  }

  async submitQuickResult(
    requesterUserId: string,
    matchId: string,
    dto: QuickResultDto,
    idempotencyKey?: string,
  ): Promise<ResultSubmissionResponseDto> {
    await this.matchesService.assertMatchHostOrCaptain(matchId, requesterUserId);
    const match = await this.matchesService.getMatchWithPlayers(matchId);

    if (dto.players.length !== match.players.length) {
      throw new BadRequestException('Result input must include all current match players.');
    }

    const existingResult = await this.prismaService.inhouseMatchResult.findUnique({
      where: { matchId },
    });

    if (existingResult?.idempotencyKey && existingResult.idempotencyKey === idempotencyKey) {
      return this.buildSubmissionResponse(existingResult.id, existingResult.resultStatus, match.players.length);
    }

    const payloadJson = {
      winningTeam: dto.winningTeam,
      mvpUserId: dto.mvpUserId,
      balanceRating: dto.balanceRating,
      players: dto.players,
    };

    const result = await this.prismaService.$transaction(async (tx) => {
      const savedResult = existingResult
        ? await tx.inhouseMatchResult.update({
            where: { id: existingResult.id },
            data: {
              winningTeam: dto.winningTeam,
              mvpUserId: dto.mvpUserId,
              balanceRating: dto.balanceRating,
              inputMode: InputMode.QUICK,
              submittedBy: requesterUserId,
              resultStatus: ResultStatus.PARTIAL,
              payloadJson: toPrismaJson(payloadJson),
              idempotencyKey,
              version: { increment: 1 },
            },
          })
        : await tx.inhouseMatchResult.create({
            data: {
              matchId,
              winningTeam: dto.winningTeam,
              mvpUserId: dto.mvpUserId,
              balanceRating: dto.balanceRating,
              inputMode: InputMode.QUICK,
              submittedBy: requesterUserId,
              resultStatus: ResultStatus.PARTIAL,
              payloadJson: toPrismaJson(payloadJson),
              idempotencyKey,
            },
          });

      for (const player of dto.players) {
        const matchPlayer = match.players.find((item) => item.userId === player.userId);

        if (!matchPlayer?.teamSide || !matchPlayer.assignedRole) {
          throw new BadRequestException(
            `Player ${player.userId} must have an assigned team and role before submitting results.`,
          );
        }

        await tx.inhousePlayerStat.upsert({
          where: {
            matchId_userId: {
              matchId,
              userId: player.userId,
            },
          },
          update: {
            teamSide: matchPlayer.teamSide,
            role: matchPlayer.assignedRole,
            kills: player.kills,
            deaths: player.deaths,
            assists: player.assists,
            laneResult: player.laneResult,
            contributionRating: player.contributionRating,
            statStatus: ResultStatus.PARTIAL,
          },
          create: {
            matchId,
            userId: player.userId,
            teamSide: matchPlayer.teamSide,
            role: matchPlayer.assignedRole,
            kills: player.kills,
            deaths: player.deaths,
            assists: player.assists,
            laneResult: player.laneResult,
            contributionRating: player.contributionRating,
            statStatus: ResultStatus.PARTIAL,
          },
        });
      }

      await tx.inhouseMatch.update({
        where: { id: matchId },
        data: {
          status: MatchStatus.RESULT_PENDING,
        },
      });

      return savedResult;
    });

    await this.auditLogService.create({
      userId: requesterUserId,
      action: 'RESULT_SUBMITTED',
      entityType: 'inhouse_match_results',
      entityId: result.id,
      after: payloadJson,
      meta: { matchId, inputMode: InputMode.QUICK },
    });

    await this.notificationService.createMany(
      match.players
        .filter((player) => player.userId !== requesterUserId)
        .map((player) => ({
          userId: player.userId,
          type: NotificationType.RESULT_CONFIRMATION_REQUEST,
          title: '결과 확인 요청',
          body: `${match.title ?? '내전 경기'} 결과를 확인해주세요.`,
          payload: { matchId, resultId: result.id },
          relatedEntityType: 'match_result',
          relatedEntityId: result.id,
        })),
    );

    await Promise.all(
      match.players.map((player) =>
        this.queueService.enqueuePowerRecalculation(player.userId, `result-partial:${matchId}`),
      ),
    );

    return this.buildSubmissionResponse(result.id, ResultStatus.PARTIAL, match.players.length);
  }

  async confirmResult(
    requesterUserId: string,
    matchId: string,
    resultId: string,
    dto: ConfirmResultDto,
  ): Promise<ResultSubmissionResponseDto> {
    const match = await this.matchesService.getMatchWithPlayers(matchId);
    const isParticipant = match.players.some((player) => player.userId === requesterUserId);

    if (!isParticipant) {
      throw new ForbiddenException('Only match participants can confirm or dispute results.');
    }

    const result = await this.prismaService.inhouseMatchResult.findFirst({
      where: {
        id: resultId,
        matchId,
      },
    });

    if (!result) {
      throw new NotFoundException('Match result not found.');
    }

    await this.prismaService.matchResultConfirmation.create({
      data: {
        matchResultId: result.id,
        matchId,
        userId: requesterUserId,
        resultVersion: result.version,
        action: dto.action,
        diffJson: dto.diff === undefined ? undefined : toPrismaJson(dto.diff),
        proposedWinningTeam: this.extractProposedWinningTeam(dto.diff),
        comment: dto.comment,
      },
    });

    await this.auditLogService.create({
      userId: requesterUserId,
      action: 'RESULT_CONFIRMATION_UPDATED',
      entityType: 'match_result_confirmations',
      entityId: result.id,
      after: dto,
      meta: { matchId, resultId },
    });

    const nextStatus = await this.finalizeResultStatus(result.id, true);

    return this.buildSubmissionResponse(result.id, nextStatus, match.players.length);
  }

  async getMatchResult(
    requesterUserId: string,
    matchId: string,
  ): Promise<MatchResultResponseDto> {
    const match = await this.matchesService.getMatchWithPlayers(matchId);
    const isParticipant = match.players.some((player) => player.userId === requesterUserId);
    const isGroupMember = await this.prismaService.groupMember.findUnique({
      where: {
        groupId_userId: {
          groupId: match.groupId,
          userId: requesterUserId,
        },
      },
    });

    if (!isParticipant && !isGroupMember) {
      throw new ForbiddenException('Only participants or group members can view match results.');
    }

    const result = await this.prismaService.inhouseMatchResult.findUnique({
      where: { matchId },
      include: {
        confirmations: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!result) {
      throw new NotFoundException('Match result not found.');
    }

    const stats = await this.prismaService.inhousePlayerStat.findMany({
      where: { matchId },
      orderBy: { createdAt: 'asc' },
    });

    return this.buildMatchResultResponse(result, stats);
  }

  async getDisputeDetail(
    requesterUserId: string,
    matchId: string,
    resultId: string,
  ): Promise<ResultDisputeResponseDto> {
    const match = await this.matchesService.getMatchWithPlayers(matchId);
    await this.assertResultResolutionAuthority(requesterUserId, match.groupId);

    const result = await this.prismaService.inhouseMatchResult.findFirst({
      where: {
        id: resultId,
        matchId,
      },
      include: {
        confirmations: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!result) {
      throw new NotFoundException('Match result not found.');
    }

    if (result.resultStatus !== ResultStatus.DISPUTED) {
      throw new BadRequestException('Only disputed results can be reviewed in dispute detail.');
    }

    const stats = await this.prismaService.inhousePlayerStat.findMany({
      where: { matchId },
      orderBy: { createdAt: 'asc' },
    });
    const currentVersionConfirmations = result.confirmations.filter(
      (confirmation) => confirmation.resultVersion === result.version,
    );
    const participants = match.players.filter(
      (player) =>
        player.participationStatus === ParticipationStatus.ACCEPTED ||
        player.participationStatus === ParticipationStatus.LOCKED_IN,
    );

    return {
      matchId,
      submittedBy: result.submittedBy,
      ...this.buildMatchResultResponse(result, stats),
      disputeSummary: this.buildDisputeSummary(
        result.winningTeam,
        participants.length,
        currentVersionConfirmations,
      ),
    };
  }

  async adminResolveDispute(
    requesterUserId: string,
    matchId: string,
    resultId: string,
    dto: AdminResolveResultDto,
  ): Promise<AdminResolveResultResponseDto> {
    const match = await this.matchesService.getMatchWithPlayers(matchId);
    await this.assertResultResolutionAuthority(requesterUserId, match.groupId);

    if (dto.mvpUserId && !match.players.some((player) => player.userId === dto.mvpUserId)) {
      throw new BadRequestException('MVP user must be one of the current match players.');
    }

    const result = await this.prismaService.inhouseMatchResult.findFirst({
      where: {
        id: resultId,
        matchId,
      },
    });

    if (!result) {
      throw new NotFoundException('Match result not found.');
    }

    if (result.resultStatus !== ResultStatus.DISPUTED) {
      throw new BadRequestException('Only disputed results can be admin resolved.');
    }

    const before = {
      winningTeam: result.winningTeam,
      mvpUserId: result.mvpUserId,
      balanceRating: result.balanceRating,
      resultStatus: result.resultStatus,
      version: result.version,
      adminResolutionNote: result.adminResolutionNote,
    };
    const factualChange =
      result.winningTeam !== dto.winningTeam ||
      (dto.mvpUserId !== undefined && dto.mvpUserId !== result.mvpUserId) ||
      (dto.balanceRating !== undefined && dto.balanceRating !== result.balanceRating);
    const resolvedAt = new Date();
    const nextPayload = {
      ...((result.payloadJson as Record<string, unknown> | null) ?? {}),
      winningTeam: dto.winningTeam,
      mvpUserId: dto.mvpUserId ?? result.mvpUserId,
      balanceRating: dto.balanceRating ?? result.balanceRating,
    };

    const updated = await this.prismaService.$transaction(async (tx) => {
      const resolvedResult = await tx.inhouseMatchResult.update({
        where: { id: resultId },
        data: {
          winningTeam: dto.winningTeam,
          mvpUserId: dto.mvpUserId ?? result.mvpUserId,
          balanceRating: dto.balanceRating ?? result.balanceRating,
          payloadJson: toPrismaJson(nextPayload),
          resultStatus: ResultStatus.CONFIRMED,
          confirmedAt: resolvedAt,
          adminResolvedById: requesterUserId,
          adminResolutionNote: dto.note,
          adminResolvedAt: resolvedAt,
          ...(factualChange ? { version: { increment: 1 } } : {}),
        },
      });

      await tx.inhousePlayerStat.updateMany({
        where: { matchId },
        data: {
          statStatus: ResultStatus.CONFIRMED,
        },
      });

      await tx.inhouseMatch.update({
        where: { id: matchId },
        data: {
          status: MatchStatus.CONFIRMED,
        },
      });

      return resolvedResult;
    });

    await this.auditLogService.create({
      userId: requesterUserId,
      action: 'RESULT_ADMIN_RESOLVED',
      entityType: 'inhouse_match_results',
      entityId: resultId,
      before,
      after: {
        winningTeam: updated.winningTeam,
        mvpUserId: updated.mvpUserId,
        balanceRating: updated.balanceRating,
        resultStatus: updated.resultStatus,
        version: updated.version,
        adminResolutionNote: updated.adminResolutionNote,
        adminResolvedAt: updated.adminResolvedAt?.toISOString() ?? null,
      },
      meta: {
        matchId,
        factualChange,
      },
    });

    const participantUserIds = match.players
      .filter(
        (player) =>
          player.participationStatus === ParticipationStatus.ACCEPTED ||
          player.participationStatus === ParticipationStatus.LOCKED_IN,
      )
      .map((player) => player.userId);
    await Promise.all(
      participantUserIds.map((userId) =>
        this.queueService.enqueuePowerRecalculation(userId, `admin-resolved:${matchId}`),
      ),
    );

    await this.notificationService.createMany(
      participantUserIds
        .filter((userId) => userId !== requesterUserId)
        .map((userId) => ({
          userId,
          type: NotificationType.RESULT_ADMIN_RESOLVED,
          title: '내전 결과가 운영자에 의해 확정되었습니다',
          body: dto.note,
          payload: {
            matchId,
            resultId,
            winningTeam: updated.winningTeam,
            version: updated.version,
          },
          relatedEntityType: 'match_result',
          relatedEntityId: resultId,
        })),
    );

    return {
      resultId,
      status: updated.resultStatus,
      version: updated.version,
      adminResolvedAt: updated.adminResolvedAt?.toISOString() ?? null,
    };
  }

  async finalizeResultStatus(
    matchResultId: string,
    enqueueFollowup = false,
  ): Promise<ResultStatus> {
    const result = await this.prismaService.inhouseMatchResult.findUnique({
      where: { id: matchResultId },
      include: {
        match: {
          include: {
            players: true,
          },
        },
        confirmations: true,
      },
    });

    if (!result) {
      throw new NotFoundException('Match result not found.');
    }

    const participants = result.match.players.filter(
      (player) =>
        player.participationStatus === ParticipationStatus.ACCEPTED ||
        player.participationStatus === ParticipationStatus.LOCKED_IN,
    );
    const captainUserIds = result.match.players
      .filter((player) => player.isCaptain)
      .map((player) => player.userId);

    const status = this.resultConfirmationPolicyService.evaluate({
      participantCount: participants.length,
      captainUserIds,
      winningTeam: result.winningTeam,
      confirmations: result.confirmations.filter(
        (confirmation) => confirmation.resultVersion === result.version,
      ),
    });

    const previousStatus = result.resultStatus;

    await this.prismaService.$transaction(async (tx) => {
      await tx.inhouseMatchResult.update({
        where: { id: matchResultId },
        data: {
          resultStatus: status,
          confirmedAt: status === ResultStatus.CONFIRMED ? new Date() : null,
        },
      });

      await tx.inhousePlayerStat.updateMany({
        where: { matchId: result.matchId },
        data: {
          statStatus: status,
        },
      });

      await tx.inhouseMatch.update({
        where: { id: result.matchId },
        data: {
          status:
            status === ResultStatus.CONFIRMED
              ? MatchStatus.CONFIRMED
              : status === ResultStatus.DISPUTED
                ? MatchStatus.DISPUTED
                : MatchStatus.RESULT_PENDING,
        },
      });
    });

    if (enqueueFollowup) {
      await this.queueService.enqueueFinalizeResultConfirmation(matchResultId);
    }

    if (status !== previousStatus) {
      await this.auditLogService.create({
        action: 'RESULT_STATUS_TRANSITIONED',
        entityType: 'inhouse_match_results',
        entityId: matchResultId,
        before: { resultStatus: previousStatus },
        after: { resultStatus: status },
        meta: { matchId: result.matchId, resultVersion: result.version },
      });
    }

    if (status === ResultStatus.CONFIRMED && previousStatus !== ResultStatus.CONFIRMED) {
      for (const participant of participants) {
        await this.queueService.enqueuePowerRecalculation(
          participant.userId,
          `result-confirmed:${result.matchId}`,
        );
      }

      await this.notificationService.createMany(
        participants.map((participant) => ({
          userId: participant.userId,
          type: NotificationType.RESULT_CONFIRMED,
          title: '결과가 확정되었습니다',
          body: '내전 결과가 확정되어 파워 프로필에 반영됩니다.',
          payload: { matchId: result.matchId, resultId: matchResultId },
          relatedEntityType: 'match_result',
          relatedEntityId: matchResultId,
        })),
      );
    }

    if (status === ResultStatus.DISPUTED && previousStatus !== ResultStatus.DISPUTED) {
      for (const participant of participants) {
        await this.queueService.enqueuePowerRecalculation(
          participant.userId,
          `result-disputed:${result.matchId}`,
        );
      }

      const adminRecipientUserIds = await this.getResultAdminRecipientUserIds(result.match.groupId);

      await this.notificationService.createMany(
        adminRecipientUserIds.map((userId) => ({
          userId,
          type: NotificationType.RESULT_DISPUTED,
          title: '분쟁 중인 결과 확인이 필요합니다',
          body: '내전 결과가 분쟁 상태로 전환되어 운영자 확인이 필요합니다.',
          payload: { matchId: result.matchId, resultId: matchResultId },
          relatedEntityType: 'match_result',
          relatedEntityId: matchResultId,
        })),
      );
    }

    return status;
  }

  private buildMatchResultResponse(
    result: {
      id: string;
      winningTeam: TeamSide | null;
      resultStatus: ResultStatus;
      inputMode: InputMode;
      version: number;
      confirmedAt: Date | null;
      adminResolvedById: string | null;
      adminResolutionNote: string | null;
      adminResolvedAt: Date | null;
      confirmations: Array<{
        userId: string;
        action: ConfirmationAction;
        diffJson: unknown;
        comment: string | null;
        proposedWinningTeam: TeamSide | null;
        createdAt: Date;
      }>;
    },
    stats: Array<{
      userId: string;
      kills: number;
      deaths: number;
      assists: number;
      laneResult: LaneResult;
    }>,
  ): MatchResultResponseDto {
    return {
      id: result.id,
      winningTeam: result.winningTeam,
      resultStatus: result.resultStatus,
      inputMode: result.inputMode,
      version: result.version,
      confirmedAt: result.confirmedAt?.toISOString() ?? null,
      adminResolvedById: result.adminResolvedById,
      adminResolutionNote: result.adminResolutionNote,
      adminResolvedAt: result.adminResolvedAt?.toISOString() ?? null,
      players: stats.map((stat) => ({
        userId: stat.userId,
        kills: stat.kills,
        deaths: stat.deaths,
        assists: stat.assists,
        laneResult: stat.laneResult,
      })),
      confirmations: result.confirmations.map((confirmation) => ({
        userId: confirmation.userId,
        action: confirmation.action,
        diff: (confirmation.diffJson as Record<string, unknown> | null) ?? null,
        comment: confirmation.comment,
        proposedWinningTeam: confirmation.proposedWinningTeam,
        createdAt: confirmation.createdAt.toISOString(),
      })),
    };
  }

  private buildSubmissionResponse(
    resultId: string,
    status: ResultStatus,
    participantCount: number,
  ): ResultSubmissionResponseDto {
    return {
      resultId,
      status,
      confirmationNeeded: Math.max(0, Math.ceil(participantCount * 0.7) - 1),
    };
  }

  private extractProposedWinningTeam(
    diff?: Record<string, unknown>,
  ): TeamSide | null {
    const winningTeam = diff?.winningTeam;
    return winningTeam === TeamSide.A || winningTeam === TeamSide.B ? winningTeam : null;
  }

  private buildDisputeSummary(
    winningTeam: TeamSide | null,
    participantCount: number,
    confirmations: Array<{
      userId: string;
      action: ConfirmationAction;
      proposedWinningTeam: TeamSide | null;
      createdAt: Date;
    }>,
  ): ResultDisputeResponseDto['disputeSummary'] {
    const latestByUser = new Map<string, (typeof confirmations)[number]>();

    for (const confirmation of [...confirmations].sort(
      (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
    )) {
      if (!latestByUser.has(confirmation.userId)) {
        latestByUser.set(confirmation.userId, confirmation);
      }
    }

    const latest = [...latestByUser.values()];

    return {
      participantCount,
      confirmCount: latest.filter((confirmation) => confirmation.action === ConfirmationAction.CONFIRM).length,
      conflictingCount: latest.filter((confirmation) => confirmation.action !== ConfirmationAction.CONFIRM).length,
      winningTeamConflict: latest.some(
        (confirmation) =>
          confirmation.proposedWinningTeam !== null &&
          winningTeam !== null &&
          confirmation.proposedWinningTeam !== winningTeam,
      ),
    };
  }

  private async assertResultResolutionAuthority(
    userId: string,
    groupId: string,
  ): Promise<void> {
    const [user, membership] = await Promise.all([
      this.prismaService.user.findUnique({
        where: { id: userId },
        select: { isAdmin: true },
      }),
      this.prismaService.groupMember.findUnique({
        where: {
          groupId_userId: {
            groupId,
            userId,
          },
        },
      }),
    ]);

    if (user?.isAdmin) {
      return;
    }

    if (membership && (membership.role === GroupRole.OWNER || membership.role === GroupRole.ADMIN)) {
      return;
    }

    throw new ForbiddenException('Only admins or group admins can resolve disputed results.');
  }

  private async getResultAdminRecipientUserIds(groupId: string): Promise<string[]> {
    const [admins, groupAdmins] = await Promise.all([
      this.prismaService.user.findMany({
        where: {
          isAdmin: true,
        },
        select: {
          id: true,
        },
      }),
      this.prismaService.groupMember.findMany({
        where: {
          groupId,
          role: {
            in: [GroupRole.OWNER, GroupRole.ADMIN],
          },
        },
        select: {
          userId: true,
        },
      }),
    ]);

    return [...new Set([...admins.map((admin) => admin.id), ...groupAdmins.map((member) => member.userId)])];
  }
}
