// MUST be first: sets env that McpModule's ConfigModule.forRoot validates at import time.
import '../src/mcp/mcp-test-env';

import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import request from 'supertest';
import { McpModule } from '../src/mcp/mcp.module';
import { mountMcpRoutes } from '../src/mcp/mcp-http';
import { buildMcpServer } from '../src/mcp/mcp-server.factory';
import { McpTokenService } from '../src/mcp/mcp-token.service';
import { CandidatesService } from '../src/candidates/candidates.service';
import { JobsService } from '../src/jobs/jobs.service';
import { CandidateAiService } from '../src/candidates/candidate-ai.service';

describe('MCP OAuth + tools (e2e)', () => {
  let app: NestExpressApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [McpModule] })
      .overrideProvider(CandidatesService)
      .useValue({
        findAll: jest.fn().mockResolvedValue({ candidates: [{ id: 'c1' }], total: 1 }),
        updateStage: jest.fn().mockResolvedValue(undefined),
      })
      .overrideProvider(JobsService)
      .useValue({ findAll: jest.fn().mockResolvedValue({ jobs: [], total: 0 }) })
      .overrideProvider(CandidateAiService)
      .useValue({ generateSummary: jest.fn() })
      .compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    const expressApp = app.getHttpAdapter().getInstance() as express.Express;
    expressApp.use(express.json());
    const services = {
      candidates: app.get(CandidatesService),
      jobs: app.get(JobsService),
      candidateAi: app.get(CandidateAiService),
    };
    // Mount the raw Express OAuth + /mcp routes BEFORE app.init() so they sit ahead of
    // Nest's router (which otherwise 404s /mcp before these matchers are reached).
    await mountMcpRoutes(app, expressApp, () => buildMcpServer(services));
    await app.init();
    await app.listen(0);
    const addr = app.getHttpServer().address();
    baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 3199}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves protected-resource metadata', async () => {
    const res = await request(baseUrl).get('/.well-known/oauth-protected-resource/mcp');
    expect(res.status).toBe(200);
    expect(res.body.authorization_servers?.length).toBeGreaterThan(0);
  });

  it('rejects /mcp without a bearer token (401 + challenge)', async () => {
    const res = await request(baseUrl).post('/mcp').send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/resource_metadata/i);
  });

  it('lists tools and calls a read tool with a valid bearer', async () => {
    const tokens = app.get(McpTokenService);
    const bearer = await tokens.signAccess({ sub: 'u1', org: 'o1', role: 'member' });

    const list = await request(baseUrl)
      .post('/mcp')
      .set('Authorization', `Bearer ${bearer}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(list.status).toBe(200);
    // response may be SSE-framed; assert the tool name appears in the body text
    expect(JSON.stringify(list.body) + list.text).toMatch(/search_candidates/);

    const call = await request(baseUrl)
      .post('/mcp')
      .set('Authorization', `Bearer ${bearer}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'search_candidates', arguments: { q: 'eng' } },
      });
    expect(call.status).toBe(200);
    expect(JSON.stringify(call.body) + call.text).toMatch(/"total": 1|\\"total\\": 1/);
  });

  it('viewer bearer is rejected by a write tool', async () => {
    const tokens = app.get(McpTokenService);
    const bearer = await tokens.signAccess({ sub: 'u1', org: 'o1', role: 'viewer' });
    const call = await request(baseUrl)
      .post('/mcp')
      .set('Authorization', `Bearer ${bearer}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'move_candidate_stage',
          arguments: {
            // Valid RFC 4122 v4 UUIDs (version nibble 4, variant nibble 8) so the SDK's
            // strict schema validation passes and the request reaches the role gate.
            candidate_id: '11111111-1111-4111-8111-111111111111',
            hiring_stage_id: '22222222-2222-4222-8222-222222222222',
          },
        },
      });
    expect(JSON.stringify(call.body) + call.text).toMatch(/read-only|requires a member/i);
  });
});
