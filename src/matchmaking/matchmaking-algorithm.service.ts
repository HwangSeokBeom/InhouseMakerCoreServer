import { Injectable } from '@nestjs/common';
import { BalanceMode, Position, TeamSide } from '@prisma/client';

export interface AlgorithmPlayer {
  userId: string;
  nickname: string;
  primaryPosition?: Position | null;
  secondaryPosition?: Position | null;
  isFillAvailable: boolean;
  overallPower: number;
  lanePower: Record<string, number>;
  sameTeamPreferenceUserIds: string[];
  avoidTeamPreferenceUserIds: string[];
  lockedTeamSide?: TeamSide | null;
  lockedRole?: Position | null;
}

export interface MatchmakingCandidate {
  candidateId: string;
  candidateNo: number;
  type: BalanceMode;
  score: number;
  metrics: {
    teamPowerGap: number;
    laneMatchupGap: number;
    offRolePenalty: number;
    repeatTeamPenalty: number;
    preferenceViolationPenalty: number;
    volatilityClusterPenalty: number;
  };
  teamAPower: number;
  teamBPower: number;
  offRoleCount: number;
  explanationTags: string[];
  teamA: Array<{
    userId: string;
    nickname: string;
    teamSide: TeamSide;
    assignedRole: Position;
    rolePower: number;
  }>;
  teamB: Array<{
    userId: string;
    nickname: string;
    teamSide: TeamSide;
    assignedRole: Position;
    rolePower: number;
  }>;
}

const ROLE_ORDER = [
  Position.TOP,
  Position.JUNGLE,
  Position.MID,
  Position.ADC,
  Position.SUPPORT,
] as const;

@Injectable()
export class MatchmakingAlgorithmService {
  generateCandidates(
    players: AlgorithmPlayer[],
    excludedCandidateIds: string[] = [],
  ): MatchmakingCandidate[] {
    if (players.length !== 10) {
      return [];
    }

    const splitCandidates: Array<{
      teamAPlayers: AlgorithmPlayer[];
      teamBPlayers: AlgorithmPlayer[];
      teamAAssignments: MatchmakingCandidate['teamA'];
      teamBAssignments: MatchmakingCandidate['teamB'];
      metrics: MatchmakingCandidate['metrics'];
      teamAPower: number;
      teamBPower: number;
      offRoleCount: number;
    }> = [];

    const combinations = this.buildCombinations(players.length, 5).filter((indices) =>
      indices.includes(0),
    );

    for (const teamAIndices of combinations) {
      const teamAPlayers = teamAIndices.map((index) => players[index]);
      const teamBPlayers = players.filter((_, index) => !teamAIndices.includes(index));

      if (!this.respectsLockedTeams(teamAPlayers, teamBPlayers)) {
        continue;
      }

      const teamAAssignment = this.findBestRoleAssignment(teamAPlayers, TeamSide.A);
      const teamBAssignment = this.findBestRoleAssignment(teamBPlayers, TeamSide.B);

      if (!teamAAssignment || !teamBAssignment) {
        continue;
      }

      const metrics = this.calculateMetrics(
        teamAPlayers,
        teamBPlayers,
        teamAAssignment.assignments,
        teamBAssignment.assignments,
      );
      splitCandidates.push({
        teamAPlayers,
        teamBPlayers,
        teamAAssignments: teamAAssignment.assignments,
        teamBAssignments: teamBAssignment.assignments,
        metrics,
        teamAPower: this.sumRolePower(teamAAssignment.assignments),
        teamBPower: this.sumRolePower(teamBAssignment.assignments),
        offRoleCount:
          teamAAssignment.offRoleCount + teamBAssignment.offRoleCount,
      });
    }

    const uniqueModes = [
      BalanceMode.BALANCED,
      BalanceMode.POSITION_FIRST,
      BalanceMode.SKILL_FIRST,
    ];

    return uniqueModes
      .map((mode, index) => {
        const ranked = splitCandidates
          .map((candidate) => {
            const score = this.scoreCandidate(candidate.metrics, mode);
            const candidateId = this.buildCandidateId(candidate.teamAAssignments, mode);
            return {
              candidateId,
              candidateNo: index + 1,
              type: mode,
              score,
              metrics: candidate.metrics,
              teamAPower: Number(candidate.teamAPower.toFixed(2)),
              teamBPower: Number(candidate.teamBPower.toFixed(2)),
              offRoleCount: candidate.offRoleCount,
              explanationTags: this.buildExplanationTags(candidate.metrics, candidate.offRoleCount),
              teamA: candidate.teamAAssignments,
              teamB: candidate.teamBAssignments,
            };
          })
          .filter((candidate) => !excludedCandidateIds.includes(candidate.candidateId))
          .sort((a, b) => a.score - b.score);

        return ranked[0];
      })
      .filter((candidate): candidate is MatchmakingCandidate => Boolean(candidate));
  }

