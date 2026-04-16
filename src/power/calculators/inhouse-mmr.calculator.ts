import { Injectable } from '@nestjs/common';
import { LaneResult, Position, ResultStatus, TeamSide } from '@prisma/client';

import { POWER_ROLES, RESULT_CONFIDENCE_WEIGHTS, PowerRole } from '../power.constants';

interface ParticipantPowerProfile {
  overallPower: number;
  lanePowerJson: unknown;
}

interface MatchParticipantContext {
  userId: string;
  teamSide: TeamSide | null;
  assignedRole: Position | null;
  user?: {
    powerProfile?: ParticipantPowerProfile | null;
  } | null;
}

interface MatchResultContext {
  winningTeam: TeamSide | null;
  balanceRating: number | null;
  resultStatus: ResultStatus;
  confirmedAt: Date | null;
  mvpUserId?: string | null;
}

interface MatchContext {
  createdAt?: Date;
  players: MatchParticipantContext[];
  result: MatchResultContext | null;
}

export interface InhouseMmrStatInput {
  matchId: string;
  userId: string;
  role: Position;
  teamSide: TeamSide;
  laneResult: LaneResult;
  contributionRating: number | null;
  statStatus: ResultStatus;
  createdAt: Date;
  match: MatchContext;
}

export interface InhouseMmrMatchBreakdown {
  matchId: string;
  role: PowerRole;
  resultStatus: ResultStatus;
  playedAt: string;
  didWin: boolean;
  expectedScore: number;
  actualScore: number;
  delta: number;
  confidenceWeight: number;
  balanceWeight: number;
  laneModifier: number;
  contributionModifier: number;
  mvpModifier: number;
  teamAverageRating: number;
  opponentAverageRating: number;
}

export interface InhouseMmrBreakdown {
  overallMmr: number;
  roleMmr: Record<PowerRole, number>;
  confirmedMatchCount: number;
  roleConfirmedMatchCount: Record<PowerRole, number>;
  formula: string;
  approximationNotes: string[];
  recentMatches: InhouseMmrMatchBreakdown[];
}

interface InhouseMmrInput {
  userId: string;
  seedRoleMmr: Record<PowerRole, number>;
  primaryPosition?: Position | null;
  secondaryPosition?: Position | null;
  stats: InhouseMmrStatInput[];
}

@Injectable()
export class InhouseMmrCalculator {
  calculate(input: InhouseMmrInput): InhouseMmrBreakdown {
    const roleMmr = { ...input.seedRoleMmr };
    const roleConfirmedMatchCount = POWER_ROLES.reduce<Record<PowerRole, number>>((acc, role) => {
      acc[role] = 0;
      return acc;
    }, {} as Record<PowerRole, number>);
    let confirmedMatchCount = 0;

    const recentMatches = [...input.stats]
      .sort((left, right) => this.resolvePlayedAt(left).getTime() - this.resolvePlayedAt(right).getTime())
      .map((stat) => {
        const role = stat.role as PowerRole;
        const resultStatus = stat.match.result?.resultStatus ?? stat.statStatus;
        const confidenceBase = RESULT_CONFIDENCE_WEIGHTS[resultStatus] ?? 0;
        const balanceWeight = this.resolveBalanceWeight(stat.match.result?.balanceRating ?? null);
        const confidenceWeight = this.clamp(confidenceBase * balanceWeight, 0, 1);
        const teamAverageRating = this.resolveTeamAverageRating(
          stat.match.players,
          stat.teamSide,
          input.userId,
          roleMmr[role],
        );
        const opponentTeamSide = stat.teamSide === TeamSide.A ? TeamSide.B : TeamSide.A;
        const opponentAverageRating = this.resolveTeamAverageRating(
          stat.match.players,
          opponentTeamSide,
          input.userId,
          roleMmr[role],
        );
        const expectedScore = this.resolveExpectedScore(teamAverageRating, opponentAverageRating);
        const didWin = stat.match.result?.winningTeam === stat.teamSide;
        const laneModifier = this.resolveLaneModifier(stat.laneResult);
        const contributionModifier = stat.contributionRating
          ? this.clamp((stat.contributionRating - 3) * 0.04, -0.08, 0.08)
          : 0;
        const mvpModifier = stat.match.result?.mvpUserId === stat.userId ? 0.04 : 0;
        const actualScore = this.clamp(
          (didWin ? 1 : 0) + laneModifier + contributionModifier + mvpModifier,
          0,
          1,
        );
        const delta = this.clamp(32 * confidenceWeight * (actualScore - expectedScore), -32, 32);

        roleMmr[role] = this.clamp(roleMmr[role] + delta, 900, 2100);
        if (resultStatus === ResultStatus.CONFIRMED) {
          confirmedMatchCount += 1;
          roleConfirmedMatchCount[role] += 1;
        }

        return {
          matchId: stat.matchId,
          role,
          resultStatus,
          playedAt: this.resolvePlayedAt(stat).toISOString(),
          didWin,
          expectedScore,
          actualScore,
          delta,
          confidenceWeight,
          balanceWeight,
          laneModifier,
          contributionModifier,
          mvpModifier,
          teamAverageRating,
          opponentAverageRating,
        };
      });

    const primaryRole =
      this.normalizeRolePosition(input.primaryPosition) ?? this.resolveHighestRatedRole(roleMmr);
    const secondaryRole =
      this.normalizeRolePosition(input.secondaryPosition) &&
      this.normalizeRolePosition(input.secondaryPosition) !== primaryRole
        ? (this.normalizeRolePosition(input.secondaryPosition) as PowerRole)
        : this.resolveBestSecondaryRole(primaryRole, roleMmr);

    return {
      overallMmr: this.clamp(roleMmr[primaryRole] * 0.75 + roleMmr[secondaryRole] * 0.25, 900, 2100),
      roleMmr,
      confirmedMatchCount,
      roleConfirmedMatchCount,
      formula:
        'delta = 32 * confidenceWeight * (actualScore - expectedScore); role transfer is intentionally disabled',
      approximationNotes: [
        'expectedScore uses current participant role power snapshots because match-time MMR snapshots are not stored yet.',
        'only the played role MMR is updated so off-role inflation is deliberately suppressed.',
      ],
      recentMatches: recentMatches.slice(-10).reverse(),
    };
  }

