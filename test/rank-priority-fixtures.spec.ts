import { Position } from '@prisma/client';

import { BasePowerCalculator, BasePowerInput } from '../src/power/calculators/base-power.calculator';
import { FormScoreCalculator } from '../src/power/calculators/form-score.calculator';
import { LanePowerCalculator } from '../src/power/calculators/lane-power.calculator';
import { OverallPowerCalculator } from '../src/power/calculators/overall-power.calculator';

describe('Rank source priority fixtures', () => {
  const basePowerCalculator = new BasePowerCalculator();
  const lanePowerCalculator = new LanePowerCalculator();
  const formScoreCalculator = new FormScoreCalculator();
  const overallPowerCalculator = new OverallPowerCalculator();
  const lastSyncAt = new Date('2026-04-16T00:00:00.000Z');
  const neutralAggregate = {
    sampleSize: 10,
    recentWinRate: 0.52,
    recentKda: 2.6,
    averageVisionScore: 21,
    averageKillParticipation: 0.52,
    laneMetrics: {
      MID: { matches: 6, winRate: 0.55, kda: 2.8, visionScore: 18, laneInfluence: 1.5 },
      ADC: { matches: 3, winRate: 0.5, kda: 2.4, visionScore: 17, laneInfluence: 0.4 },
      TOP: { matches: 1, winRate: 0.45, kda: 2.1, visionScore: 15, laneInfluence: -0.2 },
    },
  };

  const buildCurrent = (
    solo: { tier: string; rank: string; lp: number } | null,
    flex: { tier: string; rank: string; lp: number } | null,
  ) => ({
    queues: [
      ...(solo
        ? [
            {
              queueType: 'RANKED_SOLO_5x5',
              ...solo,
              wins: 40,
              losses: 30,
              totalGames: 70,
            },
          ]
        : []),
      ...(flex
        ? [
            {
              queueType: 'RANKED_FLEX_SR',
              ...flex,
              wins: 32,
              losses: 24,
              totalGames: 56,
            },
          ]
        : []),
    ],
  });

  const buildHistorical = (
    collectedAt: string,
    solo: { tier: string; rank: string; lp: number } | null,
    flex?: { tier: string; rank: string; lp: number } | null,
  ) => ({
    collectedAt: new Date(collectedAt),
    metricsJson: buildCurrent(solo, flex ?? null),
  });

  const evaluateFixture = (input: BasePowerInput) => {
    const base = basePowerCalculator.calculateDetailed(input);
    const form = formScoreCalculator.calculateDetailed(neutralAggregate);
    const lane = lanePowerCalculator.calculateDetailed(
      base.score,
      neutralAggregate,
      Position.MID,
      Position.ADC,
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
        stability: 52,
        carry: 51,
        teamContribution: 51,
        laneInfluence: 52,
      },
      primaryPosition: Position.MID,
      secondaryPosition: Position.ADC,
    });

    return {
      base: base.score,
      overall: overall.overallPower,
      reason: base.finalReasonSummary,
    };
  };

  it('keeps solo > historical > flex ordering across representative fixtures', () => {
    const fixtures = {
      A: evaluateFixture({
        currentRankedSummary: buildCurrent(
          { tier: 'EMERALD', rank: 'II', lp: 40 },
          { tier: 'PLATINUM', rank: 'I', lp: 60 },
        ),
        rankedHistory: [],
        lastSyncAt,
      }),
      B: evaluateFixture({
        currentRankedSummary: buildCurrent(
          { tier: 'GOLD', rank: 'II', lp: 60 },
          { tier: 'PLATINUM', rank: 'I', lp: 40 },
        ),
        rankedHistory: [],
        lastSyncAt,
      }),
      C: evaluateFixture({
        currentRankedSummary: buildCurrent(
          { tier: 'SILVER', rank: 'II', lp: 60 },
          { tier: 'GOLD', rank: 'II', lp: 20 },
        ),
        rankedHistory: [],
        lastSyncAt,
      }),
      D: evaluateFixture({
        currentRankedSummary: buildCurrent(
          { tier: 'BRONZE', rank: 'II', lp: 60 },
          { tier: 'SILVER', rank: 'I', lp: 20 },
        ),
        rankedHistory: [],
        lastSyncAt,
      }),
      E: evaluateFixture({
        currentRankedSummary: buildCurrent(null, { tier: 'PLATINUM', rank: 'I', lp: 40 }),
        rankedHistory: [
          buildHistorical('2026-02-20T00:00:00.000Z', { tier: 'EMERALD', rank: 'II', lp: 30 }),
        ],
        lastSyncAt,
      }),
      F: evaluateFixture({
        currentRankedSummary: buildCurrent(null, { tier: 'PLATINUM', rank: 'I', lp: 40 }),
        rankedHistory: [
          buildHistorical('2026-02-20T00:00:00.000Z', { tier: 'GOLD', rank: 'II', lp: 30 }),
        ],
        lastSyncAt,
      }),
      G: evaluateFixture({
        currentRankedSummary: buildCurrent(null, { tier: 'PLATINUM', rank: 'I', lp: 40 }),
        rankedHistory: [],
        lastSyncAt,
      }),
      H: evaluateFixture({
        currentRankedSummary: buildCurrent(null, { tier: 'BRONZE', rank: 'III', lp: 10 }),
        rankedHistory: [
          buildHistorical('2026-01-25T00:00:00.000Z', { tier: 'PLATINUM', rank: 'II', lp: 40 }),
        ],
        lastSyncAt,
      }),
    };

    expect(fixtures.A.overall).toBeGreaterThan(fixtures.B.overall);
    expect(fixtures.B.overall).toBeGreaterThan(fixtures.C.overall);
    expect(fixtures.C.overall).toBeGreaterThan(fixtures.D.overall);
    expect(fixtures.A.overall).toBeGreaterThan(fixtures.E.overall);
    expect(fixtures.E.overall).toBeGreaterThan(fixtures.G.overall);
    expect(fixtures.E.overall).toBeGreaterThan(fixtures.F.overall);
    expect(fixtures.H.overall).toBeGreaterThan(fixtures.G.overall);
    expect(fixtures.A.overall - fixtures.D.overall).toBeGreaterThan(12);
  });
});