  scoreCandidate(
    metrics: MatchmakingCandidate['metrics'],
    mode: BalanceMode,
  ): number {
    const weights =
      mode === BalanceMode.POSITION_FIRST
        ? {
            teamPowerGap: 0.2,
            laneMatchupGap: 0.15,
            offRolePenalty: 0.35,
            repeatTeamPenalty: 0.1,
            preferenceViolationPenalty: 0.1,
            volatilityClusterPenalty: 0.1,
          }
        : mode === BalanceMode.SKILL_FIRST
          ? {
              teamPowerGap: 0.45,
              laneMatchupGap: 0.3,
              offRolePenalty: 0.08,
              repeatTeamPenalty: 0.07,
              preferenceViolationPenalty: 0.05,
              volatilityClusterPenalty: 0.05,
            }
          : {
              teamPowerGap: 0.35,
              laneMatchupGap: 0.25,
              offRolePenalty: 0.15,
              repeatTeamPenalty: 0.1,
              preferenceViolationPenalty: 0.08,
              volatilityClusterPenalty: 0.07,
            };

    return Number(
      (
        metrics.teamPowerGap * weights.teamPowerGap +
        metrics.laneMatchupGap * weights.laneMatchupGap +
        metrics.offRolePenalty * weights.offRolePenalty +
        metrics.repeatTeamPenalty * weights.repeatTeamPenalty +
        metrics.preferenceViolationPenalty * weights.preferenceViolationPenalty +
        metrics.volatilityClusterPenalty * weights.volatilityClusterPenalty
      ).toFixed(4),
    );
  }

  private buildCombinations(size: number, choose: number): number[][] {
    const result: number[][] = [];
    const current: number[] = [];

    const backtrack = (start: number): void => {
      if (current.length === choose) {
        result.push([...current]);
        return;
      }

      for (let index = start; index < size; index += 1) {
        current.push(index);
        backtrack(index + 1);
        current.pop();
      }
    };

    backtrack(0);
    return result;
  }

  private respectsLockedTeams(
    teamAPlayers: AlgorithmPlayer[],
    teamBPlayers: AlgorithmPlayer[],
  ): boolean {
    return (
      teamAPlayers.every((player) => !player.lockedTeamSide || player.lockedTeamSide === TeamSide.A) &&
      teamBPlayers.every((player) => !player.lockedTeamSide || player.lockedTeamSide === TeamSide.B)
    );
  }

  private findBestRoleAssignment(players: AlgorithmPlayer[], teamSide: TeamSide) {
    let bestCost = Number.POSITIVE_INFINITY;
    let bestAssignments: MatchmakingCandidate['teamA'] = [];
    let bestOffRoleCount = 0;

    const used = new Set<number>();
    const currentAssignments: MatchmakingCandidate['teamA'] = [];

    const backtrack = (roleIndex: number, totalCost: number, offRoleCount: number): void => {
      if (roleIndex === ROLE_ORDER.length) {
        if (totalCost < bestCost) {
          bestCost = totalCost;
          bestAssignments = [...currentAssignments];
          bestOffRoleCount = offRoleCount;
        }
        return;
      }

      if (totalCost >= bestCost) {
        return;
      }

      const role = ROLE_ORDER[roleIndex];
      for (let index = 0; index < players.length; index += 1) {
        if (used.has(index)) {
          continue;
        }

        const player = players[index];
        const cost = this.getRoleCost(player, role);

        if (!Number.isFinite(cost)) {
          continue;
        }

        used.add(index);
        currentAssignments.push({
          userId: player.userId,
          nickname: player.nickname,
          teamSide,
          assignedRole: role,
          rolePower: Number(player.lanePower[role] ?? player.overallPower),
        });
        backtrack(roleIndex + 1, totalCost + cost, offRoleCount + (cost >= 12 ? 1 : 0));
        currentAssignments.pop();
        used.delete(index);
      }
    };

    backtrack(0, 0, 0);

    if (!Number.isFinite(bestCost) || bestAssignments.length !== ROLE_ORDER.length) {
      return null;
    }

      return {
        assignments: bestAssignments.sort(
          (left, right) =>
            ROLE_ORDER.indexOf(left.assignedRole as (typeof ROLE_ORDER)[number]) -
            ROLE_ORDER.indexOf(right.assignedRole as (typeof ROLE_ORDER)[number]),
        ),
        cost: bestCost,
        offRoleCount: bestOffRoleCount,
    };
  }

