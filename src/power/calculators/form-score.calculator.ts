import { Injectable } from '@nestjs/common';

export interface FormScoreBreakdown {
  score: number;
  recentMatchCount: number;
  recentWinRate: number;
  recentKda: number;
  averageVisionScore: number;
  averageKillParticipation: number;
  sampleConfidence: number;
  winRateAdjustment: number;
  performanceAdjustment: number;
  stabilityAdjustment: number;
  formula: string;
}

@Injectable()
export class FormScoreCalculator {
  calculate(aggregateSummary?: Record<string, unknown> | null): number {
    return this.calculateDetailed(aggregateSummary).score;
  }

  calculateDetailed(aggregateSummary?: Record<string, unknown> | null): FormScoreBreakdown {
    const recentMatchCount = Number(aggregateSummary?.sampleSize ?? 0);
    const recentWinRate = Number(aggregateSummary?.recentWinRate ?? 0.5);
    const recentKda = Number(aggregateSummary?.recentKda ?? 2.5);
    const averageVisionScore = Number(aggregateSummary?.averageVisionScore ?? 20);
    const averageKillParticipation = Number(
      aggregateSummary?.averageKillParticipation ?? 0.5,
    );

    const sampleConfidence = this.clamp(recentMatchCount / 10, 0, 1);
    const winRateAdjustment = this.clamp(
      (recentWinRate - 0.5) * 20 * sampleConfidence,
      -8,
      8,
    );
    const performanceAdjustment = this.clamp(
      ((recentKda - 2.5) * 2.4 +
        (averageKillParticipation - 0.5) * 12 +
        (averageVisionScore - 20) / 5) *
        sampleConfidence,
      -6,
      6,
    );
    const stabilityAdjustment = this.clamp(
      (sampleConfidence - Math.abs(recentWinRate - 0.5)) * 4,
      -2,
      2,
    );

    return {
      score: this.clamp(
        50 + winRateAdjustment * 0.55 + performanceAdjustment * 0.35 + stabilityAdjustment * 0.1,
        42,
        58,
      ),
      recentMatchCount,
      recentWinRate: Number(recentWinRate.toFixed(4)),
      recentKda: Number(recentKda.toFixed(4)),
      averageVisionScore: Number(averageVisionScore.toFixed(4)),
      averageKillParticipation: Number(averageKillParticipation.toFixed(4)),
      sampleConfidence,
      winRateAdjustment,
      performanceAdjustment,
      stabilityAdjustment,
      formula: '50 + 0.55*winRateAdj + 0.35*performanceAdj + 0.10*stabilityAdj (clamped 42-58)',
    };
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, Number(value.toFixed(2))));
  }
}
