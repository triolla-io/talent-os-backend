import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import express from 'express';
import { McpModule } from './mcp/mcp.module';
import { mountMcpRoutes } from './mcp/mcp-http';
import { buildMcpServer } from './mcp/mcp-server.factory';
import { CandidatesService } from './candidates/candidates.service';
import { JobsService } from './jobs/jobs.service';
import { CandidateAiService } from './candidates/candidate-ai.service';

async function bootstrap() {
  process.env.TZ = process.env.TZ ?? 'Asia/Jerusalem';

  const app = await NestFactory.create<NestExpressApplication>(McpModule, {
    rawBody: true,
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));

  const expressApp = app.getHttpAdapter().getInstance() as express.Express;
  expressApp.use(express.json());

  const services = {
    candidates: app.get(CandidatesService),
    jobs: app.get(JobsService),
    candidateAi: app.get(CandidateAiService),
  };
  await mountMcpRoutes(app, expressApp, () => buildMcpServer(services));

  expressApp.get('/healthz', (_req, res) => res.json({ status: 'ok' }));

  await app.listen(process.env.PORT ?? 3100);
}
bootstrap();
