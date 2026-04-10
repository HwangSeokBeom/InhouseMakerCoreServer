import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';

import { JOB_NAMES, QUEUE_NAMES } from './queue.constants';

@Injectable()
export class QueueService {
  constructor(
    @InjectQueue(QUEUE_NAMES.RIOT_SYNC) private readonly riotQueue: Queue,
    @InjectQueue(QUEUE_NAMES.POWER) private readonly powerQueue: Queue,
    @InjectQueue(QUEUE_NAMES.RESULT) private readonly resultQueue: Queue,
    @InjectQueue(QUEUE_NAMES.NOTIFICATION) private readonly notificationQueue: Queue,
  ) {}

  enqueueRiotAccountInitialSync(riotAccountId: string): Promise<unknown> {
    return this.riotQueue.add(
      JOB_NAMES.RIOT_ACCOUNT_INITIAL_SYNC,
      { riotAccountId },
      { attempts: 5, backoff: { type: 'exponential', delay: 2_000 } },
    );
  }

  enqueueRiotAccountRefresh(riotAccountId: string): Promise<unknown> {
    return this.riotQueue.add(
      JOB_NAMES.RIOT_ACCOUNT_REFRESH,
      { riotAccountId },
      { attempts: 5, backoff: { type: 'exponential', delay: 2_000 } },
    );
  }

  enqueuePowerRecalculation(userId: string, reason: string): Promise<unknown> {
    return this.powerQueue.add(
      JOB_NAMES.RECALCULATE_POWER_PROFILE,
      { userId, reason },
      { attempts: 3, backoff: { type: 'exponential', delay: 1_000 } },
    );
  }

  enqueueFinalizeResultConfirmation(matchResultId: string): Promise<unknown> {
    return this.resultQueue.add(JOB_NAMES.FINALIZE_RESULT_CONFIRMATION, {
      matchResultId,
    });
  }

  enqueueNotification(notificationId: string): Promise<unknown> {
    return this.notificationQueue.add(JOB_NAMES.SEND_NOTIFICATION, {
      notificationId,
    });
  }
}

