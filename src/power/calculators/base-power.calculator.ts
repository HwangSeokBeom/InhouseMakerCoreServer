import { Injectable } from '@nestjs/common';

const TIER_SCORES: Record<string, number> = {
  IRON: 20,
  BRONZE: 30,
  SILVER: 40,
  GOLD: 50,
  PLATINUM: 60,
  EMERALD: 68,
  DIAMOND: 76,
  MASTER: 84,
  GRANDMASTER: 90,
  CHALLENGER: 96,
};

const DIVISION_SCORES: Record<string, number> = {
  IV: 0,
  III: 1.5,
  II: 3,
  I: 4.5,
};

@Injectable()
export class BasePowerCalculator {
  calculate(rankedSummary?: Record<string, unknown> | null): number {
    const queues = Array.isArray(rankedSummary?.queues)
      ? (rankedSummary?.queues as Array<Record<string, unknown>>)
      : [];

    const weightedScore = queues.reduce((sum, queue) => {
      const queueType = String(queue.queueType ?? '');
      const tier = String(queue.tier ?? '').toUpperCase();
      const rank = String(queue.rank ?? '').toUpperCase();
      const lp = Number(queue.lp ?? 0);
      const weight = queueType === 'RANKED_SOLO_5x5' ? 0.7 : queueType === 'RANKED_FLEX_SR' ? 0.3 : 0;

      return (
        sum +
        weight *
          ((TIER_SCORES[tier] ?? 35) + (DIVISION_SCORES[rank] ?? 0) + Math.min(1.5, lp / 100))
      );
    }, 0);

    const fallbackTier = String(rankedSummary?.primaryTier ?? '').toUpperCase();
    const fallbackRank = String(rankedSummary?.primaryRank ?? '').toUpperCase();
    const fallbackLp = Number(rankedSummary?.primaryLp ?? 0);
    const fallback =
      (TIER_SCORES[fallbackTier] ?? 35) +
      (DIVISION_SCORES[fallbackRank] ?? 0) +
      Math.min(1.5, fallbackLp / 100);

    return this.clamp(weightedScore > 0 ? weightedScore : fallback, 0, 100);
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, Number(value.toFixed(2))));
  }
}

