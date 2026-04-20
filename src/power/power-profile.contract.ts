import { Position } from '@prisma/client';

import { POWER_ROLES, PowerRole } from './power.constants';

const DEFAULT_STYLE_BASELINE = 50;
const ROLE_FOCUS_FALLBACK = Position.MID;
const ROLE_PRIORITY: PowerRole[] = [
  Position.MID,
  Position.ADC,
  Position.TOP,
  Position.JUNGLE,
  Position.SUPPORT,
];
const SECONDARY_AUTO_THRESHOLDS = {
  minSampleSize: 8,
  minSecondaryMatches: 4,
  minSecondaryRecentShare: 0.16,
  minSecondaryRoleConfidence: 0.45,
  strongSecondaryMatches: 6,
  strongSecondaryRecentShare: 0.24,
  strongSecondaryRoleConfidence: 0.6,
  minTotalSpread: 5.5,
  minTotalSpreadWithoutStrongEvidence: 7,
  minSecondaryToThirdGap: 1.15,
  ambiguousPrimaryToSecondaryGap: 2.5,
  ambiguousSecondaryToThirdGap: 1,
  offRolePenaltyPreferenceBonus: -1,
  offRoleLowMatches: 3,
  offRoleLowRecentShare: 0.14,
} as const;

export interface PowerProfileStyleShape {
  stability: number;
  carry: number;
  teamContribution: number;
  laneInfluence: number;
  roleFocus: PowerRole;
  seeded?: boolean;
}

export interface LaneAutoAssignmentRoleEvidence {
  matches: number;
  matchCount: number;
  roleShare: number;
  recentShare: number;
  roleConfidence: number;
  roleEvidenceFactor: number;
  repeatedRecentRole: boolean;
  preferredLane: PowerRole | null;
  rankedPreferredLane: PowerRole | null;
  championPoolAlignment: 'aligned' | 'weak' | 'unknown';
  championPoolShare: number | null;
  preferenceBonus: number | null;
  experienceAdjustment: number | null;
  proficiencyAdjustment: number | null;
  spreadAdjustment: number | null;
}

export interface LaneAutoAssignmentEvidenceInput {
  sampleSize: number;
  roles: Partial<Record<PowerRole, Partial<LaneAutoAssignmentRoleEvidence>>>;
}

export interface LaneAutoAssignmentCandidateEvaluation {
  candidate: PowerRole;
  accepted: boolean;
  rejectedReason: string | null;
  primaryToSecondaryGap: number | null;
  secondaryToThirdGap: number | null;
  totalSpread: number;
  secondaryRoleEvidence: LaneAutoAssignmentRoleEvidence;
  hasBasicEvidence: boolean;
  hasStrongEvidence: boolean;
  scoreDistinctEnough: boolean;
  offRolePenaltyRisk: boolean;
}

export interface ResolveLaneAutoAssignmentOptions {
  evidence?: LaneAutoAssignmentEvidenceInput | null;
}

export type LaneAutoAssignmentDecisionSource =
  | 'manual'
  | 'manual_primary_auto_secondary'
  | 'auto_dual_role'
  | 'auto_primary_only'
  | 'auto_flat_distribution'
  | 'auto_low_evidence';

export interface LaneAutoAssignmentShape {
  primaryPosition: PowerRole;
  secondaryPosition: PowerRole | null;
  source: LaneAutoAssignmentDecisionSource;
  decisionSource: LaneAutoAssignmentDecisionSource;
  reason: string;
  secondaryCandidate: PowerRole | null;
  secondaryAccepted: boolean;
  secondaryRejectedReason: string | null;
  secondaryRoleEvidence: LaneAutoAssignmentRoleEvidence | null;
  secondaryCandidateEvaluations: LaneAutoAssignmentCandidateEvaluation[];
  laneScores: Record<PowerRole, number>;
  rankedRoles: Array<{
    role: PowerRole;
    score: number;
  }>;
  scoreGap: {
    primaryToSecondary: number | null;
    secondaryToThird: number | null;
    totalSpread: number;
  };
  thresholds: typeof SECONDARY_AUTO_THRESHOLDS;
}

