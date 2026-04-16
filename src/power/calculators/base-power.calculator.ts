import { Injectable } from '@nestjs/common';

const TIER_SCORES: Record<string, number> = {
  IRON: 8,
  BRONZE: 18,
  SILVER: 28,
  GOLD: 42,
  PLATINUM: 56,
  EMERALD: 70,
  DIAMOND: 84,
  MASTER: 91,
  GRANDMASTER: 96,
  CHALLENGER: 99,
};

const DIVISION_SCORES: Record<string, number> = {
  IV: 0,
  III: 2,
  II: 4,
  I: 6,
};

const BASELINE_FLOOR = 18;
const CURRENT_SNAPSHOT_GRACE_MS = 1000 * 60 * 10;

interface RankedQueueMetrics {
  queueType: string;
  tier: string;
  rank: string;
  lp: number;
  wins: number;
  losses: number;
  winRate: number;
  totalGames: number;
}

export interface RankedSnapshotHistoryInput {
  collectedAt: Date;
  metricsJson?: Record<string, unknown> | null;
}

export interface BasePowerInput {
  currentRankedSummary?: Record<string, unknown> | null;
  rankedHistory?: RankedSnapshotHistoryInput[];
  lastSyncAt?: Date | null;
}

interface HistoricalRankCandidate {
  collectedAt: string;
  queueSource: 'SOLO' | 'PRIMARY' | 'FLEX';
  rawScore: number;
  decayedScore: number;
  recencyDecay: number;
  ageDays: number;
}

export interface BasePowerBreakdown {
  score: number;
  currentRankScore: number;
  soloRankScore: number;
  historicalRankScore: number;
  flexRankScore: number;
  soloRankConfidence: number;
  historicalRankConfidence: number;
  flexRankConfidence: number;
  rankCompositeBeforeClamp: number;
  basePowerBeforeClamp: number;
  basePowerAfterClamp: number;
  inactivePenalty: number;
  unrankedPenalty: number;
  floorScore: number;
  primaryQueueType: string | null;
  formula: string;
  finalReasonSummary: string;
  queues: Array<
    RankedQueueMetrics & {
      queueScore: number;
    }
  >;
  historicalCandidates: HistoricalRankCandidate[];
}

@Injectable()
export class BasePowerCalculator {
  calculate(input?: BasePowerInput): number {
    return this.calculateDetailed(input).score;
  }

  calculateDetailed(input?: BasePowerInput): BasePowerBreakdown {
    const currentRankedSummary = input?.currentRankedSummary ?? null;
    const currentQueues = this.normalizeQueues(currentRankedSummary);
    const currentSolo = currentQueues.find((queue) => queue.queueType === 'RANKED_SOLO_5x5');
    const currentFlex = currentQueues.find((queue) => queue.queueType === 'RANKED_FLEX_SR');
    const primaryQueue = currentSolo ?? currentFlex ?? currentQueues[0];

    const soloRankScore = currentSolo ? this.calculateQueueScore(currentSolo) : 0;
    const flexRankScore = currentFlex ? this.calculateQueueScore(currentFlex) : 0;
    const soloRankConfidence = currentSolo ? this.calculateSoloConfidence(currentSolo.totalGames) : 0;
    const flexRankConfidence = currentFlex
      ? this.calculateFlexConfidence(currentFlex.totalGames, Boolean(currentSolo))
      : 0;

    const historicalCandidates = this.buildHistoricalCandidates(
      input?.rankedHistory ?? [],
      input?.lastSyncAt ?? null,
    );
    const historicalRankScore = historicalCandidates[0]?.decayedScore ?? 0;
    const historicalRankConfidence = historicalCandidates[0]
      ? this.clamp(
          0.35 +
            historicalCandidates[0].recencyDecay * 0.4 +
            Math.min(0.15, historicalCandidates.length * 0.05),
          0,
          0.9,
        )
      : 0;

    const currentRankScore = currentSolo
      ? soloRankScore
      : currentFlex
        ? this.clamp(flexRankScore * 0.72, 0, 55)
        : 0;

    let rankCompositeBeforeClamp = BASELINE_FLOOR;
    let inactivePenalty = 0;
    let unrankedPenalty = 0;
    let finalReasonSummary = 'no_rank_signal_baseline';

    if (currentSolo) {
      const historicalAdjustment = historicalRankScore
        ? (historicalRankScore - soloRankScore) * 0.14 * historicalRankConfidence
        : 0;
      const flexAdjustment = currentFlex
        ? (flexRankScore - soloRankScore) * 0.04 * flexRankConfidence
        : 0;

      rankCompositeBeforeClamp = soloRankScore + historicalAdjustment + flexAdjustment;
      finalReasonSummary = 'current_solo_anchor';
    } else if (historicalRankScore > 0) {
      const flexAdjustment = currentFlex
        ? (flexRankScore - historicalRankScore) * 0.06 * flexRankConfidence
        : 0;

      rankCompositeBeforeClamp = historicalRankScore + flexAdjustment;
      unrankedPenalty = 4;
      inactivePenalty = this.resolveHistoricalPenalty(historicalCandidates[0]?.ageDays ?? 365);
      finalReasonSummary = 'historical_anchor_current_unranked';
    } else if (currentFlex) {
      rankCompositeBeforeClamp = this.clamp(
        Math.min(48, flexRankScore * (0.58 + 0.12 * flexRankConfidence)),
        0,
        48,
      );
      unrankedPenalty = 7;
      inactivePenalty = 6;
      finalReasonSummary = 'flex_only_provisional';
    } else {
      unrankedPenalty = 8;
      inactivePenalty = 8;
    }

    const basePowerBeforeClamp = rankCompositeBeforeClamp - inactivePenalty - unrankedPenalty;

    return {
      score: this.clamp(basePowerBeforeClamp, 8, 100),
      currentRankScore,
      soloRankScore,
      historicalRankScore,
      flexRankScore,
      soloRankConfidence,
      historicalRankConfidence,
      flexRankConfidence,
      rankCompositeBeforeClamp: Number(rankCompositeBeforeClamp.toFixed(2)),
      basePowerBeforeClamp: Number(basePowerBeforeClamp.toFixed(2)),
      basePowerAfterClamp: this.clamp(basePowerBeforeClamp, 8, 100),
      inactivePenalty,
      unrankedPenalty,
      floorScore: BASELINE_FLOOR,
      primaryQueueType: primaryQueue?.queueType ?? null,
      formula:
        'priority anchor: current solo > historical solo-preferred > flex; flex is weak adjustment only',
      finalReasonSummary,
      queues: currentQueues.map((queue) => ({
        ...queue,
        queueScore: this.calculateQueueScore(queue),
      })),
      historicalCandidates,
    };
  }

