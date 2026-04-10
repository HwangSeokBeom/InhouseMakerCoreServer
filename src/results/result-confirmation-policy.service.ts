import { Injectable } from '@nestjs/common';
import { ConfirmationAction, ResultStatus, TeamSide } from '@prisma/client';

@Injectable()
export class ResultConfirmationPolicyService {
  evaluate(params: {
    participantCount: number;
    captainUserIds: string[];
    winningTeam: TeamSide | null;
    confirmations: Array<{
      userId: string;
      action: ConfirmationAction;
      proposedWinningTeam: TeamSide | null;
      createdAt: Date;
    }>;
  }): ResultStatus {
    const latestByUser = new Map<
      string,
      {
        userId: string;
        action: ConfirmationAction;
        proposedWinningTeam: TeamSide | null;
        createdAt: Date;
      }
    >();

    const sorted = [...params.confirmations].sort(
      (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
    );
    for (const confirmation of sorted) {
      if (!latestByUser.has(confirmation.userId)) {
        latestByUser.set(confirmation.userId, confirmation);
      }
    }

    const latest = [...latestByUser.values()];
    const confirmCount = latest.filter(
      (confirmation) => confirmation.action === ConfirmationAction.CONFIRM,
    ).length;
    const conflictingActions = latest.filter(
      (confirmation) => confirmation.action !== ConfirmationAction.CONFIRM,
    );
    const winningTeamConflict = latest.some(
      (confirmation) =>
        confirmation.proposedWinningTeam &&
        params.winningTeam &&
        confirmation.proposedWinningTeam !== params.winningTeam,
    );
    const captainsConfirmed =
      params.captainUserIds.length >= 2 &&
      params.captainUserIds.every((captainUserId) =>
        latest.some(
          (confirmation) =>
            confirmation.userId === captainUserId &&
            confirmation.action === ConfirmationAction.CONFIRM,
        ),
      );

    if (conflictingActions.length >= 2 || winningTeamConflict) {
      return ResultStatus.DISPUTED;
    }

    if (
      captainsConfirmed ||
      (params.participantCount > 0 && confirmCount / params.participantCount >= 0.7)
    ) {
      return ResultStatus.CONFIRMED;
    }

    return ResultStatus.PARTIAL;
  }
}

