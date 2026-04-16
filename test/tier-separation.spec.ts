import { Position } from '@prisma/client';

import { BasePowerCalculator } from '../src/power/calculators/base-power.calculator';
import { FormScoreCalculator } from '../src/power/calculators/form-score.calculator';
import { LanePowerCalculator } from '../src/power/calculators/lane-power.calculator';
import { OverallPowerCalculator } from '../src/power/calculators/overall-power.calculator';

const TIERS = [
  { tier: 'IRON', rank: 'IV', lp: 0 },
  { tier: 'BRONZE', rank: 'I', lp: 50 },
  { tier: 'SILVER', rank: 'II', lp: 60 },
  { tier: 'GOLD', rank: 'II', lp: 50 },
  { tier: 'PLATINUM', rank: 'III', lp: 40 },
  { tier: 'EMERALD', rank: 'II', lp: 70 },
  { tier: 'DIAMOND', rank: 'III', lp: 30 },
  { tier: 'MASTER', rank: '', lp: 120 },
] as const;

describe('Tier separation fixtures', () => {
  const basePowerCalculator = new BasePowerCalculator();
  const formScoreCalculator = new FormScoreCalculator();
  const lanePowerCalculator = new LanePowerCalculator();
  const overallPowerCalculator = new OverallPowerCalculator();
  const aggregateSummary = {
    sampleSize: 10,
    recentWinRate: 0.52,
    recentKda: 2.6,
    averageVisionScore: 21,
    averageKillParticipation: 0.52,
    laneMetrics: {
      MID: { matches: 8, winRate: 0.54, kda: 2.9, visionScore: 22, laneInfluence: 13 },
      ADC: { matches: 2, winRate: 0.5, kda: 2.1, visionScore: 18, laneInfluence: 9 },
    },
  };

  const results = TIERS.map(({ tier, rank, lp }) => {
    const basePower = basePowerCalculator.calculateDetailed({
      currentRankedSummary: {
        queues: [
          {
            queueType: 'RANKED_SOLO_5x5',
            tier,
            rank,
            lp,
            wins: 40,
            losses: 35,
          },
        ],
      },
      rankedHistory: [],
      lastSyncAt: new Date('2026-04-16T12:00:00Z'),
    });
    const formScore = formScoreCalculator.calculateDetailed(aggregateSummary);
    const lanePower = lanePowerCalculator.calculateDetailed(
      basePower.score,
      aggregateSummary,
      Position.MID,
      Position.ADC,
    );
    const overallPower = overallPowerCalculator.calculate({
      basePower: basePower.score,
      formScore: formScore.score,
      lanePower: lanePower.lanePower,
      inhouseRoleMmr: {
        TOP: 1500,
        JUNGLE: 1500,
        MID: 1500,
        ADC: 1500,
        SUPPORT: 1500,
      },
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
      primaryPosition: Position.MID,
      secondaryPosition: Position.ADC,
    });

    return {
      tier,
      base: basePower.score,
      overall: overallPower.overallPower,
      displayed: Math.round(overallPower.overallPower),
    };
  });

  it('preserves strict current solo hierarchy in base, overall, and displayed score', () => {
    for (let index = 1; index < results.length; index += 1) {
      expect(results[index].base).toBeGreaterThan(results[index - 1].base);
      expect(results[index].overall).toBeGreaterThan(results[index - 1].overall);
      expect(results[index].displayed).toBeGreaterThan(results[index - 1].displayed);
    }
  });

  it('keeps meaningful overall separation across large tier gaps', () => {
    const iron = results.find((item) => item.tier === 'IRON');
    const bronze = results.find((item) => item.tier === 'BRONZE');
    const silver = results.find((item) => item.tier === 'SILVER');
    const gold = results.find((item) => item.tier === 'GOLD');
    const emerald = results.find((item) => item.tier === 'EMERALD');
    const diamond = results.find((item) => item.tier === 'DIAMOND');
    const master = results.find((item) => item.tier === 'MASTER');

    expect(iron && bronze && silver && gold && emerald && diamond && master).toBeTruthy();

    // These thresholds are intentionally conservative. They allow future coefficient tuning,
    // but still fail if the final overall score collapses back into the 1-3 point gap range.
    expect((emerald?.overall ?? 0) - (bronze?.overall ?? 0)).toBeGreaterThanOrEqual(30);
    expect((diamond?.overall ?? 0) - (silver?.overall ?? 0)).toBeGreaterThanOrEqual(30);
    expect((master?.overall ?? 0) - (gold?.overall ?? 0)).toBeGreaterThanOrEqual(25);
    expect((bronze?.overall ?? 0) - (iron?.overall ?? 0)).toBeGreaterThanOrEqual(10);
    expect((master?.overall ?? 0) - (iron?.overall ?? 0)).toBeGreaterThanOrEqual(55);
  });
});
