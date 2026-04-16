import { Injectable } from '@nestjs/common';
import { Position } from '@prisma/client';

import { POWER_ROLES, PowerRole } from '../power.constants';

export interface LanePowerRoleBreakdown {
  role: PowerRole;
  lanePower: number;
  laneAdjustment: number;
  matches: number;
  roleShare: number;
  winRate: number;
  kda: number;
  visionScore: number;
  laneInfluence: number;
  roleConfidence: number;
  roleEvidenceFactor: number;
  preferenceBonus: number;
  experienceAdjustment: number;
  proficiencyAdjustment: number;
}

export interface LanePowerBreakdown {
  lanePower: Record<PowerRole, number>;
  laneAdjustments: Record<PowerRole, number>;
  roles: Record<PowerRole, LanePowerRoleBreakdown>;
  formula: string;
}

@Injectable()
export class LanePowerCalculator {
  calculate(
    basePower: number,
    aggregateSummary?: Record<string, unknown> | null,
    primaryPosition?: Position | null,
    secondaryPosition?: Position | null,
  ): Record<PowerRole, number> {
    return this.calculateDetailed(basePower, aggregateSummary, primaryPosition, secondaryPosition)
      .lanePower;
  }

  calculateDetailed(
    basePower: number,
    aggregateSummary?: Record<string, unknown> | null,
    primaryPosition?: Position | null,
    secondaryPosition?: Position | null,
  ): LanePowerBreakdown {
    const laneMetrics = (aggregateSummary?.laneMetrics as Record<string, Record<string, unknown>>) ?? {};
    const sampleSize =
      Number(aggregateSummary?.sampleSize ?? 0) ||
      POWER_ROLES.reduce((sum, role) => sum + Number(laneMetrics[role]?.matches ?? 0), 0);

    const roles = POWER_ROLES.reduce<Record<PowerRole, LanePowerRoleBreakdown>>((acc, role) => {
      const metrics = laneMetrics[role] ?? {};
      const matches = Number(metrics.matches ?? 0);
      const winRate = Number(metrics.winRate ?? 0.5);
      const kda = Number(metrics.kda ?? 2.5);
      const laneInfluence = Number(metrics.laneInfluence ?? 0);
      const visionScore = Number(metrics.visionScore ?? 20);

      const roleShare = sampleSize > 0 ? matches / sampleSize : 0;
      const roleConfidence = this.clamp(matches / 8, 0, 1);
      const roleEvidenceFactor = this.clamp(0.4 + roleConfidence * 0.6, 0.4, 1);
      const preferenceBonus =
        role === primaryPosition ? 4.5 : role === secondaryPosition ? 2 : -2.5;
      const experienceAdjustment = this.clamp(
        (roleShare - 0.2) * 14 * roleConfidence,
        -2.5,
        4.5,
      );
      const visionBaseline = role === Position.SUPPORT ? 24 : 18;
      const visionWeight = role === Position.SUPPORT ? 0.2 : 0.08;
      const proficiencyAdjustment = this.clamp(
        ((winRate - 0.5) * 18 +
          (kda - 2.5) * 2.8 +
          laneInfluence * 0.45 +
          (visionScore - visionBaseline) * visionWeight) *
          roleEvidenceFactor,
        -5,
        5.5,
      );
      const laneAdjustment = this.clamp(
        preferenceBonus + experienceAdjustment + proficiencyAdjustment,
        -6,
        8,
      );

      acc[role] = {
        role,
        lanePower: this.clamp(basePower + laneAdjustment, 0, 100),
        laneAdjustment,
        matches,
        roleShare: Number(roleShare.toFixed(4)),
        winRate: Number(winRate.toFixed(4)),
        kda: Number(kda.toFixed(4)),
        visionScore: Number(visionScore.toFixed(4)),
        laneInfluence: Number(laneInfluence.toFixed(4)),
        roleConfidence,
        roleEvidenceFactor,
        preferenceBonus,
        experienceAdjustment,
        proficiencyAdjustment,
      };
      return acc;
    }, {} as Record<PowerRole, LanePowerRoleBreakdown>);

    return {
      lanePower: POWER_ROLES.reduce<Record<PowerRole, number>>((acc, role) => {
        acc[role] = roles[role].lanePower;
        return acc;
      }, {} as Record<PowerRole, number>),
      laneAdjustments: POWER_ROLES.reduce<Record<PowerRole, number>>((acc, role) => {
        acc[role] = roles[role].laneAdjustment;
        return acc;
      }, {} as Record<PowerRole, number>),
      roles,
      formula: 'lanePower(role) = basePower + clamp(preference + experience + proficiency, -6, +8)',
    };
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, Number(value.toFixed(2))));
  }
}
