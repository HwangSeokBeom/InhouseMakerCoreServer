import { Injectable } from '@nestjs/common';

@Injectable()
export class StyleScoreCalculator {
  calculate(aggregateSummary?: Record<string, unknown> | null): {
    stability: number;
    carry: number;
    teamContribution: number;
    laneInfluence: number;
  } {
    const recentKda = Number(aggregateSummary?.recentKda ?? 2.5);
    const recentWinRate = Number(aggregateSummary?.recentWinRate ?? 0.5);
    const averageVisionScore = Number(aggregateSummary?.averageVisionScore ?? 20);
    const averageKillParticipation = Number(
      aggregateSummary?.averageKillParticipation ?? 0.5,
    );

    return {
      stability: this.clamp(45 + Math.min(25, recentKda * 6), 0, 100),
      carry: this.clamp(40 + recentWinRate * 20 + averageKillParticipation * 25, 0, 100),
      teamContribution: this.clamp(
        35 + averageVisionScore * 1.2 + averageKillParticipation * 20,
        0,
        100,
      ),
      laneInfluence: this.clamp(35 + averageKillParticipation * 20 + recentWinRate * 18, 0, 100),
    };
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, Number(value.toFixed(2))));
  }
}

