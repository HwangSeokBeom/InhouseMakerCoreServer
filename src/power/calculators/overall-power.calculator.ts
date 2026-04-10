import { Injectable } from '@nestjs/common';
import { Position } from '@prisma/client';

interface OverallPowerInput {
  basePower: number;
  formScore: number;
  lanePower: Record<string, number>;
  inhouseMmr: number;
  confirmedMatchCount: number;
  styleScores: {
    stability: number;
    carry: number;
    teamContribution: number;
    laneInfluence: number;
  };
  primaryPosition?: Position | null;
  secondaryPosition?: Position | null;
}

@Injectable()
export class OverallPowerCalculator {
  calculate(input: OverallPowerInput): {
    finalRolePower: Record<string, number>;
    overallPower: number;
    inhouseConfidence: number;
  } {
    const roles = [Position.TOP, Position.JUNGLE, Position.MID, Position.ADC, Position.SUPPORT];
    const inhouseWeight = Math.min(0.7, 0.15 + 0.02 * input.confirmedMatchCount);
    const inhouseRolePower = this.clamp((input.inhouseMmr - 1200) / 4, 0, 100);
    const styleModifier =
      ((input.styleScores.stability +
        input.styleScores.carry +
        input.styleScores.teamContribution +
        input.styleScores.laneInfluence) /
        4 -
        50) /
      10;

    const finalRolePower = roles.reduce<Record<string, number>>((acc, role) => {
      const externalComposite =
        0.45 * input.basePower +
        0.35 * Number(input.lanePower[role] ?? input.basePower) +
        0.2 * input.formScore;

      acc[role] = this.clamp(
        (1 - inhouseWeight) * externalComposite + inhouseWeight * inhouseRolePower + styleModifier,
        0,
        100,
      );
      return acc;
    }, {});

    const primaryPower = Number(
      finalRolePower[input.primaryPosition ?? Position.MID] ?? this.average(Object.values(finalRolePower)),
    );
    const secondaryPower = input.secondaryPosition
      ? Number(finalRolePower[input.secondaryPosition] ?? primaryPower)
      : primaryPower;
    const averagePower = this.average(Object.values(finalRolePower));

    return {
      finalRolePower,
      overallPower: this.clamp(primaryPower * 0.5 + secondaryPower * 0.25 + averagePower * 0.25, 0, 100),
      inhouseConfidence: this.clamp(input.confirmedMatchCount / 30, 0, 1),
    };
  }

  private average(values: number[]): number {
    if (values.length === 0) {
      return 0;
    }
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, Number(value.toFixed(2))));
  }
}

