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
  queueType: string;
  seasonKey: string;
  seasonOffset: number;
  rawScore: number;
  decayedScore: number;
  recencyDecay: number;
  ageDays: number;
  queueWeight: number;
  effectiveWeight: number;
  weightedValue: number;
}

interface HistoricalRankSummary {
  weightedScore: number;
  soloWeightedScore: number;
  flexWeightedScore: number;
  confidence: number;
  recentAnchorScore: number;
  recentPeakScore: number;
  totalWeight: number;
  soloWeight: number;
  flexWeight: number;
  seasonWeights: Array<{
    seasonKey: string;
    seasonOffset: number;
    soloWeight: number;
    flexWeight: number;
    totalWeight: number;
    decay: number;
  }>;
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
  currentSeasonRankContribution: number;
  previousSeasonWeightedContribution: number;
  previousSeasonSoloContribution: number;
  previousSeasonFlexContribution: number;
  historicalFallbackApplied: boolean;
  historicalRecentAnchorScore: number;
  historicalRecentPeakScore: number;
  historicalFallbackFloorScore: number;
  historicalAdjustment: number;
  flexAdjustment: number;
  historicalSeasonWeights: HistoricalRankSummary['seasonWeights'];
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
    const historicalSummary = this.summarizeHistoricalCandidates(historicalCandidates);
    const historicalRankScore = historicalSummary.weightedScore;
    const historicalRankConfidence = historicalSummary.confidence;

    const currentRankScore = currentSolo
      ? soloRankScore
      : currentFlex
        ? this.clamp(flexRankScore * 0.84, 0, 62)
        : 0;

    let rankCompositeBeforeClamp = BASELINE_FLOOR;
    let floorScore = BASELINE_FLOOR;
    let inactivePenalty = 0;
    let unrankedPenalty = 0;
    let finalReasonSummary = 'no_rank_signal_baseline';
    let historicalAdjustment = 0;
    let flexAdjustment = 0;
    let currentSeasonRankContribution = 0;
    let historicalFallbackApplied = false;

    if (currentSolo) {
      historicalAdjustment = historicalRankScore
        ? this.clamp(
            (historicalRankScore - soloRankScore) * 0.18 * historicalRankConfidence,
            -4.5,
            4.5,
          )
        : 0;
      flexAdjustment = currentFlex
        ? this.clamp((flexRankScore - soloRankScore) * 0.12 * flexRankConfidence, -2.5, 2.5)
        : 0;

      rankCompositeBeforeClamp = soloRankScore + historicalAdjustment + flexAdjustment;
      currentSeasonRankContribution = soloRankScore;
      finalReasonSummary = 'current_solo_anchor';
    } else if (historicalRankScore > 0) {
      const recentAgeDays = historicalCandidates[0]?.ageDays ?? 365;
      const historicalFallbackAnchor = historicalRankScore * (0.8 + historicalRankConfidence * 0.1);
      flexAdjustment = currentFlex
        ? this.clamp(
            currentRankScore * (0.05 + 0.07 * flexRankConfidence) +
              (flexRankScore - historicalRankScore) * 0.1 * flexRankConfidence,
            -1.5,
            5.5,
          )
        : this.clamp(
            historicalSummary.flexWeightedScore > 0
              ? historicalSummary.flexWeightedScore * 0.08
              : 0,
            0,
            4.5,
          );

      rankCompositeBeforeClamp = historicalFallbackAnchor + flexAdjustment;
      unrankedPenalty = currentFlex ? 1.25 : 1.75;
      inactivePenalty = this.resolveHistoricalPenalty(recentAgeDays);
      currentSeasonRankContribution = currentFlex ? currentRankScore : 0;
      historicalFallbackApplied = true;
      floorScore = this.resolveHistoricalFallbackFloor({
        historicalRankScore,
        historicalRankConfidence,
        ageDays: recentAgeDays,
        currentFlexContribution: currentFlex ? currentRankScore : 0,
      });
      if (currentFlex) {
        floorScore = Math.max(
          floorScore,
          this.clamp(currentRankScore * (0.94 + 0.06 * flexRankConfidence), 40, 58),
        );
      }
      finalReasonSummary = 'historical_anchor_current_unranked';
    } else if (currentFlex) {
      rankCompositeBeforeClamp = this.clamp(
        Math.min(60, flexRankScore * (0.74 + 0.2 * flexRankConfidence)),
        0,
        60,
      );
      unrankedPenalty = 3.5;
      inactivePenalty = 1.5;
      currentSeasonRankContribution = currentRankScore;
      floorScore = this.clamp(currentRankScore * 0.78, 28, 46);
      finalReasonSummary = 'flex_only_provisional';
    } else {
      unrankedPenalty = 8;
      inactivePenalty = 8;
    }

