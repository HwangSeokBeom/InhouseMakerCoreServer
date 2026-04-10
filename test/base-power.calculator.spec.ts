import { BasePowerCalculator } from '../src/power/calculators/base-power.calculator';

describe('BasePowerCalculator', () => {
  it('applies solo/flex queue weighting with tier and division bonuses', () => {
    const calculator = new BasePowerCalculator();

    const score = calculator.calculate({
      queues: [
        {
          queueType: 'RANKED_SOLO_5x5',
          tier: 'EMERALD',
          rank: 'II',
          lp: 80,
        },
        {
          queueType: 'RANKED_FLEX_SR',
          tier: 'PLATINUM',
          rank: 'I',
          lp: 40,
        },
      ],
    });

    expect(score).toBeCloseTo(69.73, 2);
  });

  it('falls back to primary tier data when queue list is missing', () => {
    const calculator = new BasePowerCalculator();

    const score = calculator.calculate({
      primaryTier: 'GOLD',
      primaryRank: 'I',
      primaryLp: 90,
    });

    expect(score).toBeCloseTo(55.4, 2);
  });
});
