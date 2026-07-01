import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import express from 'express';
import { McpModule } from './mcp/mcp.module';

async function bootstrap() {
  process.env.TZ = process.env.TZ ?? 'Asia/Jerusalem';

  const app = await NestFactory.create<NestExpressApplication>(McpModule, {
    rawBody: true,
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));

  const expressApp = app.getHttpAdapter().getInstance() as express.Express;
  expressApp.use(express.json());

  // OAuth + /mcp routes are mounted here in Task 10 (this call is added then):
  // await mountMcpRoutes(app, expressApp);

  expressApp.get('/healthz', (_req, res) => res.json({ status: 'ok' }));

  await app.listen(process.env.PORT ?? 3100);
}
bootstrap();