export function buildDefaultLanePower(overallPower: number): Record<PowerRole, number> {
  return {
    [Position.TOP]: overallPower,
    [Position.JUNGLE]: overallPower,
    [Position.MID]: overallPower,
    [Position.ADC]: overallPower,
    [Position.SUPPORT]: overallPower,
  };
}

export function normalizeLanePower(
  overallPower: number,
  lanePower: unknown,
): Record<PowerRole, number> {
  const defaults = buildDefaultLanePower(overallPower);
  const raw =
    lanePower && typeof lanePower === 'object'
      ? (lanePower as Record<string, unknown>)
      : {};

  return POWER_ROLES.reduce<Record<PowerRole, number>>((acc, role) => {
    acc[role] = normalizePercent(raw[role], defaults[role]);
    return acc;
  }, {} as Record<PowerRole, number>);
}

export function resolveRoleFocus(
  primaryPosition: Position | null | undefined,
  lanePower: Record<PowerRole, number>,
  style?: unknown,
): PowerRole {
  const rawStyle =
    style && typeof style === 'object'
      ? (style as Record<string, unknown>)
      : null;

  if (isPowerRole(rawStyle?.roleFocus)) {
    return rawStyle.roleFocus;
  }

  if (primaryPosition && isPowerRole(primaryPosition)) {
    return primaryPosition;
  }

  return rankRolesByPower(lanePower)[0] ?? ROLE_FOCUS_FALLBACK;
}

export function normalizeStyleScores(
  style: unknown,
  input: {
    overallPower: number;
    lanePower: Record<PowerRole, number>;
    primaryPosition?: Position | null;
  },
): PowerProfileStyleShape {
  const rawStyle =
    style && typeof style === 'object'
      ? (style as Record<string, unknown>)
      : {};
  const roleFocus = resolveRoleFocus(input.primaryPosition, input.lanePower, rawStyle);
  const seeded = rawStyle.seeded === true;
  const defaults = buildDefaultStyleScores({
    overallPower: input.overallPower,
    lanePower: input.lanePower,
    roleFocus,
  });

  return {
    stability: normalizePercent(rawStyle.stability, defaults.stability),
    carry: normalizePercent(rawStyle.carry, defaults.carry),
    teamContribution: normalizePercent(
      rawStyle.teamContribution,
      defaults.teamContribution,
    ),
    laneInfluence: normalizePercent(rawStyle.laneInfluence, defaults.laneInfluence),
    roleFocus,
    ...(seeded ? { seeded: true } : {}),
  };
}

export function buildDefaultStyleScores(input: {
  overallPower: number;
  lanePower: Record<PowerRole, number>;
  roleFocus: PowerRole;
}): PowerProfileStyleShape {
  const focusPower = input.lanePower[input.roleFocus] ?? input.overallPower;
  const laneValues = Object.values(input.lanePower);
  const laneAverage =
    laneValues.length > 0
      ? laneValues.reduce((sum, value) => sum + value, 0) / laneValues.length
      : input.overallPower;
  const roleGap = focusPower - laneAverage;
  const focusBias = roleFocusBias(input.roleFocus);

  return {
    stability: normalizePercent(
      DEFAULT_STYLE_BASELINE + (input.overallPower - 50) * 0.4 + roleGap * 0.3,
      DEFAULT_STYLE_BASELINE,
    ),
    carry: normalizePercent(
      DEFAULT_STYLE_BASELINE + (focusPower - 50) * 0.65 + focusBias.carry,
      DEFAULT_STYLE_BASELINE,
    ),
    teamContribution: normalizePercent(
      DEFAULT_STYLE_BASELINE + (input.overallPower - 50) * 0.3 + focusBias.teamContribution,
      DEFAULT_STYLE_BASELINE,
    ),
    laneInfluence: normalizePercent(
      DEFAULT_STYLE_BASELINE + (focusPower - 50) * 0.55 + focusBias.laneInfluence,
      DEFAULT_STYLE_BASELINE,
    ),
    roleFocus: input.roleFocus,
  };
}

