import { Position } from '@prisma/client';

import { BasePowerCalculator, BasePowerInput } from '../src/power/calculators/base-power.calculator';
import { FormScoreCalculator } from '../src/power/calculators/form-score.calculator';
import { LanePowerCalculator } from '../src/power/calculators/lane-power.calculator';
import { OverallPowerCalculator } from '../src/power/calculators/overall-power.calculator';
import { resolveLaneAutoAssignment } from '../src/power/power-profile.contract';

describe('Power regression fixtures', () => {
  const basePowerCalculator = new BasePowerCalculator();
  const lanePowerCalculator = new LanePowerCalculator();
  const formScoreCalculator = new FormScoreCalculator();
  const overallPowerCalculator = new OverallPowerCalculator();
  const lastSyncAt = new Date('2026-04-16T00:00:00.000Z');

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
              wins: solo.wins ?? 48,
              losses: solo.losses ?? 40,
              totalGames: (solo.wins ?? 48) + (solo.losses ?? 40),
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
              losses: flex.losses ?? 32,
              totalGames: (flex.wins ?? 40) + (flex.losses ?? 32),
            },
          ]
        : []),
    ],
  });

  const historical = (
    collectedAt: string,
    solo: Parameters<typeof rankedSummary>[0],
    flex?: Parameters<typeof rankedSummary>[1],
  ) => ({
    collectedAt: new Date(collectedAt),
    metricsJson: rankedSummary(solo, flex ?? null),
  });

  function evaluateFixture(
    input: BasePowerInput,
    aggregateSummary: Record<string, unknown>,
    primaryPosition: Position | null,
    secondaryPosition: Position | null,
  ) {
    const base = basePowerCalculator.calculateDetailed(input);
    const form = formScoreCalculator.calculateDetailed(aggregateSummary);
    const lane = lanePowerCalculator.calculateDetailed(
      base.score,
      aggregateSummary,
      primaryPosition,
      secondaryPosition,
    );
    const seededRoleMmr = {
      TOP: 1000 + lane.lanePower.TOP * 10,
      JUNGLE: 1000 + lane.lanePower.JUNGLE * 10,
      MID: 1000 + lane.lanePower.MID * 10,
      ADC: 1000 + lane.lanePower.ADC * 10,
      SUPPORT: 1000 + lane.lanePower.SUPPORT * 10,
    };
    const overall = overallPowerCalculator.calculate({
      basePower: base.score,
      formScore: form.score,
      lanePower: lane.lanePower,
      inhouseRoleMmr: seededRoleMmr,
      confirmedMatchCount: 0,
      roleConfirmedMatchCount: {
        TOP: 0,
        JUNGLE: 0,
        MID: 0,
        ADC: 0,
        SUPPORT: 0,
      },
      styleScores: {
        stability: 50,
        carry: 50,
        teamContribution: 50,
        laneInfluence: 50,
      },
      primaryPosition,
      secondaryPosition,
    });
    const auto = resolveLaneAutoAssignment(
      overall.finalRolePower,
      primaryPosition,
      secondaryPosition,
    );

    return {
      base,
      lane,
      overall,
      auto,
    };
  }

  it('keeps strong historical accumulators above a meaningful baseline while active current solo stays ahead', () => {
    const historicalOnly = basePowerCalculator.calculateDetailed({
      currentRankedSummary: rankedSummary(null),
      rankedHistory: [
        historical('2025-11-15T00:00:00.000Z', { tier: 'EMERALD', rank: 'IV', lp: 35 }),
        historical('2025-05-01T00:00:00.000Z', { tier: 'PLATINUM', rank: 'II', lp: 40 }),
        historical('2024-11-10T00:00:00.000Z', { tier: 'GOLD', rank: 'I', lp: 55 }),
      ],
      lastSyncAt,
    });
    const activeCurrentSolo = basePowerCalculator.calculateDetailed({
      currentRankedSummary: rankedSummary({ tier: 'EMERALD', rank: 'IV', lp: 35 }),
      rankedHistory: [
        historical('2025-11-15T00:00:00.000Z', { tier: 'PLATINUM', rank: 'II', lp: 40 }),
      ],
      lastSyncAt,
    });

    expect(historicalOnly.historicalFallbackApplied).toBe(true);
    expect(historicalOnly.score).toBeGreaterThan(42);
    expect(historicalOnly.score).toBeLessThan(activeCurrentSolo.score);
    expect(activeCurrentSolo.finalReasonSummary).toBe('current_solo_anchor');
  });

  it('lets flex-heavy users recover a meaningful baseline without overtaking solo anchors', () => {
    const flexHeavy = basePowerCalculator.calculateDetailed({
      currentRankedSummary: rankedSummary(null, { tier: 'PLATINUM', rank: 'I', lp: 50 }),
      rankedHistory: [
        historical(
          '2025-11-15T00:00:00.000Z',
          { tier: 'GOLD', rank: 'II', lp: 30 },
          { tier: 'EMERALD', rank: 'IV', lp: 40 },
        ),
        historical('2025-05-01T00:00:00.000Z', null, {
          tier: 'PLATINUM',
          rank: 'II',
          lp: 45,
        }),
      ],
      lastSyncAt,
    });
    const soloAnchor = basePowerCalculator.calculateDetailed({
      currentRankedSummary: rankedSummary({ tier: 'PLATINUM', rank: 'I', lp: 50 }),
      rankedHistory: [],
      lastSyncAt,
    });

    expect(flexHeavy.score).toBeGreaterThan(52);
    expect(flexHeavy.previousSeasonFlexContribution).toBeGreaterThan(30);
    expect(flexHeavy.score).toBeLessThan(soloAnchor.score);
  });

  it('regresses case A 티모는내상관 as support-first with a healthier overall floor', () => {
    const result = evaluateFixture(
      {
        currentRankedSummary: rankedSummary(null),
        rankedHistory: [
          historical('2025-11-01T00:00:00.000Z', { tier: 'PLATINUM', rank: 'IV', lp: 20, wins: 70, losses: 58 }),
          historical('2025-03-01T00:00:00.000Z', { tier: 'GOLD', rank: 'II', lp: 40, wins: 64, losses: 56 }),
          historical('2024-10-01T00:00:00.000Z', { tier: 'GOLD', rank: 'III', lp: 30, wins: 55, losses: 49 }),
          historical('2024-03-01T00:00:00.000Z', { tier: 'GOLD', rank: 'IV', lp: 10, wins: 52, losses: 48 }),
          historical('2023-10-01T00:00:00.000Z', { tier: 'GOLD', rank: 'III', lp: 0, wins: 48, losses: 44 }),
          historical('2023-03-01T00:00:00.000Z', { tier: 'SILVER', rank: 'II', lp: 50, wins: 44, losses: 40 }),
        ],
        lastSyncAt,
      },
      {
        sampleSize: 34,
        recentWinRate: 0.53,
        recentKda: 2.7,
        averageVisionScore: 28,
        averageKillParticipation: 0.5,
        laneMetrics: {
          SUPPORT: { matches: 22, winRate: 0.55, kda: 3.1, visionScore: 44, laneInfluence: 2.8 },
          ADC: { matches: 6, winRate: 0.5, kda: 2.2, visionScore: 19, laneInfluence: 0.4 },
          MID: { matches: 3, winRate: 0.46, kda: 2, visionScore: 17, laneInfluence: -0.8 },
          TOP: { matches: 2, winRate: 0.45, kda: 1.8, visionScore: 15, laneInfluence: -1.1 },
          JUNGLE: { matches: 1, winRate: 0.4, kda: 1.9, visionScore: 18, laneInfluence: -0.6 },
        },
      },
      Position.SUPPORT,
      Position.ADC,
    );

    expect(result.overall.overallPower).toBeGreaterThan(44.5);
    expect(result.overall.finalRolePower.SUPPORT).toBeGreaterThan(
      result.overall.finalRolePower.ADC,
    );
    expect(result.overall.finalRolePower.ADC).toBeGreaterThan(
      result.overall.finalRolePower.MID,
    );
    expect(result.auto.primaryPosition).toBe(Position.SUPPORT);
    expect(result.auto.secondaryPosition).toBe(Position.ADC);
    expect(result.auto.scoreGap.primaryToSecondary).toBeGreaterThan(2.5);
    expect(result.auto.scoreGap.totalSpread).toBeGreaterThan(5.5);
  });

  it('regresses case B 나에게미드는살인이다 with stronger historical+flex support and a clear MID lead', () => {
    const result = evaluateFixture(
      {
        currentRankedSummary: rankedSummary(null),
        rankedHistory: [
          historical(
            '2025-11-15T00:00:00.000Z',
            { tier: 'PLATINUM', rank: 'II', lp: 45, wins: 72, losses: 60 },
            { tier: 'EMERALD', rank: 'IV', lp: 30, wins: 40, losses: 34 },
          ),
          historical(
            '2025-05-01T00:00:00.000Z',
            { tier: 'PLATINUM', rank: 'III', lp: 10, wins: 61, losses: 56 },
            { tier: 'PLATINUM', rank: 'I', lp: 55, wins: 43, losses: 37 },
          ),
          historical(
            '2024-11-10T00:00:00.000Z',
            { tier: 'PLATINUM', rank: 'IV', lp: 70, wins: 59, losses: 52 },
            { tier: 'GOLD', rank: 'I', lp: 40, wins: 35, losses: 30 },
          ),
        ],
        lastSyncAt,
      },
      {
        sampleSize: 28,
        recentWinRate: 0.54,
        recentKda: 3,
        averageVisionScore: 21,
        averageKillParticipation: 0.56,
        laneMetrics: {
          MID: { matches: 18, winRate: 0.58, kda: 3.4, visionScore: 21, laneInfluence: 4.1 },
          ADC: { matches: 4, winRate: 0.52, kda: 2.6, visionScore: 18, laneInfluence: 1.1 },
          TOP: { matches: 3, winRate: 0.45, kda: 2.1, visionScore: 16, laneInfluence: -0.5 },
          JUNGLE: { matches: 2, winRate: 0.5, kda: 2.4, visionScore: 19, laneInfluence: 0.2 },
          SUPPORT: { matches: 1, winRate: 0.4, kda: 2.3, visionScore: 20, laneInfluence: -0.4 },
        },
      },
      Position.MID,
      Position.ADC,
    );

    expect(result.overall.overallPower).toBeGreaterThan(50);
    expect(result.base.previousSeasonFlexContribution).toBeGreaterThan(38);
    expect(result.overall.finalRolePower.MID).toBeGreaterThan(result.overall.finalRolePower.ADC);
    expect(result.overall.finalRolePower.ADC).toBeGreaterThan(
      result.overall.finalRolePower.JUNGLE,
    );
    expect(result.auto.primaryPosition).toBe(Position.MID);
    expect(result.auto.secondaryPosition).toBe(Position.ADC);
    expect(result.auto.scoreGap.primaryToSecondary).toBeGreaterThan(2.2);
    expect(result.auto.scoreGap.totalSpread).toBeGreaterThan(5.5);
  });

  it('keeps auto primary/secondary assignment stable for support-heavy users', () => {
    const result = evaluateFixture(
      {
        currentRankedSummary: rankedSummary(null),
        rankedHistory: [
          historical('2025-11-01T00:00:00.000Z', { tier: 'PLATINUM', rank: 'IV', lp: 20 }),
          historical('2025-03-01T00:00:00.000Z', { tier: 'GOLD', rank: 'II', lp: 40 }),
          historical('2024-10-01T00:00:00.000Z', { tier: 'GOLD', rank: 'III', lp: 30 }),
        ],
        lastSyncAt,
      },
      {
        sampleSize: 34,
        recentWinRate: 0.53,
        recentKda: 2.7,
        averageVisionScore: 28,
        averageKillParticipation: 0.5,
        laneMetrics: {
          SUPPORT: { matches: 22, winRate: 0.55, kda: 3.1, visionScore: 44, laneInfluence: 2.8 },
          ADC: { matches: 6, winRate: 0.5, kda: 2.2, visionScore: 19, laneInfluence: 0.4 },
          MID: { matches: 3, winRate: 0.46, kda: 2, visionScore: 17, laneInfluence: -0.8 },
          TOP: { matches: 2, winRate: 0.45, kda: 1.8, visionScore: 15, laneInfluence: -1.1 },
          JUNGLE: { matches: 1, winRate: 0.4, kda: 1.9, visionScore: 18, laneInfluence: -0.6 },
        },
      },
      null,
      null,
    );

    expect(result.auto.source).toBe('auto_fallback');
    expect(result.auto.primaryPosition).toBe(Position.SUPPORT);
    expect(result.auto.secondaryPosition).toBe(Position.ADC);
    expect(result.auto.scoreGap.primaryToSecondary).toBeGreaterThan(4);
    expect(result.auto.scoreGap.totalSpread).toBeGreaterThan(5);
  });
});
