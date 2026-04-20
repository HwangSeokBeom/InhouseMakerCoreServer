import { Position, ResultStatus } from '@prisma/client';

export const POWER_ROLES = [
  Position.TOP,
  Position.JUNGLE,
  Position.MID,
  Position.ADC,
  Position.SUPPORT,
] as const;

export type PowerRole = (typeof POWER_ROLES)[number];

export const POWER_PROFILE_VERSION = 'v3-secondary-evidence';

export const RESULT_CONFIDENCE_WEIGHTS: Record<ResultStatus, number> = {
  [ResultStatus.CONFIRMED]: 1,
  [ResultStatus.PARTIAL]: 0.5,
  [ResultStatus.DISPUTED]: 0,
};