export function buildPowerProfileDisplayScore(input: {
  overallPower: number;
  version: string;
  calculatedAt: Date;
  seeded?: boolean;
}): Record<string, unknown> {
  return {
    sourceField: 'overallPower',
    serverStoredOverallPower: Number(input.overallPower.toFixed(2)),
    dtoOverallPower: Number(input.overallPower.toFixed(2)),
    clientDisplayRaw: Number(input.overallPower.toFixed(2)),
    clientDisplayRounded: Math.round(input.overallPower),
    roundingMode: 'rounded()',
    profileVersion: input.version,
    profileCalculatedAt: input.calculatedAt.toISOString(),
    ...(input.seeded ? { seeded: true } : {}),
  };
}

export function resolveLaneAutoAssignment(
  lanePower: Record<PowerRole, number>,
  manualPrimaryPosition?: Position | null,
  manualSecondaryPosition?: Position | null,
  options: ResolveLaneAutoAssignmentOptions = {},
): LaneAutoAssignmentShape {
  const rankedRoles = rankRolesByPower(lanePower);
  const rankedRoleScores = rankedRoles.map((role) => ({
    role,
    score: normalizePercent(lanePower[role], 50),
  }));
  const manualPrimary = isPowerRole(manualPrimaryPosition) ? manualPrimaryPosition : null;
  const manualSecondary =
    isPowerRole(manualSecondaryPosition) && manualSecondaryPosition !== manualPrimary
      ? manualSecondaryPosition
      : null;
  const primaryPosition = manualPrimary ?? rankedRoles[0] ?? ROLE_FOCUS_FALLBACK;
  const values = POWER_ROLES.map((role) => normalizePercent(lanePower[role], 50));
  const totalSpread = Math.max(...values) - Math.min(...values);
  const autoCandidates = rankedRoles.filter((role) => role !== primaryPosition);
  const secondaryCandidate = manualSecondary ?? autoCandidates[0] ?? null;
  const candidateEvaluations = manualSecondary
    ? []
    : evaluateAutoSecondaryCandidates({
        primaryPosition,
        candidates: autoCandidates,
        lanePower,
        rankedRoles,
        totalSpread,
        evidence: options.evidence ?? null,
      });
  const acceptedEvaluation = candidateEvaluations.find((evaluation) => evaluation.accepted) ?? null;
  const secondaryPosition = manualSecondary ?? acceptedEvaluation?.candidate ?? null;
  const firstRejectedEvaluation =
    candidateEvaluations.find((evaluation) => !evaluation.accepted) ?? null;
  const secondaryRejectedReason =
    manualSecondary || secondaryPosition
      ? null
      : firstRejectedEvaluation?.rejectedReason ?? 'no_secondary_candidate';
  const firstAutoCandidate = autoCandidates[0] ?? null;
  const thirdRole =
    firstAutoCandidate !== null
      ? autoCandidates.find((role) => role !== firstAutoCandidate) ?? null
      : null;
  const primaryToSecondary =
    firstAutoCandidate !== null
      ? Number((lanePower[primaryPosition] - lanePower[firstAutoCandidate]).toFixed(2))
      : null;
  const secondaryToThird =
    firstAutoCandidate !== null && thirdRole !== null
      ? Number((lanePower[firstAutoCandidate] - lanePower[thirdRole]).toFixed(2))
      : null;
  const decisionSource = resolveLaneAssignmentDecisionSource({
    manualPrimary,
    manualSecondary,
    secondaryPosition,
    secondaryRejectedReason,
  });
  const secondaryRoleEvidence =
    manualSecondary && secondaryCandidate
      ? buildRoleEvidence(secondaryCandidate, options.evidence ?? null)
      : acceptedEvaluation?.secondaryRoleEvidence ??
        firstRejectedEvaluation?.secondaryRoleEvidence ??
        (secondaryCandidate ? buildRoleEvidence(secondaryCandidate, options.evidence ?? null) : null);

  return {
    primaryPosition,
    secondaryPosition,
    source: decisionSource,
    decisionSource,
    reason:
      decisionSource === 'manual'
        ? 'Manual primary and secondary positions are valid and preserved.'
        : decisionSource === 'manual_primary_auto_secondary'
          ? `Manual primary position is preserved; secondary position is selected from lane power with reliable role evidence (spread ${Number(totalSpread.toFixed(2))}).`
        : secondaryPosition
            ? `Secondary position is accepted because lane power and recent role evidence both support ${secondaryPosition} (spread ${Number(totalSpread.toFixed(2))}, primary-secondary ${primaryToSecondary ?? 'n/a'}, secondary-third ${secondaryToThird ?? 'n/a'}).`
            : `Secondary position is withheld because ${secondaryRejectedReason ?? 'no reliable secondary evidence'} (spread ${Number(totalSpread.toFixed(2))}, primary-secondary ${primaryToSecondary ?? 'n/a'}, secondary-third ${secondaryToThird ?? 'n/a'}).`,
    secondaryCandidate,
    secondaryAccepted: secondaryPosition !== null,
    secondaryRejectedReason,
    secondaryRoleEvidence,
    secondaryCandidateEvaluations: candidateEvaluations,
    laneScores: POWER_ROLES.reduce<Record<PowerRole, number>>((acc, role) => {
      acc[role] = normalizePercent(lanePower[role], 50);
      return acc;
    }, {} as Record<PowerRole, number>),
    rankedRoles: rankedRoleScores,
    scoreGap: {
      primaryToSecondary,
      secondaryToThird,
      totalSpread: Number(totalSpread.toFixed(2)),
    },
    thresholds: SECONDARY_AUTO_THRESHOLDS,
  };
}

