export const QUEUE_NAMES = {
  RIOT_SYNC: 'riot-sync',
  POWER: 'power',
  RESULT: 'result',
  NOTIFICATION: 'notification',
} as const;

export const JOB_NAMES = {
  RIOT_ACCOUNT_INITIAL_SYNC: 'riot-account-initial-sync',
  RIOT_ACCOUNT_REFRESH: 'riot-account-refresh',
  RECALCULATE_POWER_PROFILE: 'recalculate-power-profile',
  FINALIZE_RESULT_CONFIRMATION: 'finalize-result-confirmation',
  SEND_NOTIFICATION: 'send-notification',
} as const;

