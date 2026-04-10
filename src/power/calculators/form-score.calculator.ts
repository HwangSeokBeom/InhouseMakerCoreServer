import { Injectable } from '@nestjs/common';

@Injectable()
export class FormScoreCalculator {
  calculate(aggregateSummary?: Record<string, unknown> | null): number {
    if (!aggregateSummary) {
      return 50;
    }

    const recentWinRate = Number(aggregateSummary.recentWinRate ?? 0.5);
    const recentKda = Number(aggregateSummary.recentKda ?? 2.5);
    const averageVisionScore = Number(aggregateSummary.averageVisionScore ?? 20);
    const averageKillParticipation = Number(
      aggregateSummary.averageKillParticipation ?? 0.5,
    );

    const score =
      40 +
      recentWinRate * 25 +
      Math.min(10, recentKda * 3.5) +
      Math.min(8, averageVisionScore / 5) +
      averageKillParticipation * 17;

    return this.clamp(score, 0, 100);
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, Number(value.toFixed(2))));
  }
}

