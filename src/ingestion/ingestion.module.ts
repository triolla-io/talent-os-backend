import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { IngestionProcessor } from './ingestion.processor';
import { SpamFilterService } from './services/spam-filter.service';
import { AttachmentExtractorService } from './services/attachment-extractor.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'ingest-email' }),
  ],
  providers: [IngestionProcessor, SpamFilterService, AttachmentExtractorService],
})
export class IngestionModule {}
