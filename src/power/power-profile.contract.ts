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

export interface PowerProfileStyleShape {
  stability: number;
  carry: number;
  teamContribution: number;
  laneInfluence: number;
  roleFocus: PowerRole;
  seeded?: boolean;
}

export interface LaneAutoAssignmentShape {
  primaryPosition: PowerRole;
  secondaryPosition: PowerRole | null;
  source:
    | 'manual'
    | 'manual_primary_auto_secondary'
    | 'auto_fallback'
    | 'auto_fallback_flat_secondary';
  reason: string;
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
  const secondaryCandidate = manualSecondary ?? resolveAutoSecondaryRole(primaryPosition, rankedRoles);
  const secondaryPosition = manualSecondary
    ? secondaryCandidate
    : shouldExposeAutoSecondary(primaryPosition, secondaryCandidate, rankedRoles, lanePower)
      ? secondaryCandidate
      : null;
  const secondRole = rankedRoles.find((role) => role !== primaryPosition) ?? null;
  const thirdRole = rankedRoles.find((role) => role !== primaryPosition && role !== secondRole) ?? null;
  const values = POWER_ROLES.map((role) => normalizePercent(lanePower[role], 50));
  const totalSpread = Math.max(...values) - Math.min(...values);
  const primaryToSecondary =
    secondRole !== null
      ? Number((lanePower[primaryPosition] - lanePower[secondRole]).toFixed(2))
      : null;
  const secondaryToThird =
    secondaryPosition !== null && thirdRole !== null
      ? Number((lanePower[secondaryPosition] - lanePower[thirdRole]).toFixed(2))
      : null;
  const source =
    manualPrimary && manualSecondary
      ? 'manual'
      : manualPrimary
        ? 'manual_primary_auto_secondary'
        : secondaryPosition
          ? 'auto_fallback'
          : 'auto_fallback_flat_secondary';

  return {
    primaryPosition,
    secondaryPosition,
    source,
    reason:
      source === 'manual'
        ? 'Manual primary and secondary positions are valid and preserved.'
        : source === 'manual_primary_auto_secondary'
          ? `Manual primary position is preserved; secondary position is selected from lane power (spread ${Number(totalSpread.toFixed(2))}).`
          : secondaryPosition
            ? `Primary and secondary positions are selected from the two highest lane power scores (spread ${Number(totalSpread.toFixed(2))}, primary-secondary ${primaryToSecondary ?? 'n/a'}, secondary-third ${secondaryToThird ?? 'n/a'}).`
            : `Primary position is selected from lane power; secondary is withheld because lane scores are too flat (spread ${Number(totalSpread.toFixed(2))}).`,
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

function resolveAutoSecondaryRole(
  primaryRole: PowerRole,
  rankedRoles: PowerRole[],
): PowerRole | null {
  return rankedRoles.find((role) => role !== primaryRole) ?? null;
}

function shouldExposeAutoSecondary(
  primaryRole: PowerRole,
  secondaryRole: PowerRole | null,
  rankedRoles: PowerRole[],
  lanePower: Record<PowerRole, number>,
): boolean {
  if (!secondaryRole) {
    return false;
  }

  const roleScores = rankedRoles.map((role) => normalizePercent(lanePower[role], 50));
  const totalSpread = Math.max(...roleScores) - Math.min(...roleScores);
  if (totalSpread < 1.4) {
    return false;
  }

  const thirdRole =
    rankedRoles.find((role) => role !== primaryRole && role !== secondaryRole) ?? null;
  if (!thirdRole) {
    return true;
  }

  const primaryToSecondary = Math.abs(lanePower[primaryRole] - lanePower[secondaryRole]);
  const secondaryToThird = lanePower[secondaryRole] - lanePower[thirdRole];
  return !(primaryToSecondary < 0.9 && secondaryToThird < 0.9);
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
