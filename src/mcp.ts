import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpModule } from './mcp/mcp.module';
import { mountMcpRoutes } from './mcp/mcp-http';

async function bootstrap() {
  process.env.TZ = process.env.TZ ?? 'Asia/Jerusalem';

  const app = await NestFactory.create<NestExpressApplication>(McpModule, {
    rawBody: true,
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));

  const expressApp = app.getHttpAdapter().getInstance() as express.Express;
  expressApp.use(express.json());

  // Temporary empty server — replaced by the real tool factory in Task 11.
  await mountMcpRoutes(app, expressApp, () => new McpServer({ name: 'talent-os-mcp', version: '1.0.0' }));

  expressApp.get('/healthz', (_req, res) => res.json({ status: 'ok' }));

  await app.listen(process.env.PORT ?? 3100);
}
bootstrap();
