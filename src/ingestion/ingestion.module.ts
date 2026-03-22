import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { IngestionProcessor } from './ingestion.processor';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'ingest-email' }),
  ],
  providers: [IngestionProcessor],
})
export class IngestionModule {}
