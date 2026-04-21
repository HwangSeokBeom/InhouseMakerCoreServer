import { MatchStatus } from '@prisma/client';

export const REALIZED_INHOUSE_MATCH_STATUSES: MatchStatus[] = [
  MatchStatus.IN_PROGRESS,
  MatchStatus.RESULT_PENDING,
  MatchStatus.CONFIRMED,
  MatchStatus.DISPUTED,
  MatchStatus.CLOSED,
];

export const COMPLETED_INHOUSE_MATCH_STATUSES: MatchStatus[] = [
  MatchStatus.CONFIRMED,
  MatchStatus.CLOSED,
];
