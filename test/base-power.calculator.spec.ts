import { BasePowerCalculator } from '../src/power/calculators/base-power.calculator';

describe('BasePowerCalculator', () => {
  const rankedSummary = (
    solo: { tier: string; rank: string; lp: number; wins?: number; losses?: number } | null,
    flex: { tier: string; rank: string; lp: number; wins?: number; losses?: number } | null = null,
  ) => ({
    queues: [
      ...(solo
        ? [
            {
              queueType: 'RANKED_SOLO_5x5',
              tier: solo.tier,
              rank: solo.rank,
              lp: solo.lp,
              wins: solo.wins ?? 50,
              losses: solo.losses ?? 40,
            },
          ]
        : []),
      ...(flex
        ? [
            {
              queueType: 'RANKED_FLEX_SR',
              tier: flex.tier,
              rank: flex.rank,
              lp: flex.lp,
              wins: flex.wins ?? 40,
              losses: flex.losses ?? 35,
            },
          ]
        : []),
    ],
  });

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

  it('softens current-season unranked solo users with recent historical solo baseline', () => {
    const calculator = new BasePowerCalculator();

    const breakdown = calculator.calculateDetailed({
      currentRankedSummary: rankedSummary(null),
      rankedHistory: [
        {
          collectedAt: new Date('2026-02-20T00:00:00.000Z'),
          metricsJson: rankedSummary(
            { tier: 'EMERALD', rank: 'II', lp: 50, wins: 74, losses: 61 },
            { tier: 'PLATINUM', rank: 'I', lp: 10, wins: 20, losses: 15 },
          ),
        },
        {
          collectedAt: new Date('2025-11-20T00:00:00.000Z'),
          metricsJson: rankedSummary({ tier: 'PLATINUM', rank: 'II', lp: 20 }),
        },
      ],
      lastSyncAt: new Date('2026-04-16T00:00:00.000Z'),
    });

    expect(breakdown.historicalFallbackApplied).toBe(true);
    expect(breakdown.score).toBeGreaterThan(54);
    expect(breakdown.score).toBeLessThan(76);
    expect(breakdown.previousSeasonSoloContribution).toBeGreaterThan(
      breakdown.previousSeasonFlexContribution,
    );
    expect(breakdown.historicalSeasonWeights.map((item) => item.seasonKey)).toContain('2026');
  });

  it('keeps previous seasons as a weak support signal when current solo exists', () => {
    const calculator = new BasePowerCalculator();

    const breakdown = calculator.calculateDetailed({
      currentRankedSummary: rankedSummary({ tier: 'GOLD', rank: 'IV', lp: 0 }),
      rankedHistory: [
        {
          collectedAt: new Date('2026-01-20T00:00:00.000Z'),
          metricsJson: rankedSummary({ tier: 'DIAMOND', rank: 'IV', lp: 50 }),
        },
      ],
      lastSyncAt: new Date('2026-04-16T00:00:00.000Z'),
    });

    expect(breakdown.finalReasonSummary).toBe('current_solo_anchor');
    expect(breakdown.historicalFallbackApplied).toBe(false);
    expect(breakdown.historicalAdjustment).toBeGreaterThan(0);
    expect(breakdown.historicalAdjustment).toBeLessThan(5);
    expect(breakdown.score).toBeLessThan(50);
  });

  it('uses flex-only rank as a meaningful but lower-confidence signal', () => {
    const calculator = new BasePowerCalculator();

    const flexOnly = calculator.calculateDetailed({
      currentRankedSummary: rankedSummary(null, {
        tier: 'EMERALD',
        rank: 'II',
        lp: 30,
        wins: 90,
        losses: 70,
      }),
      rankedHistory: [],
      lastSyncAt: new Date('2026-04-16T00:00:00.000Z'),
    });
    const soloSameTier = calculator.calculateDetailed({
      currentRankedSummary: rankedSummary({
        tier: 'EMERALD',
        rank: 'II',
        lp: 30,
        wins: 90,
        losses: 70,
      }),
      rankedHistory: [],
      lastSyncAt: new Date('2026-04-16T00:00:00.000Z'),
    });

    expect(flexOnly.finalReasonSummary).toBe('flex_only_provisional');
    expect(flexOnly.score).toBeGreaterThan(35);
    expect(flexOnly.score).toBeLessThan(soloSameTier.score - 20);
  });

  it('keeps old season-only history decayed but above the empty baseline', () => {
    const calculator = new BasePowerCalculator();

    const breakdown = calculator.calculateDetailed({
      currentRankedSummary: rankedSummary(null),
      rankedHistory: [
        {
          collectedAt: new Date('2024-02-20T00:00:00.000Z'),
          metricsJson: rankedSummary({ tier: 'DIAMOND', rank: 'III', lp: 40 }),
        },
        {
          collectedAt: new Date('2023-02-20T00:00:00.000Z'),
          metricsJson: rankedSummary(null, { tier: 'PLATINUM', rank: 'I', lp: 20 }),
        },
      ],
      lastSyncAt: new Date('2026-04-16T00:00:00.000Z'),
    });

    expect(breakdown.score).toBeGreaterThan(35);
    expect(breakdown.historicalCandidates).toHaveLength(2);
    expect(breakdown.historicalCandidates[0].recencyDecay).toBeGreaterThan(
      breakdown.historicalCandidates[1].recencyDecay,
    );
  });
});