  private getRoleCost(player: AlgorithmPlayer, role: Position): number {
    if (player.lockedRole && player.lockedRole !== role) {
      return Number.POSITIVE_INFINITY;
    }

    if (player.primaryPosition === role) {
      return 0;
    }

    if (player.secondaryPosition === role) {
      return 8;
    }

    if (player.isFillAvailable) {
      return 12;
    }

    return 25;
  }

  private calculateMetrics(
    teamAPlayers: AlgorithmPlayer[],
    teamBPlayers: AlgorithmPlayer[],
    teamA: MatchmakingCandidate['teamA'],
    teamB: MatchmakingCandidate['teamB'],
  ): MatchmakingCandidate['metrics'] {
    const teamPowerGap = Math.abs(this.sumRolePower(teamA) - this.sumRolePower(teamB)) / 10;
    const laneMatchupGap = ROLE_ORDER.reduce((sum, role) => {
      const teamAPlayer = teamA.find((player) => player.assignedRole === role);
      const teamBPlayer = teamB.find((player) => player.assignedRole === role);
      return sum + Math.abs(Number(teamAPlayer?.rolePower ?? 0) - Number(teamBPlayer?.rolePower ?? 0));
    }, 0) / 20;

    const allPlayers = new Map(
      [...teamAPlayers, ...teamBPlayers].map((player) => [player.userId, player]),
    );
    const offRolePenalty =
      [...teamA, ...teamB].reduce((sum, assignment) => {
        const player = allPlayers.get(assignment.userId);
        return sum + (player ? this.getRoleCost(player, assignment.assignedRole) / 10 : 0);
      }, 0);

    const preferenceViolationPenalty =
      this.preferencePenalty(teamAPlayers, teamA) + this.preferencePenalty(teamBPlayers, teamB);

    const teamAStdDev = this.standardDeviation(teamA.map((player) => player.rolePower));
    const teamBStdDev = this.standardDeviation(teamB.map((player) => player.rolePower));
    const volatilityClusterPenalty = Math.abs(teamAStdDev - teamBStdDev) / 3;

    return {
      teamPowerGap: Number(teamPowerGap.toFixed(4)),
      laneMatchupGap: Number(laneMatchupGap.toFixed(4)),
      offRolePenalty: Number(offRolePenalty.toFixed(4)),
      repeatTeamPenalty: 0,
      preferenceViolationPenalty: Number(preferenceViolationPenalty.toFixed(4)),
      volatilityClusterPenalty: Number(volatilityClusterPenalty.toFixed(4)),
    };
  }

  private preferencePenalty(
    teamPlayers: AlgorithmPlayer[],
    assignments: MatchmakingCandidate['teamA'],
  ): number {
    const userIds = new Set(assignments.map((assignment) => assignment.userId));

    return teamPlayers.reduce((sum, player) => {
      const missingPreferred = player.sameTeamPreferenceUserIds.filter(
        (preferredUserId) => !userIds.has(preferredUserId),
      ).length;
      const violatedAvoids = player.avoidTeamPreferenceUserIds.filter((avoidUserId) =>
        userIds.has(avoidUserId),
      ).length;

      return sum + missingPreferred * 0.6 + violatedAvoids * 1.2;
    }, 0);
  }

  private sumRolePower(team: MatchmakingCandidate['teamA']): number {
    return team.reduce((sum, player) => sum + player.rolePower, 0);
  }

  private buildCandidateId(
    teamA: MatchmakingCandidate['teamA'],
    mode: BalanceMode,
  ): string {
    return `${mode}:${teamA.map((player) => `${player.userId}-${player.assignedRole}`).join('|')}`;
  }

  private buildExplanationTags(
    metrics: MatchmakingCandidate['metrics'],
    offRoleCount: number,
  ): string[] {
    const tags = [];

    if (metrics.teamPowerGap <= 1) {
      tags.push('tight-team-power-gap');
    }
    if (metrics.laneMatchupGap <= 1.5) {
      tags.push('stable-lane-matchups');
    }
    if (offRoleCount <= 1) {
      tags.push('low-offrole-count');
    }
    if (metrics.preferenceViolationPenalty === 0) {
      tags.push('preference-safe');
    }

    return tags;
  }

  private standardDeviation(values: number[]): number {
    const average = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance =
      values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length;
    return Math.sqrt(variance);
  }
}
