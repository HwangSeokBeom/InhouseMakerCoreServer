import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { JOB_NAMES, QUEUE_NAMES } from '../queue/queue.constants';
import { RiotService } from './riot.service';

@Processor(QUEUE_NAMES.RIOT_SYNC)
export class RiotProcessor extends WorkerHost {
  private readonly logger = new Logger(RiotProcessor.name);

  constructor(private readonly riotService: RiotService) {
    super();
  }

  async process(job: Job<{ riotAccountId: string }>): Promise<void> {
    this.logger.log(`Processing Riot job ${job.name} for ${job.data.riotAccountId}`);

    switch (job.name) {
      case JOB_NAMES.RIOT_ACCOUNT_INITIAL_SYNC:
      case JOB_NAMES.RIOT_ACCOUNT_REFRESH:
        await this.riotService.syncAccount(job.data.riotAccountId);
        break;
      default:
        this.logger.warn(`Unhandled Riot job ${job.name}`);
    }
  }
}

