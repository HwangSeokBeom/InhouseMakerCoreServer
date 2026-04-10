import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ConfirmationAction,
  InputMode,
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
  ConfirmResultDto,
  MatchResultResponseDto,
  QuickResultDto,
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

    return {
      id: result.id,
      winningTeam: result.winningTeam,
      resultStatus: result.resultStatus,
      inputMode: result.inputMode,
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
        createdAt: confirmation.createdAt.toISOString(),
      })),
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

    return status;
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
}