    const rawBasePowerBeforeClamp = rankCompositeBeforeClamp - inactivePenalty - unrankedPenalty;
    const basePowerBeforeClamp =
      historicalFallbackApplied || currentFlex
        ? Math.max(rawBasePowerBeforeClamp, floorScore)
        : rawBasePowerBeforeClamp;

    return {
      score: this.clamp(basePowerBeforeClamp, 8, 100),
      currentRankScore,
      soloRankScore,
      historicalRankScore,
      flexRankScore,
      soloRankConfidence,
      historicalRankConfidence,
      flexRankConfidence,
      currentSeasonRankContribution: Number(currentSeasonRankContribution.toFixed(2)),
      previousSeasonWeightedContribution: historicalRankScore,
      previousSeasonSoloContribution: historicalSummary.soloWeightedScore,
      previousSeasonFlexContribution: historicalSummary.flexWeightedScore,
      historicalFallbackApplied,
      historicalRecentAnchorScore: historicalSummary.recentAnchorScore,
      historicalRecentPeakScore: historicalSummary.recentPeakScore,
      historicalFallbackFloorScore: Number(floorScore.toFixed(2)),
      historicalAdjustment: Number(historicalAdjustment.toFixed(2)),
      flexAdjustment: Number(flexAdjustment.toFixed(2)),
      historicalSeasonWeights: historicalSummary.seasonWeights,
      rankCompositeBeforeClamp: Number(rankCompositeBeforeClamp.toFixed(2)),
      basePowerBeforeClamp: Number(basePowerBeforeClamp.toFixed(2)),
      basePowerAfterClamp: this.clamp(basePowerBeforeClamp, 8, 100),
      inactivePenalty,
      unrankedPenalty,
      floorScore: Number(floorScore.toFixed(2)),
      primaryQueueType: primaryQueue?.queueType ?? null,
      formula:
        'priority anchor: current solo > recent historical solo > current flex > historical flex',
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
    const referenceSeason = this.resolveSeasonKey(lastSyncAt ?? new Date());

    return rankedHistory
      .flatMap((snapshot) => {
        const queues = this.normalizeQueues(snapshot.metricsJson ?? null);
        const solo = queues.find((queue) => queue.queueType === 'RANKED_SOLO_5x5');
        const flex = queues.find((queue) => queue.queueType === 'RANKED_FLEX_SR');
        const fallbackPrimary = queues.find(
          (queue) => queue.queueType !== 'RANKED_SOLO_5x5' && queue.queueType !== 'RANKED_FLEX_SR',
        );
        const candidates = [solo, flex, fallbackPrimary].filter(
          (queue): queue is RankedQueueMetrics => Boolean(queue),
        );

        if (candidates.length === 0) {
          return [];
        }

        const ageDays = this.resolveAgeDays(snapshot.collectedAt, lastSyncAt);
        const seasonKey = this.resolveSeasonKey(snapshot.collectedAt);
        const seasonOffset = Math.max(0, Number(referenceSeason) - Number(seasonKey));
        const recencyDecay = this.resolveHistoricalDecay(ageDays, seasonOffset);

        return candidates.map((queue) => {
          const rawScore = this.calculateQueueScore(queue);
          const queueSource =
            queue.queueType === 'RANKED_SOLO_5x5'
              ? 'SOLO'
              : queue.queueType === 'RANKED_FLEX_SR'
                ? 'FLEX'
                : 'PRIMARY';
          const scoreMultiplier = this.resolveHistoricalScoreMultiplier(queue.queueType);
          const queueWeight = this.resolveHistoricalQueueWeight(queue.queueType);
          const effectiveWeight =
            recencyDecay * queueWeight * this.calculateHistoricalGameConfidence(queue.totalGames);
          const decayedScore = this.clamp(rawScore * scoreMultiplier * recencyDecay, 0, 100);

          return {
            collectedAt: snapshot.collectedAt.toISOString(),
            queueSource,
            queueType: queue.queueType,
            seasonKey,
            seasonOffset,
            rawScore,
            decayedScore,
            recencyDecay,
            ageDays,
            queueWeight,
            effectiveWeight,
            weightedValue: decayedScore * effectiveWeight,
          } satisfies HistoricalRankCandidate;
        });
      })
      .sort((left, right) => {
        if (left.seasonOffset !== right.seasonOffset) {
          return left.seasonOffset - right.seasonOffset;
        }
        return right.effectiveWeight - left.effectiveWeight;
      });
  }

