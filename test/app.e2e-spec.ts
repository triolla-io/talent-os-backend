import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health returns 200 or 503 with correct shape', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/health')
      .expect((res) => {
        // Accept both 200 (ok) and 503 (degraded — DB/Redis not running in CI)
        expect([200, 503]).toContain(res.status);
      });

    expect(response.body).toHaveProperty('status');
    expect(response.body).toHaveProperty('checks');
    expect(response.body).toHaveProperty('uptime');
    expect(response.body.checks).toHaveProperty('database');
    expect(response.body.checks).toHaveProperty('redis');
    expect(['ok', 'degraded']).toContain(response.body.status);
  });
});
