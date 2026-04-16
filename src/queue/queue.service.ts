import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

import { JOB_NAMES, QUEUE_NAMES } from './queue.constants';

@Injectable()
export class QueueService {
  constructor(
    @InjectQueue(QUEUE_NAMES.RIOT_SYNC) private readonly riotQueue: Queue,
    @InjectQueue(QUEUE_NAMES.POWER) private readonly powerQueue: Queue,
    @InjectQueue(QUEUE_NAMES.RESULT) private readonly resultQueue: Queue,
    @InjectQueue(QUEUE_NAMES.NOTIFICATION) private readonly notificationQueue: Queue,
    private readonly configService: ConfigService,
  ) {}

  enqueueRiotAccountInitialSync(riotAccountId: string): Promise<unknown> {
    return this.riotQueue.add(
      JOB_NAMES.RIOT_ACCOUNT_INITIAL_SYNC,
      { riotAccountId },
      this.buildRiotSyncJobOptions(),
    );
  }

  enqueueRiotAccountRefresh(riotAccountId: string): Promise<unknown> {
    return this.riotQueue.add(
      JOB_NAMES.RIOT_ACCOUNT_REFRESH,
      { riotAccountId },
      this.buildRiotSyncJobOptions(),
    );
  }

  async cancelRiotSyncJobs(riotAccountId: string): Promise<number> {
    const jobs = await this.riotQueue.getJobs(['waiting', 'delayed', 'prioritized', 'paused']);
    let removedCount = 0;

    for (const job of jobs) {
      if (job.data?.riotAccountId !== riotAccountId) {
        continue;
      }

      await job.remove();
      removedCount += 1;
    }

    return removedCount;
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

  async getQueuesHealth(): Promise<string> {
    await Promise.all([
      this.riotQueue.getJobCounts('waiting', 'active', 'failed'),
      this.powerQueue.getJobCounts('waiting', 'active', 'failed'),
      this.resultQueue.getJobCounts('waiting', 'active', 'failed'),
      this.notificationQueue.getJobCounts('waiting', 'active', 'failed'),
    ]);

    return 'ok';
  }

  private buildRiotSyncJobOptions() {
    return {
      attempts: this.configService.get<number>('RIOT_SYNC_MAX_RETRIES', 5),
      backoff: {
        type: 'exponential' as const,
        delay: this.configService.get<number>('RIOT_SYNC_BACKOFF_MS', 2_000),
      },
    };
  }
}
