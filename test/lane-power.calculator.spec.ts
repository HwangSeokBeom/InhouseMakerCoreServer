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
    expect(Math.abs(breakdown.lanePower.TOP - 70)).toBeLessThanOrEqual(8.01);
    expect(breakdown.roles.TOP.laneAdjustment).toBeLessThanOrEqual(8);
    expect(breakdown.roles.MID.laneAdjustment).toBeGreaterThanOrEqual(-6);
  });
});
