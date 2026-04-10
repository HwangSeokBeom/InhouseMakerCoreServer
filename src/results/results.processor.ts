import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { JOB_NAMES, QUEUE_NAMES } from '../queue/queue.constants';
import { ResultsService } from './results.service';

@Processor(QUEUE_NAMES.RESULT)
export class ResultsProcessor extends WorkerHost {
  private readonly logger = new Logger(ResultsProcessor.name);

  constructor(private readonly resultsService: ResultsService) {
    super();
  }

  async process(job: Job<{ matchResultId: string }>): Promise<void> {
    this.logger.log(`Processing result job ${job.name} for ${job.data.matchResultId}`);

    if (job.name === JOB_NAMES.FINALIZE_RESULT_CONFIRMATION) {
      await this.resultsService.finalizeResultStatus(job.data.matchResultId, false);
    }
  }
}
