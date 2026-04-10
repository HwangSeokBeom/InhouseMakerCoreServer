import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { JOB_NAMES, QUEUE_NAMES } from '../queue/queue.constants';
import { PowerService } from './power.service';

@Processor(QUEUE_NAMES.POWER)
export class PowerProcessor extends WorkerHost {
  private readonly logger = new Logger(PowerProcessor.name);

  constructor(private readonly powerService: PowerService) {
    super();
  }

  async process(job: Job<{ userId: string }>): Promise<void> {
    this.logger.log(`Processing power job ${job.name} for ${job.data.userId}`);

    if (job.name === JOB_NAMES.RECALCULATE_POWER_PROFILE) {
      await this.powerService.recalculateProfile(job.data.userId);
    }
  }
}