  private buildHistoricalCandidates(
    rankedHistory: RankedSnapshotHistoryInput[],
    lastSyncAt: Date | null,
  ): HistoricalRankCandidate[] {
    return rankedHistory
      .map((snapshot) => {
        const queues = this.normalizeQueues(snapshot.metricsJson ?? null);
        const solo = queues.find((queue) => queue.queueType === 'RANKED_SOLO_5x5');
        const flex = queues.find((queue) => queue.queueType === 'RANKED_FLEX_SR');
        const primary = solo ?? queues[0] ?? flex;
        if (!primary) {
          return null;
        }

        const ageDays = this.resolveAgeDays(snapshot.collectedAt, lastSyncAt);
        const recencyDecay = this.resolveHistoricalDecay(ageDays);
        const rawScore = this.calculateQueueScore(primary);
        const sourceMultiplier =
          primary.queueType === 'RANKED_SOLO_5x5'
            ? 0.9
            : primary.queueType === 'RANKED_FLEX_SR'
              ? 0.55
              : 0.75;

        return {
          collectedAt: snapshot.collectedAt.toISOString(),
          queueSource:
            primary.queueType === 'RANKED_SOLO_5x5'
              ? 'SOLO'
              : primary.queueType === 'RANKED_FLEX_SR'
                ? 'FLEX'
                : 'PRIMARY',
          rawScore,
          decayedScore: this.clamp(rawScore * sourceMultiplier * recencyDecay, 0, 100),
          recencyDecay,
          ageDays,
        } satisfies HistoricalRankCandidate;
      })
      .filter((candidate): candidate is HistoricalRankCandidate => candidate !== null)
      .sort((left, right) => right.decayedScore - left.decayedScore);
  }

  private normalizeQueues(
    rankedSummary?: Record<string, unknown> | null,
  ): RankedQueueMetrics[] {
    const rawQueues = Array.isArray(rankedSummary?.queues)
      ? (rankedSummary?.queues as Array<Record<string, unknown>>)
      : [];

    return rawQueues.map((queue) => {
      const wins = Number(queue.wins ?? 0);
      const losses = Number(queue.losses ?? 0);
      const totalGames = Number(queue.totalGames ?? wins + losses);
      const parsedWinRate = queue.winRate === undefined ? 0 : Number(queue.winRate ?? 0);

      return {
        queueType: String(queue.queueType ?? ''),
        tier: String(queue.tier ?? '').toUpperCase(),
        rank: String(queue.rank ?? '').toUpperCase(),
        lp: Number(queue.lp ?? 0),
        wins,
        losses,
        totalGames,
        winRate:
          totalGames > 0
            ? Number((wins / totalGames).toFixed(4))
            : Number(parsedWinRate.toFixed(4)),
      };
    });
  }

  private calculateQueueScore(queue: RankedQueueMetrics): number {
    return this.clamp(
      (TIER_SCORES[queue.tier] ?? BASELINE_FLOOR) +
        (DIVISION_SCORES[queue.rank] ?? 0) +
        Math.min(4, queue.lp / 25),
      0,
      100,
    );
  }

  private calculateSoloConfidence(totalGames: number): number {
    return this.clamp(0.72 + Math.min(0.28, totalGames / 80), 0, 1);
  }

  private calculateFlexConfidence(totalGames: number, hasSolo: boolean): number {
    const maxConfidence = hasSolo ? 0.15 : 0.35;
    return this.clamp(Math.min(maxConfidence, totalGames / 120), 0, maxConfidence);
  }

  private resolveHistoricalPenalty(ageDays: number): number {
    if (ageDays <= 30) {
      return 2;
    }
    if (ageDays <= 90) {
      return 4;
    }
    if (ageDays <= 180) {
      return 6;
    }
    return 8;
  }

  private resolveHistoricalDecay(ageDays: number): number {
    if (ageDays <= 30) {
      return 0.92;
    }
    if (ageDays <= 90) {
      return 0.82;
    }
    if (ageDays <= 180) {
      return 0.7;
    }
    if (ageDays <= 365) {
      return 0.55;
    }
    return 0.42;
  }

  private resolveAgeDays(collectedAt: Date, lastSyncAt: Date | null): number {
    const referenceTime = lastSyncAt?.getTime() ?? Date.now();
    return Math.max(0, Math.round((referenceTime - collectedAt.getTime()) / (1000 * 60 * 60 * 24)));
  }

  isCurrentRankSnapshot(snapshotCollectedAt: Date, lastSyncAt: Date | null): boolean {
    if (!lastSyncAt) {
      return true;
    }
    return Math.abs(lastSyncAt.getTime() - snapshotCollectedAt.getTime()) <= CURRENT_SNAPSHOT_GRACE_MS;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, Number(value.toFixed(2))));
  }
}
