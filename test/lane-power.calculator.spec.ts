import { Position } from '@prisma/client';

import { LanePowerCalculator } from '../src/power/calculators/lane-power.calculator';

describe('LanePowerCalculator', () => {
  it('keeps lane power close to base and respects primary-secondary hierarchy', () => {
    const calculator = new LanePowerCalculator();

    const breakdown = calculator.calculateDetailed(
      70,
      {
        sampleSize: 10,
        laneMetrics: {
          TOP: { matches: 6, winRate: 0.63, kda: 3.1, visionScore: 19, laneInfluence: 4.2 },
          JUNGLE: { matches: 3, winRate: 0.56, kda: 2.8, visionScore: 22, laneInfluence: 2.4 },
          MID: { matches: 1, winRate: 0.4, kda: 1.9, visionScore: 15, laneInfluence: -1.5 },
        },
      },
      Position.TOP,
      Position.JUNGLE,
    );

    expect(breakdown.lanePower.TOP).toBeGreaterThan(breakdown.lanePower.JUNGLE);
    expect(breakdown.lanePower.JUNGLE).toBeGreaterThan(breakdown.lanePower.MID);
    expect(Math.abs(breakdown.lanePower.TOP - 70)).toBeLessThanOrEqual(12.7);
    expect(breakdown.roles.TOP.laneAdjustment).toBeLessThanOrEqual(12.6);
    expect(breakdown.roles.MID.laneAdjustment).toBeGreaterThanOrEqual(-10.2);
    expect(breakdown.lanePower.TOP - breakdown.lanePower.MID).toBeGreaterThan(
      breakdown.lanePowerBeforeSpread.TOP - breakdown.lanePowerBeforeSpread.MID,
    );
  });

  it('makes support-heavy users clearly support-first without a one-lane spike', () => {
    const calculator = new LanePowerCalculator();

    const breakdown = calculator.calculateDetailed(
      44,
      {
        sampleSize: 34,
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

    expect(breakdown.lanePower.SUPPORT).toBeGreaterThan(breakdown.lanePower.ADC);
    expect(breakdown.lanePower.ADC).toBeGreaterThan(breakdown.lanePower.MID);
    expect(breakdown.lanePower.SUPPORT - breakdown.lanePower.ADC).toBeGreaterThan(8);
    expect(breakdown.lanePower.SUPPORT - breakdown.lanePower.TOP).toBeLessThan(22);
  });
});
