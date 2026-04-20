import { Injectable } from '@nestjs/common';
import { Position } from '@prisma/client';

import { POWER_ROLES, PowerRole } from '../power.constants';

export interface LanePowerRoleBreakdown {
  role: PowerRole;
  lanePower: number;
  lanePowerBeforeSpread: number;
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
  spreadAdjustment: number;
}

export interface LanePowerBreakdown {
  lanePower: Record<PowerRole, number>;
  laneAdjustments: Record<PowerRole, number>;
  lanePowerBeforeSpread: Record<PowerRole, number>;
  spreadAdjustments: Record<PowerRole, number>;
  spreadMultiplier: number;
  roles: Record<PowerRole, LanePowerRoleBreakdown>;
  formula: string;
}

@Injectable()
export class LanePowerCalculator {
  private readonly spreadMultiplier = 1.28;

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
      const roleConfidence = this.clamp(matches / 6.5, 0, 1);
      const roleEvidenceFactor = this.clamp(0.3 + roleConfidence * 0.7, 0.3, 1);
      const preferenceBonus =
        role === primaryPosition ? 6.2 : role === secondaryPosition ? 2.8 : -3.6;
      const experienceAdjustment = this.clamp(
        (roleShare - 0.18) * 20 * roleConfidence,
        -4.2,
        6.8,
      );
      const visionBaseline = role === Position.SUPPORT ? 24 : 18;
      const visionWeight = role === Position.SUPPORT ? 0.24 : 0.1;
      const proficiencyAdjustment = this.clamp(
        ((winRate - 0.5) * 22 +
          (kda - 2.5) * 3.2 +
          laneInfluence * 0.55 +
          (visionScore - visionBaseline) * visionWeight) *
          roleEvidenceFactor,
        -6.8,
        7.6,
      );
      const laneAdjustment = this.clamp(
        preferenceBonus + experienceAdjustment + proficiencyAdjustment,
        -8.4,
        10.8,
      );
      const lanePowerBeforeSpread = this.clamp(basePower + laneAdjustment, 0, 100);

      acc[role] = {
        role,
        lanePower: lanePowerBeforeSpread,
        lanePowerBeforeSpread,
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
        spreadAdjustment: 0,
      };
      return acc;
    }, {} as Record<PowerRole, LanePowerRoleBreakdown>);
    const averageLanePower =
      POWER_ROLES.reduce((sum, role) => sum + roles[role].lanePowerBeforeSpread, 0) /
      POWER_ROLES.length;

    for (const role of POWER_ROLES) {
      const before = roles[role].lanePowerBeforeSpread;
      const after = this.clamp(
        averageLanePower + (before - averageLanePower) * this.spreadMultiplier,
        0,
        100,
      );
      const spreadAdjustment = this.clamp(after - before, -2.8, 2.8);
      const boundedSpreadAdjustment = this.clamp(spreadAdjustment, -1.8, 1.8);

      roles[role].lanePower = this.clamp(before + boundedSpreadAdjustment, 0, 100);
      roles[role].spreadAdjustment = boundedSpreadAdjustment;
      roles[role].laneAdjustment = this.clamp(
        roles[role].laneAdjustment + boundedSpreadAdjustment,
        -10.2,
        12.6,
      );
    }

    return {
      lanePower: POWER_ROLES.reduce<Record<PowerRole, number>>((acc, role) => {
        acc[role] = roles[role].lanePower;
        return acc;
      }, {} as Record<PowerRole, number>),
      laneAdjustments: POWER_ROLES.reduce<Record<PowerRole, number>>((acc, role) => {
        acc[role] = roles[role].laneAdjustment;
        return acc;
      }, {} as Record<PowerRole, number>),
      lanePowerBeforeSpread: POWER_ROLES.reduce<Record<PowerRole, number>>((acc, role) => {
        acc[role] = roles[role].lanePowerBeforeSpread;
        return acc;
      }, {} as Record<PowerRole, number>),
      spreadAdjustments: POWER_ROLES.reduce<Record<PowerRole, number>>((acc, role) => {
        acc[role] = roles[role].spreadAdjustment;
        return acc;
      }, {} as Record<PowerRole, number>),
      spreadMultiplier: this.spreadMultiplier,
      roles,
      formula:
        'lanePower(role) = basePower + clamp(preference + experience + proficiency, -8.4, +10.8), then apply 1.28x spread around lane average',
    };
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, Number(value.toFixed(2))));
  }
}
