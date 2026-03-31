import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [
    // Import the queue registration so @InjectQueue('ingest-email') works
    BullModule.registerQueue({ name: 'ingest-email' }),
  ],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
