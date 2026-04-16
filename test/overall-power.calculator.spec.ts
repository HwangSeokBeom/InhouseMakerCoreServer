import { Position } from '@prisma/client';

import { OverallPowerCalculator } from '../src/power/calculators/overall-power.calculator';

describe('OverallPowerCalculator', () => {
  it('leans on primary and secondary roles while keeping off-role inhouse weight lower', () => {
    const calculator = new OverallPowerCalculator();

    const result = calculator.calculate({
      basePower: 71,
      formScore: 54,
      lanePower: {
        TOP: 77,
        JUNGLE: 72,
        MID: 66,
        ADC: 64,
        SUPPORT: 62,
      },
      inhouseRoleMmr: {
        TOP: 1840,
        JUNGLE: 1700,
        MID: 1550,
        ADC: 1520,
        SUPPORT: 1500,
      },
      confirmedMatchCount: 24,
      roleConfirmedMatchCount: {
        TOP: 12,
        JUNGLE: 6,
        MID: 2,
        ADC: 0,
        SUPPORT: 0,
      },
      styleScores: {
        stability: 56,
        carry: 58,
        teamContribution: 55,
        laneInfluence: 57,
      },
      primaryPosition: Position.TOP,
      secondaryPosition: Position.JUNGLE,
    });

    expect(result.inhouseWeight).toBe(0.55);
    expect(result.roleBreakdown.TOP.effectiveInhouseWeight).toBeGreaterThan(
      result.roleBreakdown.SUPPORT.effectiveInhouseWeight,
    );
    expect(result.finalRolePower.TOP).toBeGreaterThan(result.finalRolePower.MID);
    expect(result.overallPower).toBeGreaterThanOrEqual(result.finalRolePower.JUNGLE);
  });
});
