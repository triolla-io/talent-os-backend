import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  process.env.TZ = process.env.TZ ?? 'Asia/Jerusalem';

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    bodyParser: true,
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger));

  // D-14: HTTP security headers (XSS protection, clickjacking prevention, MIME sniffing)
  app.use(helmet());

  // Postmark sends CV attachments as base64 inside JSON — a 2 MB PDF becomes ~2.7 MB.
  // Default Express limit is 100 KB which rejects most real CVs.
  app.useBodyParser('json', { limit: '10mb' });

  // D-16: CORS deny-all — API only receives Postmark webhooks in Phase 1, no browser clients
  app.enableCors({ origin: false });

  // Global /api prefix — must be set BEFORE app.listen()
  app.setGlobalPrefix('api');

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
