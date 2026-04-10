import { Injectable } from '@nestjs/common';

type LaneRole = 'TOP' | 'JUNGLE' | 'MID' | 'ADC' | 'SUPPORT';

@Injectable()
export class LanePowerCalculator {
  calculate(
    basePower: number,
    aggregateSummary?: Record<string, unknown> | null,
  ): Record<LaneRole, number> {
    const laneMetrics = (aggregateSummary?.laneMetrics as Record<string, Record<string, unknown>>) ?? {};
    const roles: LaneRole[] = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'];

    return roles.reduce<Record<LaneRole, number>>((acc, role) => {
      const metrics = laneMetrics[role] ?? {};
      const matches = Number(metrics.matches ?? 0);
      const winRate = Number(metrics.winRate ?? 0.5);
      const kda = Number(metrics.kda ?? 2.5);
      const laneInfluence = Number(metrics.laneInfluence ?? 0);
      const visionScore = Number(metrics.visionScore ?? 20);

      const laneAdjustment =
        winRate * 12 +
        Math.min(8, kda * 1.8) +
        Math.max(-6, Math.min(6, laneInfluence / 2)) +
        Math.min(6, visionScore / 6) +
        Math.min(4, matches / 3);

      acc[role] = this.clamp(basePower * 0.75 + laneAdjustment, 0, 100);
      return acc;
    }, {} as Record<LaneRole, number>);
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, Number(value.toFixed(2))));
  }
}
