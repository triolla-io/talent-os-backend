import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import * as multer from 'multer';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { MailgunAuthGuard } from './guards/mailgun-auth.guard';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [BullModule.registerQueue({ name: 'ingest-email' }), StorageModule],
  controllers: [WebhooksController],
  providers: [WebhooksService, MailgunAuthGuard],
})
export class WebhooksModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 5 } }).any())
      .forRoutes({ path: 'webhooks/email', method: RequestMethod.POST });
  }
}
