import { ConfirmationAction, ResultStatus, TeamSide } from '@prisma/client';

import { ResultConfirmationPolicyService } from '../src/results/result-confirmation-policy.service';

describe('ResultConfirmationPolicyService', () => {
  it('marks a result as confirmed when at least 70 percent of participants confirm', () => {
    const service = new ResultConfirmationPolicyService();

    const status = service.evaluate({
      participantCount: 10,
      captainUserIds: ['u1', 'u6'],
      winningTeam: TeamSide.A,
      confirmations: [
        { userId: 'u1', action: ConfirmationAction.CONFIRM, proposedWinningTeam: null, createdAt: new Date('2026-04-10T10:00:00Z') },
        { userId: 'u2', action: ConfirmationAction.CONFIRM, proposedWinningTeam: null, createdAt: new Date('2026-04-10T10:01:00Z') },
        { userId: 'u3', action: ConfirmationAction.CONFIRM, proposedWinningTeam: null, createdAt: new Date('2026-04-10T10:02:00Z') },
        { userId: 'u4', action: ConfirmationAction.CONFIRM, proposedWinningTeam: null, createdAt: new Date('2026-04-10T10:03:00Z') },
        { userId: 'u5', action: ConfirmationAction.CONFIRM, proposedWinningTeam: null, createdAt: new Date('2026-04-10T10:04:00Z') },
        { userId: 'u6', action: ConfirmationAction.CONFIRM, proposedWinningTeam: null, createdAt: new Date('2026-04-10T10:05:00Z') },
        { userId: 'u7', action: ConfirmationAction.CONFIRM, proposedWinningTeam: null, createdAt: new Date('2026-04-10T10:06:00Z') },
      ],
    });

    expect(status).toBe(ResultStatus.CONFIRMED);
  });

  it('marks a result as disputed when conflicting winning team suggestions accumulate', () => {
    const service = new ResultConfirmationPolicyService();

    const status = service.evaluate({
      participantCount: 10,
      captainUserIds: ['u1', 'u6'],
      winningTeam: TeamSide.A,
      confirmations: [
        {
          userId: 'u2',
          action: ConfirmationAction.SUGGEST_CHANGE,
          proposedWinningTeam: TeamSide.B,
          createdAt: new Date('2026-04-10T10:00:00Z'),
        },
        {
          userId: 'u3',
          action: ConfirmationAction.DISPUTE,
          proposedWinningTeam: TeamSide.B,
          createdAt: new Date('2026-04-10T10:01:00Z'),
        },
      ],
    });

    expect(status).toBe(ResultStatus.DISPUTED);
  });
});