  private resolvePlayedAt(stat: InhouseMmrStatInput): Date {
    return stat.match.result?.confirmedAt ?? stat.createdAt;
  }

  private resolveTeamAverageRating(
    players: MatchParticipantContext[],
    teamSide: TeamSide,
    currentUserId: string,
    currentUserRoleRating: number,
  ): number {
    const ratings = players
      .filter((player) => player.teamSide === teamSide)
      .map((player) =>
        player.userId === currentUserId ? currentUserRoleRating : this.resolveProxyRating(player),
      );

    if (ratings.length === 0) {
      return 1500;
    }

    return this.clamp(ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length, 900, 2100);
  }

  private resolveProxyRating(player: MatchParticipantContext): number {
    const profile = player.user?.powerProfile;
    const lanePower =
      player.assignedRole && profile?.lanePowerJson
        ? (profile.lanePowerJson as Record<string, number> | null)?.[player.assignedRole]
        : undefined;
    const power = Number(lanePower ?? profile?.overallPower ?? 50);
    return this.powerToRating(power);
  }

  private resolveExpectedScore(teamAverageRating: number, opponentAverageRating: number): number {
    return this.clamp(1 / (1 + 10 ** ((opponentAverageRating - teamAverageRating) / 400)), 0, 1);
  }

  private resolveLaneModifier(laneResult: LaneResult): number {
    switch (laneResult) {
      case LaneResult.WIN:
        return 0.1;
      case LaneResult.LOSE:
        return -0.1;
      case LaneResult.EVEN:
        return 0;
      default:
        return 0;
    }
  }

  private resolveBalanceWeight(balanceRating: number | null): number {
    const safeBalanceRating = Math.min(5, Math.max(1, Number(balanceRating ?? 3)));
    return this.clamp(0.8 + (safeBalanceRating - 1) * 0.05, 0.8, 1);
  }

  private resolveHighestRatedRole(roleMmr: Record<PowerRole, number>): PowerRole {
    return POWER_ROLES.reduce((bestRole, role) =>
      roleMmr[role] > roleMmr[bestRole] ? role : bestRole,
    POWER_ROLES[0]);
  }

  private resolveBestSecondaryRole(
    primaryRole: PowerRole,
    roleMmr: Record<PowerRole, number>,
  ): PowerRole {
    return POWER_ROLES.filter((role) => role !== primaryRole).reduce((bestRole, role) =>
      roleMmr[role] > roleMmr[bestRole] ? role : bestRole,
    POWER_ROLES.find((role) => role !== primaryRole) ?? POWER_ROLES[0]);
  }

  private normalizeRolePosition(position?: Position | null): PowerRole | null {
    return POWER_ROLES.includes(position as PowerRole) ? (position as PowerRole) : null;
  }

  private powerToRating(power: number): number {
    return this.clamp(1000 + power * 10, 900, 2100);
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, Number(value.toFixed(2))));
  }
}