  private summarizeHistoricalCandidates(
    candidates: HistoricalRankCandidate[],
  ): HistoricalRankSummary {
    if (candidates.length === 0) {
      return {
        weightedScore: 0,
        soloWeightedScore: 0,
        flexWeightedScore: 0,
        confidence: 0,
        recentAnchorScore: 0,
        recentPeakScore: 0,
        totalWeight: 0,
        soloWeight: 0,
        flexWeight: 0,
        seasonWeights: [],
      };
    }

    const totalWeight = candidates.reduce((sum, candidate) => sum + candidate.effectiveWeight, 0);
    const soloCandidates = candidates.filter((candidate) => candidate.queueSource === 'SOLO');
    const flexCandidates = candidates.filter((candidate) => candidate.queueSource === 'FLEX');
    const soloWeight = soloCandidates.reduce((sum, candidate) => sum + candidate.effectiveWeight, 0);
    const flexWeight = flexCandidates.reduce((sum, candidate) => sum + candidate.effectiveWeight, 0);
    const weightedScore =
      totalWeight > 0
        ? candidates.reduce((sum, candidate) => sum + candidate.weightedValue, 0) / totalWeight
        : 0;
    const recentCandidates = candidates.filter(
      (candidate) => candidate.seasonOffset <= 1 || candidate.ageDays <= 240,
    );
    const recentAnchorScore =
      recentCandidates[0]?.decayedScore ?? candidates[0]?.decayedScore ?? weightedScore;
    const recentPeakScore = recentCandidates.reduce(
      (best, candidate) => Math.max(best, candidate.decayedScore),
      recentAnchorScore,
    );
    const recencyAnchoredWeightedScore =
      weightedScore * 0.5 + recentAnchorScore * 0.2 + recentPeakScore * 0.3;
    const soloWeightedScore =
      soloWeight > 0
        ? soloCandidates.reduce((sum, candidate) => sum + candidate.weightedValue, 0) / soloWeight
        : 0;
    const flexWeightedScore =
      flexWeight > 0
        ? flexCandidates.reduce((sum, candidate) => sum + candidate.weightedValue, 0) / flexWeight
        : 0;
    const seasonBuckets = new Map<
      string,
      {
        seasonKey: string;
        seasonOffset: number;
        soloWeight: number;
        flexWeight: number;
        totalWeight: number;
        decay: number;
      }
    >();

    for (const candidate of candidates) {
      const current = seasonBuckets.get(candidate.seasonKey) ?? {
        seasonKey: candidate.seasonKey,
        seasonOffset: candidate.seasonOffset,
        soloWeight: 0,
        flexWeight: 0,
        totalWeight: 0,
        decay: 0,
      };

      if (candidate.queueSource === 'SOLO') {
        current.soloWeight += candidate.effectiveWeight;
      }
      if (candidate.queueSource === 'FLEX') {
        current.flexWeight += candidate.effectiveWeight;
      }
      current.totalWeight += candidate.effectiveWeight;
      current.decay = Math.max(current.decay, candidate.recencyDecay);
      seasonBuckets.set(candidate.seasonKey, current);
    }

    return {
      weightedScore: this.clamp(recencyAnchoredWeightedScore, 0, 100),
      soloWeightedScore: this.clamp(soloWeightedScore, 0, 100),
      flexWeightedScore: this.clamp(flexWeightedScore, 0, 100),
      confidence: this.clamp(0.34 + Math.min(0.56, totalWeight / 2.1), 0, 0.9),
      recentAnchorScore: this.clamp(recentAnchorScore, 0, 100),
      recentPeakScore: this.clamp(recentPeakScore, 0, 100),
      totalWeight: Number(totalWeight.toFixed(4)),
      soloWeight: Number(soloWeight.toFixed(4)),
      flexWeight: Number(flexWeight.toFixed(4)),
      seasonWeights: [...seasonBuckets.values()]
        .sort((left, right) => left.seasonOffset - right.seasonOffset)
        .map((bucket) => ({
          seasonKey: bucket.seasonKey,
          seasonOffset: bucket.seasonOffset,
          soloWeight: Number(bucket.soloWeight.toFixed(4)),
          flexWeight: Number(bucket.flexWeight.toFixed(4)),
          totalWeight: Number(bucket.totalWeight.toFixed(4)),
          decay: Number(bucket.decay.toFixed(4)),
        })),
    };
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
    const maxConfidence = hasSolo ? 0.28 : 0.6;
    return this.clamp(Math.min(maxConfidence, totalGames / 90), 0, maxConfidence);
  }