export function rankRolesByPower(lanePower: Record<PowerRole, number>): PowerRole[] {
  return [...POWER_ROLES].sort((left, right) => {
    const diff = lanePower[right] - lanePower[left];
    if (diff !== 0) {
      return diff;
    }

    return ROLE_PRIORITY.indexOf(left) - ROLE_PRIORITY.indexOf(right);
  });
}

export function extractLaneAutoAssignmentEvidence(
  raw: unknown,
): LaneAutoAssignmentEvidenceInput | null {
  const root = toRecord(raw);
  if (!root) {
    return null;
  }

  const lanePowerBreakdown = toRecord(root.lanePower);
  const evidenceSource = lanePowerBreakdown ?? root;
  const rawRoles = toRecord(evidenceSource.roles) ?? toRecord(evidenceSource.laneMetrics);
  if (!rawRoles) {
    return null;
  }

  const roles = POWER_ROLES.reduce<Partial<Record<PowerRole, Partial<LaneAutoAssignmentRoleEvidence>>>>(
    (acc, role) => {
      const roleEvidence = toRecord(rawRoles[role]);
      if (roleEvidence) {
        const extracted: Partial<LaneAutoAssignmentRoleEvidence> = {
          matches: toFiniteNumber(roleEvidence.matches, 0),
          matchCount: toFiniteNumber(roleEvidence.matchCount ?? roleEvidence.matches, 0),
          roleConfidence: toFiniteNumber(roleEvidence.roleConfidence, 0),
          roleEvidenceFactor: toFiniteNumber(roleEvidence.roleEvidenceFactor, 0),
          preferenceBonus: toNullableNumber(roleEvidence.preferenceBonus),
          experienceAdjustment: toNullableNumber(roleEvidence.experienceAdjustment),
          proficiencyAdjustment: toNullableNumber(roleEvidence.proficiencyAdjustment),
          spreadAdjustment: toNullableNumber(roleEvidence.spreadAdjustment),
        };
        if (roleEvidence.roleShare !== undefined) {
          extracted.roleShare = normalizeShare(roleEvidence.roleShare, 0);
        }
        if (roleEvidence.recentShare !== undefined || roleEvidence.roleShare !== undefined) {
          extracted.recentShare = normalizeShare(
            roleEvidence.recentShare ?? roleEvidence.roleShare,
            0,
          );
        }
        acc[role] = extracted;
      }
      return acc;
    },
    {},
  );
  const explicitSampleSize = toFiniteNumber(evidenceSource.sampleSize ?? root.sampleSize, 0);
  const inferredSampleSize = POWER_ROLES.reduce(
    (sum, role) => sum + toFiniteNumber(roles[role]?.matches, 0),
    0,
  );

  return {
    sampleSize: explicitSampleSize > 0 ? explicitSampleSize : inferredSampleSize,
    roles,
  };
}

