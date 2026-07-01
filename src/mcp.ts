import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
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
  expressApp.disable('x-powered-by');
  // Security headers (HSTS, X-Frame-Options anti-clickjacking on the Google login page, noSniff,
  // etc.). CSP is disabled because the self-contained login page uses inline <script>/<style> and
  // loads Google Identity Services from accounts.google.com; the other helmet defaults still apply.
  expressApp.use(helmet({ contentSecurityPolicy: false }));
  // Explicit body-size cap to blunt large-payload DoS on the JSON-RPC endpoint.
  expressApp.use(express.json({ limit: '1mb' }));

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
