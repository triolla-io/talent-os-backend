import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  process.env.TZ = process.env.TZ ?? 'Asia/Jerusalem';

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    bodyParser: true,
  });

  // Postmark sends CV attachments as base64 inside JSON — a 2 MB PDF becomes ~2.7 MB.
  // Default Express limit is 100 KB which rejects most real CVs.
  app.useBodyParser('json', { limit: '10mb' });

  // D-01: CORS for local recruiter UI (hardcoded for MVP — no env var needed)
  app.enableCors({ origin: 'http://localhost:5173' });

  // D-02: Global /api prefix — must be set BEFORE app.listen()
  app.setGlobalPrefix('api');

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