function evaluateAutoSecondaryCandidates(input: {
  primaryPosition: PowerRole;
  candidates: PowerRole[];
  rankedRoles: PowerRole[];
  lanePower: Record<PowerRole, number>;
  totalSpread: number;
  evidence: LaneAutoAssignmentEvidenceInput | null;
}): LaneAutoAssignmentCandidateEvaluation[] {
  const evaluations: LaneAutoAssignmentCandidateEvaluation[] = [];

  for (const candidate of input.candidates) {
    const evaluation = evaluateAutoSecondaryCandidate({
      primaryPosition: input.primaryPosition,
      candidate,
      rankedRoles: input.rankedRoles,
      lanePower: input.lanePower,
      totalSpread: input.totalSpread,
      evidence: input.evidence,
    });
    evaluations.push(evaluation);

    if (evaluation.accepted) {
      break;
    }
  }

  return evaluations;
}

function evaluateAutoSecondaryCandidate(input: {
  primaryPosition: PowerRole;
  candidate: PowerRole;
  rankedRoles: PowerRole[];
  lanePower: Record<PowerRole, number>;
  totalSpread: number;
  evidence: LaneAutoAssignmentEvidenceInput | null;
}): LaneAutoAssignmentCandidateEvaluation {
  const secondaryRoleEvidence = buildRoleEvidence(input.candidate, input.evidence);
  const nextRole =
    input.rankedRoles.find(
      (role) => role !== input.primaryPosition && role !== input.candidate,
    ) ?? null;
  const primaryToSecondaryGap = Number(
    (input.lanePower[input.primaryPosition] - input.lanePower[input.candidate]).toFixed(2),
  );
  const secondaryToThirdGap =
    nextRole !== null
      ? Number((input.lanePower[input.candidate] - input.lanePower[nextRole]).toFixed(2))
      : null;
  const hasBasicEvidence =
    secondaryRoleEvidence.matches >= SECONDARY_AUTO_THRESHOLDS.minSecondaryMatches &&
    secondaryRoleEvidence.recentShare >= SECONDARY_AUTO_THRESHOLDS.minSecondaryRecentShare &&
    secondaryRoleEvidence.roleConfidence >= SECONDARY_AUTO_THRESHOLDS.minSecondaryRoleConfidence;
  const hasStrongEvidence =
    secondaryRoleEvidence.matches >= SECONDARY_AUTO_THRESHOLDS.strongSecondaryMatches ||
    (secondaryRoleEvidence.recentShare >=
      SECONDARY_AUTO_THRESHOLDS.strongSecondaryRecentShare &&
      secondaryRoleEvidence.roleConfidence >=
        SECONDARY_AUTO_THRESHOLDS.strongSecondaryRoleConfidence);
  const scoreDistinctEnough =
    secondaryToThirdGap === null ||
    secondaryToThirdGap >= SECONDARY_AUTO_THRESHOLDS.minSecondaryToThirdGap ||
    hasStrongEvidence;
  const offRolePenaltyRisk =
    (secondaryRoleEvidence.preferenceBonus ?? 0) <=
      SECONDARY_AUTO_THRESHOLDS.offRolePenaltyPreferenceBonus &&
    secondaryRoleEvidence.matches < SECONDARY_AUTO_THRESHOLDS.offRoleLowMatches &&
    secondaryRoleEvidence.recentShare < SECONDARY_AUTO_THRESHOLDS.offRoleLowRecentShare;
  const sampleSize = input.evidence?.sampleSize ?? 0;
  const absoluteFlatDistribution =
    input.totalSpread < SECONDARY_AUTO_THRESHOLDS.minTotalSpread;
  const ambiguousFlatDistribution =
    input.totalSpread < SECONDARY_AUTO_THRESHOLDS.minTotalSpreadWithoutStrongEvidence &&
    primaryToSecondaryGap < SECONDARY_AUTO_THRESHOLDS.ambiguousPrimaryToSecondaryGap &&
    (secondaryToThirdGap ?? 0) < SECONDARY_AUTO_THRESHOLDS.ambiguousSecondaryToThirdGap;

  let rejectedReason: string | null = null;
  if (sampleSize < SECONDARY_AUTO_THRESHOLDS.minSampleSize) {
    rejectedReason = 'low_sample_size';
  } else if (absoluteFlatDistribution || (ambiguousFlatDistribution && !hasStrongEvidence)) {
    rejectedReason = 'flat_distribution';
  } else if (offRolePenaltyRisk) {
    rejectedReason = 'off_role_penalty_risk';
  } else if (!hasBasicEvidence) {
    rejectedReason = 'low_role_evidence';
  } else if (!scoreDistinctEnough) {
    rejectedReason = 'ambiguous_secondary_cluster';
  }

  return {
    candidate: input.candidate,
    accepted: rejectedReason === null,
    rejectedReason,
    primaryToSecondaryGap,
    secondaryToThirdGap,
    totalSpread: Number(input.totalSpread.toFixed(2)),
    secondaryRoleEvidence,
    hasBasicEvidence,
    hasStrongEvidence,
    scoreDistinctEnough,
    offRolePenaltyRisk,
  };
}

