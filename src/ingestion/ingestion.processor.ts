import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';

@Processor('ingest-email')
export class IngestionProcessor extends WorkerHost {
  private readonly logger = new Logger(IngestionProcessor.name);

  async process(job: Job): Promise<void> {
    // Phase 2 stub — real logic added in Phase 3 (email parsing + spam filter)
    this.logger.log(`Processing job ${job.id} for MessageID: ${job.data?.MessageID ?? 'unknown'}`);
  }
}
