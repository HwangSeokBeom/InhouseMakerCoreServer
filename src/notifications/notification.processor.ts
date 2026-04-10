import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { JOB_NAMES, QUEUE_NAMES } from '../queue/queue.constants';
import { NotificationService } from './notification.service';

@Processor(QUEUE_NAMES.NOTIFICATION)
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(private readonly notificationService: NotificationService) {
    super();
  }

  async process(job: Job<{ notificationId: string }>): Promise<void> {
    this.logger.log(`Processing notification job ${job.name} for ${job.data.notificationId}`);

    if (job.name === JOB_NAMES.SEND_NOTIFICATION) {
      await this.notificationService.markSent(job.data.notificationId);
    }
  }
}