  private resolveHistoricalPenalty(ageDays: number): number {
    if (ageDays <= 30) {
      return 0.75;
    }
    if (ageDays <= 90) {
      return 1.5;
    }
    if (ageDays <= 180) {
      return 2.5;
    }
    if (ageDays <= 365) {
      return 3.25;
    }
    return 4.25;
  }

  private resolveHistoricalDecay(ageDays: number, seasonOffset: number): number {
    const seasonDecay = seasonOffset <= 0 ? 1 : Math.max(0.62, 0.92 ** seasonOffset);
    let ageFreshness = 0.78;

    if (ageDays <= 30) {
      ageFreshness = 1;
    } else if (ageDays <= 90) {
      ageFreshness = 0.98;
    } else if (ageDays <= 180) {
      ageFreshness = 0.95;
    } else if (ageDays <= 365) {
      ageFreshness = 0.9;
    } else if (ageDays <= 540) {
      ageFreshness = 0.84;
    }

    return this.clamp(seasonDecay * ageFreshness, 0.52, 1);
  }

  private resolveAgeDays(collectedAt: Date, lastSyncAt: Date | null): number {
    const referenceTime = lastSyncAt?.getTime() ?? Date.now();
    return Math.max(0, Math.round((referenceTime - collectedAt.getTime()) / (1000 * 60 * 60 * 24)));
  }

  private resolveSeasonKey(date: Date): string {
    return String(date.getUTCFullYear());
  }

  private resolveHistoricalScoreMultiplier(queueType: string): number {
    if (queueType === 'RANKED_SOLO_5x5') {
      return 1.02;
    }
    if (queueType === 'RANKED_FLEX_SR') {
      return 0.82;
    }
    return 0.88;
  }

  private resolveHistoricalQueueWeight(queueType: string): number {
    if (queueType === 'RANKED_SOLO_5x5') {
      return 1.08;
    }
    if (queueType === 'RANKED_FLEX_SR') {
      return 0.6;
    }
    return 0.74;
  }

  private calculateHistoricalGameConfidence(totalGames: number): number {
    return this.clamp(0.76 + Math.min(0.24, totalGames / 90), 0.76, 1);
  }

  private resolveHistoricalFallbackFloor(input: {
    historicalRankScore: number;
    historicalRankConfidence: number;
    ageDays: number;
    currentFlexContribution: number;
  }): number {
    let floor =
      input.historicalRankScore -
      (2.4 - 2.2 * input.historicalRankConfidence) +
      input.currentFlexContribution * 0.08;

    if (input.ageDays > 365) {
      floor -= 4;
    } else if (input.ageDays > 180) {
      floor -= 2.5;
    } else if (input.ageDays > 90) {
      floor -= 1.25;
    }

    return this.clamp(floor, 28, 64);
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
