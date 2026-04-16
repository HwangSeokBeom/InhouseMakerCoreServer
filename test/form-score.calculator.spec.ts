import { FormScoreCalculator } from '../src/power/calculators/form-score.calculator';

describe('FormScoreCalculator', () => {
  it('keeps form score as a bounded modifier instead of a new baseline', () => {
    const calculator = new FormScoreCalculator();

    const hot = calculator.calculateDetailed({
      sampleSize: 10,
      recentWinRate: 0.8,
      recentKda: 4.2,
      averageVisionScore: 28,
      averageKillParticipation: 0.68,
    });
    const weakSample = calculator.calculateDetailed({
      sampleSize: 2,
      recentWinRate: 1,
      recentKda: 8,
      averageVisionScore: 35,
      averageKillParticipation: 0.9,
    });

    expect(hot.score).toBeGreaterThan(50);
    expect(hot.score).toBeLessThanOrEqual(58);
    expect(weakSample.score).toBeLessThan(hot.score);
    expect(weakSample.score).toBeGreaterThanOrEqual(49);
  });
});
