import { BasePowerCalculator } from '../src/power/calculators/base-power.calculator';

describe('BasePowerCalculator', () => {
  it('keeps solo queue tier as the dominant base power anchor', () => {
    const calculator = new BasePowerCalculator();

    const breakdown = calculator.calculateDetailed({
      currentRankedSummary: {
        queues: [
          {
            queueType: 'RANKED_SOLO_5x5',
            tier: 'EMERALD',
            rank: 'II',
            lp: 80,
            wins: 62,
            losses: 48,
            totalGames: 110,
          },
          {
            queueType: 'RANKED_FLEX_SR',
            tier: 'PLATINUM',
            rank: 'I',
            lp: 40,
            wins: 18,
            losses: 12,
            totalGames: 30,
          },
        ],
      },
      rankedHistory: [
        {
          collectedAt: new Date('2026-03-01T00:00:00.000Z'),
          metricsJson: {
            queues: [
              {
                queueType: 'RANKED_SOLO_5x5',
                tier: 'PLATINUM',
                rank: 'I',
                lp: 75,
                wins: 52,
                losses: 41,
                totalGames: 93,
              },
            ],
          },
        },
      ],
      lastSyncAt: new Date('2026-04-16T00:00:00.000Z'),
    });

    expect(breakdown.score).toBeGreaterThan(65);
    expect(breakdown.soloRankScore).toBeGreaterThan(breakdown.flexRankScore);
    expect(breakdown.currentRankScore).toBe(breakdown.soloRankScore);
    expect(breakdown.primaryQueueType).toBe('RANKED_SOLO_5x5');
  });

  it('uses historical rank above flex when current solo queue is missing', () => {
    const calculator = new BasePowerCalculator();

    const breakdown = calculator.calculateDetailed({
      currentRankedSummary: {
        queues: [
          {
            queueType: 'RANKED_FLEX_SR',
            tier: 'PLATINUM',
            rank: 'I',
            lp: 40,
            wins: 35,
            losses: 28,
            totalGames: 63,
          },
        ],
      },
      rankedHistory: [
        {
          collectedAt: new Date('2026-02-10T00:00:00.000Z'),
          metricsJson: {
            queues: [
              {
                queueType: 'RANKED_SOLO_5x5',
                tier: 'EMERALD',
                rank: 'IV',
                lp: 35,
                wins: 48,
                losses: 39,
                totalGames: 87,
              },
            ],
          },
        },
      ],
      lastSyncAt: new Date('2026-04-16T00:00:00.000Z'),
    });

    expect(breakdown.historicalRankScore).toBeGreaterThan(breakdown.flexRankScore * 0.7);
    expect(breakdown.score).toBeGreaterThan(40);
    expect(breakdown.finalReasonSummary).toBe('historical_anchor_current_unranked');
  });
});
