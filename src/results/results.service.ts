import {
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  ConfirmationAction,
  GroupRole,
  InputMode,
  LaneResult,
  MatchStatus,
  NotificationType,
  ParticipationStatus,
  Position,
  ResultStatus,
  TeamSide,
} from '@prisma/client';

import { AuditLogService } from '../common/audit-log.service';
import { AppErrorCode, AppException } from '../common/app.exception';
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
  private readonly historyWriteLogger = new Logger('HistoryWriteDebug');
  private readonly historyConsistencyLogger = new Logger('HistoryConsistencyDebug');
  private readonly historyVisibleMatchStatuses: MatchStatus[] = [
    MatchStatus.RESULT_PENDING,
    MatchStatus.CONFIRMED,
    MatchStatus.CLOSED,
    MatchStatus.DISPUTED,
  ];
  private readonly joinedParticipationStatuses: ParticipationStatus[] = [
    ParticipationStatus.ACCEPTED,
    ParticipationStatus.LOCKED_IN,
  ];

  constructor(
    private readonly prismaService: PrismaService,
    private readonly matchesService: MatchesService,
    private readonly notificationService: NotificationService,
    private readonly queueService: QueueService,
    private readonly auditLogService: AuditLogService,
    private readonly resultConfirmationPolicyService: ResultConfirmationPolicyService,
  ) {}

  previewQuickResult(dto: QuickResultPreviewDto): QuickResultPreviewResponseDto {
    const balanceFeeling = this.resolveBalanceFeeling(dto);

    if (dto.players.length !== 10) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        AppErrorCode.INVALID_REQUEST,
        'Result preview requires exactly 10 players.',
      );
    }

    const uniqueUserIds = new Set(dto.players.map((player) => player.userId));
    if (uniqueUserIds.size !== dto.players.length) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        AppErrorCode.INVALID_REQUEST,
        'Result preview players must be unique.',
      );
    }

    if (!dto.players.some((player) => player.userId === dto.mvpUserId)) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        AppErrorCode.INVALID_REQUEST,
        'MVP user must be one of the preview players.',
      );
    }

    const teamSummaries = [TeamSide.A, TeamSide.B].map((teamSide) => {
      const players = dto.players.filter((player) => player.teamSide === teamSide);

      if (players.length !== 5) {
        throw new AppException(
          HttpStatus.BAD_REQUEST,
          AppErrorCode.INVALID_REQUEST,
          'Result preview requires exactly 5 players on each team.',
        );
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
      balanceRating: balanceFeeling,
      teams: teamSummaries,
    };
  }

  async submitQuickResult(
    requesterUserId: string,
    matchId: string,
    dto: QuickResultDto,
    idempotencyKey?: string,
  ): Promise<ResultSubmissionResponseDto> {
    this.historyWriteLogger.log(
      `[HistoryWriteDebug] action=result_submit_start matchId=${matchId} requesterUserId=${requesterUserId}`,
    );

    await this.matchesService.assertMatchHostOrCaptain(matchId, requesterUserId, {
      forbiddenCode: AppErrorCode.RESULT_SAVE_FORBIDDEN,
      forbiddenMessage:
        'Only the host, captain, or group admin can save a match result.',
    });
    const match = await this.matchesService.getMatchWithPlayers(matchId);
    const balanceFeeling = this.resolveBalanceFeeling(dto);

    const existingResult = await this.prismaService.inhouseMatchResult.findUnique({
      where: { matchId },
    });

    this.historyWriteLogger.log(
      `[HistoryWriteDebug] action=result_submit_before_state matchId=${matchId} matchStatus=${match.status} resultStatus=${existingResult?.resultStatus ?? match.result?.resultStatus ?? null} playedAt=${this.resolveHistoryPlayedAt(match.scheduledAt, existingResult ?? match.result ?? null)}`,
    );

    if (existingResult?.idempotencyKey && existingResult.idempotencyKey === idempotencyKey) {
      return this.buildSubmissionResponse(existingResult, match.players.length);
    }

    if (existingResult?.resultStatus === ResultStatus.CONFIRMED) {
      throw new AppException(
        HttpStatus.CONFLICT,
        AppErrorCode.RESULT_ALREADY_FINALIZED,
        'This result has already been finalized and cannot be overwritten.',
        {
          matchId,
          resultId: existingResult.id,
        },
      );
    }

    this.assertQuickResultInputReady(match, dto);

    const payloadJson = {
      winningTeam: dto.winningTeam,
      mvpUserId: dto.mvpUserId,
      balanceRating: balanceFeeling,
      balanceFeeling,
      players: dto.players,
    };

    const result = await this.prismaService.$transaction(async (tx) => {
      const savedResult = existingResult
        ? await tx.inhouseMatchResult.update({
            where: { id: existingResult.id },
            data: {
              winningTeam: dto.winningTeam,
              mvpUserId: dto.mvpUserId,
              balanceRating: balanceFeeling,
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
              balanceRating: balanceFeeling,
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
          throw new AppException(
            HttpStatus.BAD_REQUEST,
            AppErrorCode.INVALID_REQUEST,
            'Every result player must have an assigned team and role before saving.',
            {
              matchId,
              userId: player.userId,
            },
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

    this.historyWriteLogger.log(
      `[HistoryWriteDebug] action=result_submit_after_state matchId=${matchId} matchStatus=${MatchStatus.RESULT_PENDING} resultStatus=${result.resultStatus} playedAt=${this.resolveHistoryPlayedAt(match.scheduledAt, result)} affectedParticipants=${dto.players.length}`,
    );
    this.historyWriteLogger.log(
      `[HistoryWriteDebug] action=result_submit_commit_success matchId=${matchId}`,
    );
    this.logHistoryConsistencyForSubmittedResult(
      match,
      MatchStatus.RESULT_PENDING,
      result,
      dto.players.map((player) => player.userId),
    );

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

    return this.buildSubmissionResponse(result, match.players.length);
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
      throw new AppException(
        HttpStatus.FORBIDDEN,
        AppErrorCode.RESULT_CONFIRM_FORBIDDEN,
        'Only match participants can confirm or dispute results.',
        {
          matchId,
          resultId,
        },
      );
    }

    const result = await this.prismaService.inhouseMatchResult.findFirst({
      where: {
        id: resultId,
        matchId,
      },
    });

    if (!result) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        AppErrorCode.RESULT_NOT_FOUND,
        'Match result not found.',
        {
          matchId,
          resultId,
        },
      );
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

    return this.buildSubmissionResponse(
      {
        ...result,
        resultStatus: nextStatus,
        updatedAt: new Date(),
        submittedBy: result.submittedBy,
      },
      match.players.length,
    );
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
      throw new AppException(
        HttpStatus.FORBIDDEN,
        AppErrorCode.RESULT_VIEW_FORBIDDEN,
        'Only participants or group members can view match results.',
        {
          matchId,
        },
      );
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
      throw new AppException(
        HttpStatus.NOT_FOUND,
        AppErrorCode.RESULT_NOT_FOUND,
        'Match result not found.',
        {
          matchId,
        },
      );
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
      throw new AppException(
        HttpStatus.NOT_FOUND,
        AppErrorCode.RESULT_NOT_FOUND,
        'Match result not found.',
        {
          matchId,
          resultId,
        },
      );
    }

    if (result.resultStatus !== ResultStatus.DISPUTED) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        AppErrorCode.RESULT_INVALID_STATE,
        'Only disputed results can be reviewed in dispute detail.',
        {
          matchId,
          resultId,
          resultStatus: result.resultStatus,
        },
      );
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
    const balanceFeeling = this.resolveOptionalBalanceFeeling(dto);

    if (dto.mvpUserId && !match.players.some((player) => player.userId === dto.mvpUserId)) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        AppErrorCode.INVALID_REQUEST,
      'MVP user must be one of the current match players.',
        {
          matchId,
          resultId,
          mvpUserId: dto.mvpUserId,
        },
      );
    }

    const result = await this.prismaService.inhouseMatchResult.findFirst({
      where: {
        id: resultId,
        matchId,
      },
    });

    if (!result) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        AppErrorCode.RESULT_NOT_FOUND,
        'Match result not found.',
        {
          matchId,
          resultId,
        },
      );
    }

    if (result.resultStatus !== ResultStatus.DISPUTED) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        AppErrorCode.RESULT_INVALID_STATE,
        'Only disputed results can be admin resolved.',
        {
          matchId,
          resultId,
          resultStatus: result.resultStatus,
        },
      );
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
      (balanceFeeling !== null && balanceFeeling !== result.balanceRating);
    const resolvedAt = new Date();
    const nextPayload = {
      ...((result.payloadJson as Record<string, unknown> | null) ?? {}),
      winningTeam: dto.winningTeam,
      mvpUserId: dto.mvpUserId ?? result.mvpUserId,
      balanceRating: balanceFeeling ?? result.balanceRating,
      balanceFeeling: balanceFeeling ?? result.balanceRating,
    };

    const updated = await this.prismaService.$transaction(async (tx) => {
      const resolvedResult = await tx.inhouseMatchResult.update({
        where: { id: resultId },
        data: {
          winningTeam: dto.winningTeam,
          mvpUserId: dto.mvpUserId ?? result.mvpUserId,
          balanceRating: balanceFeeling ?? result.balanceRating,
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
      throw new AppException(
        HttpStatus.NOT_FOUND,
        AppErrorCode.RESULT_NOT_FOUND,
        'Match result not found.',
        {
          resultId: matchResultId,
        },
      );
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
      matchId: string;
      winningTeam: TeamSide | null;
      resultStatus: ResultStatus;
      inputMode: InputMode;
      submittedBy: string;
      updatedAt: Date;
      balanceRating: number | null;
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
      teamSide: TeamSide;
      role: Position;
      kills: number;
      deaths: number;
      assists: number;
      laneResult: LaneResult;
      contributionRating: number | null;
    }>,
  ): MatchResultResponseDto {
    return {
      id: result.id,
      matchId: result.matchId,
      winningTeam: result.winningTeam,
      resultStatus: result.resultStatus,
      inputMode: result.inputMode,
      submittedBy: result.submittedBy,
      updatedAt: result.updatedAt.toISOString(),
      balanceRating: result.balanceRating,
      balanceFeeling: result.balanceRating,
      version: result.version,
      confirmedAt: result.confirmedAt?.toISOString() ?? null,
      adminResolvedById: result.adminResolvedById,
      adminResolutionNote: result.adminResolutionNote,
      adminResolvedAt: result.adminResolvedAt?.toISOString() ?? null,
      players: stats.map((stat) => ({
        userId: stat.userId,
        teamSide: stat.teamSide,
        role: stat.role,
        kills: stat.kills,
        deaths: stat.deaths,
        assists: stat.assists,
        laneResult: stat.laneResult,
        contributionRating: stat.contributionRating,
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
    result: {
      id: string;
      matchId: string;
      resultStatus: ResultStatus;
      submittedBy: string;
      updatedAt: Date;
      winningTeam: TeamSide | null;
      mvpUserId: string | null;
      balanceRating: number | null;
    },
    participantCount: number,
  ): ResultSubmissionResponseDto {
    return {
      resultId: result.id,
      matchId: result.matchId,
      status: result.resultStatus,
      confirmationNeeded: Math.max(0, Math.ceil(participantCount * 0.7) - 1),
      updatedBy: result.submittedBy,
      savedAt: result.updatedAt.toISOString(),
      winningTeam: result.winningTeam,
      mvpUserId: result.mvpUserId,
      balanceRating: result.balanceRating,
      balanceFeeling: result.balanceRating,
      isFinalized: result.resultStatus === ResultStatus.CONFIRMED,
    };
  }

  private resolveBalanceFeeling(
    dto: {
      balanceRating?: number | null;
      balanceFeeling?: number | null;
    },
  ): number {
    const value = dto.balanceFeeling ?? dto.balanceRating;

    if (typeof value !== 'number' || value < 1 || value > 5) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        AppErrorCode.INVALID_REQUEST,
        'Balance feeling must be a number between 1 and 5.',
      );
    }

    return value;
  }

  private resolveOptionalBalanceFeeling(
    dto: {
      balanceRating?: number | null;
      balanceFeeling?: number | null;
    },
  ): number | null {
    if (dto.balanceFeeling === undefined && dto.balanceRating === undefined) {
      return null;
    }

    return this.resolveBalanceFeeling(dto);
  }

  private assertQuickResultInputReady(
    match: Awaited<ReturnType<MatchesService['getMatchWithPlayers']>>,
    dto: QuickResultDto,
  ): void {
    if (dto.players.length !== match.players.length) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        AppErrorCode.INVALID_REQUEST,
        'Result input must include all current match players.',
        {
          matchId: match.id,
          field: 'players',
          inputPlayerCount: dto.players.length,
          expectedPlayerCount: match.players.length,
        },
      );
    }

    const inputUserIds = dto.players.map((player) => player.userId);
    const duplicateUserIds = [...new Set(
      inputUserIds.filter((userId, index) => inputUserIds.indexOf(userId) !== index),
    )];
    if (duplicateUserIds.length > 0) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        AppErrorCode.INVALID_REQUEST,
        'Result input contains duplicate players.',
        {
          matchId: match.id,
          field: 'players',
          duplicateUserIds,
        },
      );
    }

    const matchUserIds = new Set(match.players.map((player) => player.userId));
    const inputUserIdSet = new Set(inputUserIds);
    const unknownUserIds = inputUserIds.filter((userId) => !matchUserIds.has(userId));
    const missingUserIds = match.players
      .map((player) => player.userId)
      .filter((userId) => !inputUserIdSet.has(userId));

    if (unknownUserIds.length > 0 || missingUserIds.length > 0) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        AppErrorCode.INVALID_REQUEST,
        'Result input must match the current match players.',
        {
          matchId: match.id,
          field: 'players',
          unknownUserIds,
          missingUserIds,
        },
      );
    }

    if (!matchUserIds.has(dto.mvpUserId)) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        AppErrorCode.INVALID_REQUEST,
        'MVP user must be one of the current match players.',
        {
          matchId: match.id,
          field: 'mvpUserId',
          mvpUserId: dto.mvpUserId,
        },
      );
    }

    const unassignedPlayerIds = match.players
      .filter((player) => !player.teamSide || !player.assignedRole)
      .map((player) => player.userId);

    if (unassignedPlayerIds.length > 0) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        AppErrorCode.INVALID_REQUEST,
        'Every result player must have an assigned team and role before saving.',
        {
          matchId: match.id,
          field: 'players.assignedRole',
          unassignedPlayerIds,
        },
      );
    }

    const incompleteTeams = [TeamSide.A, TeamSide.B]
      .map((teamSide) => {
        const players = match.players.filter((player) => player.teamSide === teamSide);
        const roleSet = new Set(players.map((player) => player.assignedRole));
        const missingRoles = [
          Position.TOP,
          Position.JUNGLE,
          Position.MID,
          Position.ADC,
          Position.SUPPORT,
        ].filter((role) => !roleSet.has(role));

        return {
          teamSide,
          playerCount: players.length,
          missingRoles,
        };
      })
      .filter((team) => team.playerCount !== 5 || team.missingRoles.length > 0);

    if (incompleteTeams.length > 0) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        AppErrorCode.INVALID_REQUEST,
        'Result input requires five lane targets on each team.',
        {
          matchId: match.id,
          field: 'players.laneResult',
          incompleteTeams,
        },
      );
    }
  }

  private logHistoryConsistencyForSubmittedResult(
    match: Awaited<ReturnType<MatchesService['getMatchWithPlayers']>>,
    matchStatus: MatchStatus,
    result: {
      confirmedAt?: Date | null;
      updatedAt?: Date | null;
    },
    statUserIds: string[],
  ): void {
    const statUserIdSet = new Set(statUserIds);
    const playedAt = this.resolveHistoryPlayedAt(match.scheduledAt, result);
    const seededParticipantsIncluded = match.players.some((player) =>
      this.isSeededTestParticipant(player.user?.email ?? null, player.user?.powerProfile?.breakdownJson),
    );

    this.historyConsistencyLogger.log(
      `[HistoryConsistencyDebug] matchId=${match.id} source=live seededParticipantsIncluded=${seededParticipantsIncluded}`,
    );

    for (const player of match.players) {
      const reason = this.resolveHistoryExclusionReason({
        hasStat: statUserIdSet.has(player.userId),
        matchStatus,
        participationStatus: player.participationStatus,
        playedAt,
      });

      this.historyConsistencyLogger.log(
        reason === null
          ? `[HistoryConsistencyDebug] matchId=${match.id} source=live includedInHistory=true userId=${player.userId}`
          : `[HistoryConsistencyDebug] matchId=${match.id} source=live includedInHistory=false reason=${reason} userId=${player.userId}`,
      );
    }
  }

  private isSeededTestParticipant(
    email: string | null,
    breakdownJson: unknown,
  ): boolean {
    const normalizedEmail = email?.trim().toLowerCase() ?? '';
    if (
      normalizedEmail.startsWith('dev_mock_') ||
      normalizedEmail.endsWith('@inhouse.local')
    ) {
      return true;
    }

    const breakdown =
      breakdownJson && typeof breakdownJson === 'object'
        ? (breakdownJson as Record<string, unknown>)
        : null;
    const inhouse =
      breakdown?.inhouse && typeof breakdown.inhouse === 'object'
        ? (breakdown.inhouse as Record<string, unknown>)
        : null;

    return inhouse?.source === 'dev_group_fill';
  }

  private resolveHistoryExclusionReason(params: {
    hasStat: boolean;
    matchStatus: MatchStatus;
    participationStatus: ParticipationStatus;
    playedAt: string | null;
  }): 'match_not_completed' | 'user_participation_not_joined' | 'playedAt_null' | 'missingProjection' | null {
    if (!this.historyVisibleMatchStatuses.includes(params.matchStatus)) {
      return 'match_not_completed';
    }

    if (!params.hasStat && !this.joinedParticipationStatuses.includes(params.participationStatus)) {
      return 'user_participation_not_joined';
    }

    if (params.playedAt === null) {
      return 'playedAt_null';
    }

    if (!params.hasStat) {
      return 'missingProjection';
    }

    return null;
  }

  private resolveHistoryPlayedAt(
    scheduledAt: Date | null,
    result: {
      confirmedAt?: Date | null;
      updatedAt?: Date | null;
    } | null,
  ): string | null {
    return (
      result?.confirmedAt?.toISOString() ??
      result?.updatedAt?.toISOString() ??
      scheduledAt?.toISOString() ??
      null
    );
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

    throw new AppException(
      HttpStatus.FORBIDDEN,
      AppErrorCode.RESULT_RESOLVE_FORBIDDEN,
      'Only admins or group admins can resolve disputed results.',
      {
        groupId,
        userId,
      },
    );
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