function buildRoleEvidence(
  role: PowerRole,
  evidence: LaneAutoAssignmentEvidenceInput | null,
): LaneAutoAssignmentRoleEvidence {
  const raw: Partial<LaneAutoAssignmentRoleEvidence> = evidence?.roles[role] ?? {};
  const matches = toFiniteNumber(raw.matches ?? raw.matchCount, 0);
  const inferredShare = evidence?.sampleSize ? matches / evidence.sampleSize : 0;
  const recentShare = normalizeShare(raw.recentShare ?? raw.roleShare, inferredShare);
  const roleShare = normalizeShare(raw.roleShare ?? raw.recentShare, recentShare);
  const roleConfidence = clamp(
    toFiniteNumber(raw.roleConfidence, matches > 0 ? matches / 6.5 : 0),
    0,
    1,
  );
  const roleEvidenceFactor = clamp(
    toFiniteNumber(raw.roleEvidenceFactor, 0.3 + roleConfidence * 0.7),
    0,
    1,
  );
  const preferredLane = resolvePreferredLane(evidence);

  return {
    matches,
    matchCount: matches,
    roleShare: Number(roleShare.toFixed(4)),
    recentShare: Number(recentShare.toFixed(4)),
    roleConfidence: Number(roleConfidence.toFixed(4)),
    roleEvidenceFactor: Number(roleEvidenceFactor.toFixed(4)),
    repeatedRecentRole: matches >= SECONDARY_AUTO_THRESHOLDS.minSecondaryMatches,
    preferredLane,
    rankedPreferredLane: preferredLane,
    championPoolAlignment:
      matches === 0
        ? 'unknown'
        : recentShare >= SECONDARY_AUTO_THRESHOLDS.minSecondaryRecentShare
          ? 'aligned'
          : 'weak',
    championPoolShare: matches === 0 ? null : Number(recentShare.toFixed(4)),
    preferenceBonus: toNullableNumber(raw.preferenceBonus),
    experienceAdjustment: toNullableNumber(raw.experienceAdjustment),
    proficiencyAdjustment: toNullableNumber(raw.proficiencyAdjustment),
    spreadAdjustment: toNullableNumber(raw.spreadAdjustment),
  };
}

