import { Injectable } from '@nestjs/common';
import { Position } from '@prisma/client';

import { POWER_ROLES, PowerRole } from '../power.constants';

interface OverallPowerInput {
  basePower: number;
  formScore: number;
  lanePower: Record<PowerRole, number>;
  inhouseRoleMmr: Record<PowerRole, number>;
  confirmedMatchCount: number;
  roleConfirmedMatchCount: Record<PowerRole, number>;
  styleScores: {
    stability: number;
    carry: number;
    teamContribution: number;
    laneInfluence: number;
  };
  primaryPosition?: Position | null;
  secondaryPosition?: Position | null;
}

export interface FinalRolePowerBreakdown {
  role: PowerRole;
  lanePower: number;
  basePowerContribution: number;
  laneContribution: number;
  formContribution: number;
  stabilityContribution: number;
  externalComposite: number;
  externalCompositeBeforeClamp: number;
  inhouseRolePower: number;
  effectiveInhouseWeight: number;
  styleModifier: number;
  finalRolePowerBeforeClamp: number;
  finalRolePower: number;
  finalRolePowerAfterClamp: number;
}

@Injectable()
export class OverallPowerCalculator {
  calculate(input: OverallPowerInput): {
    finalRolePower: Record<PowerRole, number>;
    overallPower: number;
    inhouseConfidence: number;
    inhouseWeight: number;
    roleBreakdown: Record<PowerRole, FinalRolePowerBreakdown>;
    overallBreakdown: {
      primaryRole: PowerRole;
      secondaryRole: PowerRole;
      primaryPower: number;
      secondaryPower: number;
      overallPowerBeforeClamp: number;
      overallPowerAfterClamp: number;
      formula: string;
    };
  } {
    const inhouseWeight = this.resolveInhouseWeight(input.confirmedMatchCount);
    const stabilityContribution = this.clamp((input.styleScores.stability - 50) / 60, -0.85, 0.85);
    const carryContribution = this.clamp((input.styleScores.carry - 50) / 120, -0.42, 0.42);
    const teamContribution = this.clamp(
      (input.styleScores.teamContribution - 50) / 120,
      -0.42,
      0.42,
    );
    const laneInfluenceContribution = this.clamp(
      (input.styleScores.laneInfluence - 50) / 120,
      -0.42,
      0.42,
    );
    const styleModifier = this.clamp(
      stabilityContribution + carryContribution + teamContribution + laneInfluenceContribution,
      -2,
      2,
    );

    const roleBreakdown = POWER_ROLES.reduce<Record<PowerRole, FinalRolePowerBreakdown>>((acc, role) => {
      const roleEvidenceFactor = 0.25 + 0.75 * Math.min(1, input.roleConfirmedMatchCount[role] / 8);
      const effectiveInhouseWeight = this.clamp(inhouseWeight * roleEvidenceFactor, 0, 0.7);
      const basePowerContribution = 0.6 * input.basePower;
      const laneContribution = 0.25 * Number(input.lanePower[role] ?? input.basePower);
      const formContribution = 0.15 * input.formScore;
      const externalCompositeBeforeClamp =
        basePowerContribution + laneContribution + formContribution;
      const externalComposite = this.clamp(externalCompositeBeforeClamp, 0, 100);
      const inhouseRolePower = this.clamp((input.inhouseRoleMmr[role] - 1000) / 10, 0, 100);
      const finalRolePowerBeforeClamp =
        (1 - effectiveInhouseWeight) * externalComposite +
        effectiveInhouseWeight * inhouseRolePower +
        styleModifier;
      const finalRolePowerAfterClamp = this.clamp(finalRolePowerBeforeClamp, 0, 100);

      acc[role] = {
        role,
        lanePower: Number(input.lanePower[role] ?? input.basePower),
        basePowerContribution: Number(basePowerContribution.toFixed(2)),
        laneContribution: Number(laneContribution.toFixed(2)),
        formContribution: Number(formContribution.toFixed(2)),
        stabilityContribution,
        externalComposite,
        externalCompositeBeforeClamp: Number(externalCompositeBeforeClamp.toFixed(2)),
        inhouseRolePower,
        effectiveInhouseWeight,
        styleModifier,
        finalRolePowerBeforeClamp: Number(finalRolePowerBeforeClamp.toFixed(2)),
        finalRolePower: finalRolePowerAfterClamp,
        finalRolePowerAfterClamp,
      };
      return acc;
    }, {} as Record<PowerRole, FinalRolePowerBreakdown>);

    const finalRolePower = POWER_ROLES.reduce<Record<PowerRole, number>>((acc, role) => {
      acc[role] = roleBreakdown[role].finalRolePower;
      return acc;
    }, {} as Record<PowerRole, number>);
    const primaryRole =
      this.normalizeRolePosition(input.primaryPosition) ?? this.resolvePrimaryRole(finalRolePower);
    const secondaryRole =
      this.normalizeRolePosition(input.secondaryPosition) &&
      this.normalizeRolePosition(input.secondaryPosition) !== primaryRole
        ? (this.normalizeRolePosition(input.secondaryPosition) as PowerRole)
        : this.resolveSecondaryRole(primaryRole, finalRolePower);
    const primaryPower = Number(finalRolePower[primaryRole]);
    const secondaryPower = Number(finalRolePower[secondaryRole] ?? primaryPower);
    const overallPowerBeforeClamp = primaryPower * 0.75 + secondaryPower * 0.25;
    const overallPowerAfterClamp = this.clamp(overallPowerBeforeClamp, 0, 100);

    return {
      finalRolePower,
      overallPower: overallPowerAfterClamp,
      inhouseConfidence: this.clamp(input.confirmedMatchCount / 30, 0, 1),
      inhouseWeight,
      roleBreakdown,
      overallBreakdown: {
        primaryRole,
        secondaryRole,
        primaryPower,
        secondaryPower,
        overallPowerBeforeClamp: Number(overallPowerBeforeClamp.toFixed(2)),
        overallPowerAfterClamp,
        formula: 'overallPower = 0.75*primaryRolePower + 0.25*secondaryRolePower',
      },
    };
  }

  private resolveInhouseWeight(confirmedMatchCount: number): number {
    if (confirmedMatchCount >= 30) {
      return 0.7;
    }
    if (confirmedMatchCount >= 20) {
      return 0.55;
    }
    if (confirmedMatchCount >= 10) {
      return 0.4;
    }
    if (confirmedMatchCount >= 5) {
      return 0.25;
    }
    return 0.15;
  }

  private resolvePrimaryRole(finalRolePower: Record<PowerRole, number>): PowerRole {
    return POWER_ROLES.reduce((bestRole, role) =>
      finalRolePower[role] > finalRolePower[bestRole] ? role : bestRole,
    POWER_ROLES[0]);
  }

  private resolveSecondaryRole(
    primaryRole: PowerRole,
    finalRolePower: Record<PowerRole, number>,
  ): PowerRole {
    return POWER_ROLES.filter((role) => role !== primaryRole).reduce((bestRole, role) =>
      finalRolePower[role] > finalRolePower[bestRole] ? role : bestRole,
    POWER_ROLES.find((role) => role !== primaryRole) ?? POWER_ROLES[0]);
  }

  private normalizeRolePosition(position?: Position | null): PowerRole | null {
    return POWER_ROLES.includes(position as PowerRole) ? (position as PowerRole) : null;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, Number(value.toFixed(2))));
  }
}
