import { Position } from '@prisma/client';

import {
  LaneAutoAssignmentEvidenceInput,
  resolveLaneAutoAssignment,
} from '../src/power/power-profile.contract';

describe('resolveLaneAutoAssignment secondary evidence gate', () => {
  const evidence = (
    sampleSize: number,
    roles: Partial<Record<Position, { matches: number }>>,
  ): LaneAutoAssignmentEvidenceInput => ({
    sampleSize,
    roles: Object.fromEntries(
      Object.entries(roles).map(([role, value]) => [
        role,
        {
          matches: value.matches,
          roleShare: Number((value.matches / sampleSize).toFixed(4)),
          recentShare: Number((value.matches / sampleSize).toFixed(4)),
          roleConfidence: Math.min(1, Number((value.matches / 6.5).toFixed(4))),
        },
      ]),
    ) as LaneAutoAssignmentEvidenceInput['roles'],
  });

  it('keeps secondaryPosition for a clear dual-position user', () => {
    const result = resolveLaneAutoAssignment(
      {
        [Position.TOP]: 59,
        [Position.JUNGLE]: 72,
        [Position.MID]: 75,
        [Position.ADC]: 60,
        [Position.SUPPORT]: 58,
      },
      null,
      null,
      {
        evidence: evidence(30, {
          [Position.MID]: { matches: 16 },
          [Position.JUNGLE]: { matches: 9 },
          [Position.ADC]: { matches: 3 },
        }),
      },
    );

    expect(result.primaryPosition).toBe(Position.MID);
    expect(result.secondaryPosition).toBe(Position.JUNGLE);
    expect(result.secondaryAccepted).toBe(true);
    expect(result.decisionSource).toBe('auto_dual_role');
  });

  it('withholds secondaryPosition for a one-line user', () => {
    const result = resolveLaneAutoAssignment(
      {
        [Position.TOP]: 58,
        [Position.JUNGLE]: 57,
        [Position.MID]: 60,
        [Position.ADC]: 68,
        [Position.SUPPORT]: 78,
      },
      null,
      null,
      {
        evidence: evidence(30, {
          [Position.SUPPORT]: { matches: 26 },
          [Position.ADC]: { matches: 2 },
          [Position.MID]: { matches: 1 },
        }),
      },
    );

    expect(result.primaryPosition).toBe(Position.SUPPORT);
    expect(result.secondaryPosition).toBeNull();
    expect(result.secondaryAccepted).toBe(false);
    expect(result.decisionSource).toBe('auto_low_evidence');
  });

  it('withholds lane-power second place when recent role evidence is weak', () => {
    const result = resolveLaneAutoAssignment(
      {
        [Position.TOP]: 70,
        [Position.JUNGLE]: 75,
        [Position.MID]: 71,
        [Position.ADC]: 72,
        [Position.SUPPORT]: 69,
      },
      null,
      null,
      {
        evidence: evidence(25, {
          [Position.JUNGLE]: { matches: 18 },
          [Position.ADC]: { matches: 1 },
          [Position.MID]: { matches: 2 },
          [Position.TOP]: { matches: 2 },
          [Position.SUPPORT]: { matches: 2 },
        }),
      },
    );

    expect(result.primaryPosition).toBe(Position.JUNGLE);
    expect(result.secondaryCandidate).toBe(Position.ADC);
    expect(result.secondaryPosition).toBeNull();
    expect(result.secondaryRejectedReason).toBe('low_role_evidence');
  });

  it('withholds secondaryPosition when primary-secondary and secondary-third gaps are both ambiguous', () => {
    const result = resolveLaneAutoAssignment(
      {
        [Position.TOP]: 47.5,
        [Position.JUNGLE]: 51,
        [Position.MID]: 50,
        [Position.ADC]: 50.3,
        [Position.SUPPORT]: 47,
      },
      null,
      null,
      {
        evidence: evidence(30, {
          [Position.JUNGLE]: { matches: 14 },
          [Position.ADC]: { matches: 5 },
          [Position.MID]: { matches: 5 },
        }),
      },
    );

    expect(result.primaryPosition).toBe(Position.JUNGLE);
    expect(result.secondaryPosition).toBeNull();
    expect(result.decisionSource).toBe('auto_flat_distribution');
    expect(result.scoreGap.primaryToSecondary).toBeLessThan(2.5);
    expect(result.scoreGap.secondaryToThird).toBeLessThan(1.15);
  });

  it('withholds secondaryPosition when the total lane spread is too small', () => {
    const result = resolveLaneAutoAssignment(
      {
        [Position.TOP]: 50.2,
        [Position.JUNGLE]: 50,
        [Position.MID]: 50.9,
        [Position.ADC]: 50.5,
        [Position.SUPPORT]: 49.8,
      },
      null,
      null,
      {
        evidence: evidence(30, {
          [Position.MID]: { matches: 14 },
          [Position.ADC]: { matches: 8 },
          [Position.TOP]: { matches: 4 },
        }),
      },
    );

    expect(result.primaryPosition).toBe(Position.MID);
    expect(result.secondaryPosition).toBeNull();
    expect(result.secondaryRejectedReason).toBe('flat_distribution');
  });

  it('regresses flat JGL 51 / ADC 49 / MID 49 case to no forced ADC secondary', () => {
    const result = resolveLaneAutoAssignment(
      {
        [Position.TOP]: 47,
        [Position.JUNGLE]: 51,
        [Position.MID]: 49,
        [Position.ADC]: 49,
        [Position.SUPPORT]: 46,
      },
      null,
      null,
      {
        evidence: evidence(30, {
          [Position.JUNGLE]: { matches: 17 },
          [Position.ADC]: { matches: 3 },
          [Position.MID]: { matches: 3 },
        }),
      },
    );

    expect(result.primaryPosition).toBe(Position.JUNGLE);
    expect(result.secondaryPosition).toBeNull();
  });

  it('regresses ADC 59 / JGL 54 tie cluster to no forced JGL secondary', () => {
    const result = resolveLaneAutoAssignment(
      {
        [Position.TOP]: 53,
        [Position.JUNGLE]: 54,
        [Position.MID]: 54,
        [Position.ADC]: 59,
        [Position.SUPPORT]: 54,
      },
      null,
      null,
      {
        evidence: evidence(30, {
          [Position.ADC]: { matches: 18 },
          [Position.JUNGLE]: { matches: 2 },
          [Position.MID]: { matches: 4 },
          [Position.SUPPORT]: { matches: 4 },
        }),
      },
    );

    expect(result.primaryPosition).toBe(Position.ADC);
    expect(result.secondaryPosition).toBeNull();
    expect(result.decisionSource).toBe('auto_low_evidence');
  });

  it('can skip an unsupported second-place lane and accept a stronger evidence-backed candidate', () => {
    const result = resolveLaneAutoAssignment(
      {
        [Position.TOP]: 47,
        [Position.JUNGLE]: 52,
        [Position.MID]: 50,
        [Position.ADC]: 50.2,
        [Position.SUPPORT]: 46,
      },
      null,
      null,
      {
        evidence: evidence(30, {
          [Position.JUNGLE]: { matches: 16 },
          [Position.ADC]: { matches: 1 },
          [Position.MID]: { matches: 9 },
          [Position.TOP]: { matches: 2 },
        }),
      },
    );

    expect(result.primaryPosition).toBe(Position.JUNGLE);
    expect(result.secondaryCandidate).toBe(Position.ADC);
    expect(result.secondaryPosition).toBe(Position.MID);
    expect(result.secondaryCandidateEvaluations.map((item) => item.candidate)).toEqual([
      Position.ADC,
      Position.MID,
    ]);
  });
});