function resolveLaneAssignmentDecisionSource(input: {
  manualPrimary: PowerRole | null;
  manualSecondary: PowerRole | null;
  secondaryPosition: PowerRole | null;
  secondaryRejectedReason: string | null;
}): LaneAutoAssignmentDecisionSource {
  if (input.manualPrimary && input.manualSecondary) {
    return 'manual';
  }

  if (input.manualPrimary && input.secondaryPosition) {
    return 'manual_primary_auto_secondary';
  }

  if (input.secondaryPosition) {
    return 'auto_dual_role';
  }

  if (
    !input.secondaryRejectedReason ||
    input.secondaryRejectedReason === 'no_secondary_candidate'
  ) {
    return 'auto_primary_only';
  }

  if (
    input.secondaryRejectedReason === 'flat_distribution' ||
    input.secondaryRejectedReason === 'ambiguous_secondary_cluster'
  ) {
    return 'auto_flat_distribution';
  }

  return 'auto_low_evidence';
}

function resolvePreferredLane(
  evidence: LaneAutoAssignmentEvidenceInput | null,
): PowerRole | null {
  if (!evidence) {
    return null;
  }

  return POWER_ROLES.reduce<PowerRole | null>((bestRole, role) => {
    const currentMatches = toFiniteNumber(evidence.roles[role]?.matches, 0);
    const currentShare = normalizeShare(
      evidence.roles[role]?.recentShare ?? evidence.roles[role]?.roleShare,
      evidence.sampleSize > 0 ? currentMatches / evidence.sampleSize : 0,
    );
    if (!bestRole) {
      return currentShare > 0 ? role : null;
    }

    const bestMatches = toFiniteNumber(evidence.roles[bestRole]?.matches, 0);
    const bestShare = normalizeShare(
      evidence.roles[bestRole]?.recentShare ?? evidence.roles[bestRole]?.roleShare,
      evidence.sampleSize > 0 ? bestMatches / evidence.sampleSize : 0,
    );
    return currentShare > bestShare ? role : bestRole;
  }, null);
}

function roleFocusBias(
  roleFocus: PowerRole,
): Record<'carry' | 'teamContribution' | 'laneInfluence', number> {
  switch (roleFocus) {
    case Position.ADC:
      return { carry: 12, teamContribution: 2, laneInfluence: 8 };
    case Position.MID:
      return { carry: 10, teamContribution: 3, laneInfluence: 10 };
    case Position.TOP:
      return { carry: 6, teamContribution: 4, laneInfluence: 7 };
    case Position.JUNGLE:
      return { carry: 5, teamContribution: 8, laneInfluence: 9 };
    case Position.SUPPORT:
      return { carry: -3, teamContribution: 14, laneInfluence: 6 };
    default:
      return { carry: 0, teamContribution: 0, laneInfluence: 0 };
  }
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function toFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function toNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeShare(value: unknown, fallback: number): number {
  const candidate = toFiniteNumber(value, fallback);
  const ratio = candidate > 1 ? candidate / 100 : candidate;
  return clamp(Number(ratio.toFixed(4)), 0, 1);
}

function normalizePercent(value: unknown, fallback: number): number {
  const candidate = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return clamp(Number(candidate.toFixed(2)), 0, 100);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isPowerRole(value: unknown): value is PowerRole {
  return typeof value === 'string' && POWER_ROLES.includes(value as PowerRole);
}
