import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cookieParser = require('cookie-parser');
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

  // Phase 19: parse cookies so SessionGuard can read talent_os_session (D-16)
  app.use(cookieParser());

  // Postmark sends CV attachments as base64 inside JSON — a 2 MB PDF becomes ~2.7 MB.
  // Default Express limit is 100 KB which rejects most real CVs.
  app.useBodyParser('json', { limit: '10mb' });

  // Phase 19: CORS must allow FRONTEND_URL with credentials so cookies are sent (D-03)
  const isDev = process.env.NODE_ENV === 'development';
  const frontendUrl = process.env.FRONTEND_URL ?? (isDev ? 'http://localhost:5173' : 'https://talentos.triolla.io');
  app.enableCors({
    origin: frontendUrl,
    credentials: true, // required for cookie-based auth
  });

  // Global /api prefix — must be set BEFORE app.listen()
  app.setGlobalPrefix('api');

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
