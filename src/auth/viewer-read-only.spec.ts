import { CanActivate, ExecutionContext, INestApplication, RequestMethod, Type } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import type { Request } from 'express';
import request from 'supertest';
import { SessionGuard } from './session.guard';
import { JwtPayload, JwtService } from './jwt.service';
import { PrismaService } from '../prisma/prisma.service';
import { CandidatesController } from '../candidates/candidates.controller';
import { CandidatesService } from '../candidates/candidates.service';
import { BulkAssignService } from '../bulk-assign/bulk-assign.service';
import { JobsController } from '../jobs/jobs.controller';
import { JobsService } from '../jobs/jobs.service';

// spec/auth-rules.md AUTH-006: a viewer is read-only. The client hides write controls from
// viewers, so this is the server-side half — a viewer calling a mutation directly gets 403.

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const CAND_ID = '22222222-2222-2222-2222-222222222222';
const JOB_ID = '33333333-3333-3333-3333-333333333333';
const STAGE_ID = '44444444-4444-4444-4444-444444444444';

let role: JwtPayload['role'] = 'admin';

// Stands in for SessionGuard: authenticates every request as the role under test.
class RoleSessionGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    context.switchToHttp().getRequest<Request>().session = { sub: 'user-uuid', org: TENANT_ID, role };
    return true;
  }
}

const candidates = {
  getCounts: jest.fn().mockResolvedValue({ total: 0, duplicates: 0, unassigned: 0 }),
  findAll: jest.fn().mockResolvedValue({ candidates: [], total: 0 }),
  findOne: jest.fn().mockResolvedValue({ id: CAND_ID }),
  getCvPresignedUrl: jest.fn().mockResolvedValue({ url: 'https://r2.example.com/cv.pdf' }),
  getCvBytes: jest
    .fn()
    .mockResolvedValue({ body: Buffer.from('%PDF-1.7'), contentType: 'application/pdf', filename: 'cv.pdf' }),
  createCandidate: jest.fn().mockResolvedValue({ id: CAND_ID }),
  updateStage: jest.fn().mockResolvedValue(undefined),
  deleteCandidate: jest.fn().mockResolvedValue(undefined),
  updateCandidate: jest.fn().mockResolvedValue({ id: CAND_ID }),
  rejectCandidate: jest.fn().mockResolvedValue({ id: CAND_ID, is_rejected: true }),
  revertScore: jest.fn().mockResolvedValue({ id: CAND_ID }),
  uploadCv: jest.fn().mockResolvedValue({ id: CAND_ID }),
  saveStageSummary: jest.fn().mockResolvedValue({ success: true }),
  advanceWithSummary: jest.fn().mockResolvedValue({ success: true, hiring_stage_id: STAGE_ID }),
};
const bulkAssign = { enqueue: jest.fn().mockResolvedValue({ queued: 1 }) };
const jobs = {
  findAll: jest.fn().mockResolvedValue({ jobs: [], total: 0 }),
  getOpenJobs: jest.fn().mockResolvedValue({ jobs: [] }),
  findOne: jest.fn().mockResolvedValue({ id: JOB_ID }),
  createJob: jest.fn().mockResolvedValue({ id: JOB_ID }),
  updateJob: jest.fn().mockResolvedValue({ id: JOB_ID }),
  deleteJob: jest.fn().mockResolvedValue(undefined),
  hardDeleteJob: jest.fn().mockResolvedValue(undefined),
};

interface Mutation {
  route: string;
  send: (http: request.Agent) => request.Test;
  status: number;
  service: jest.Mock;
}

const MUTATIONS: Mutation[] = [
  {
    route: 'POST /candidates',
    send: (http) =>
      http.post('/candidates').field('full_name', 'Dana Levi').field('source', 'manual').field('job_id', JOB_ID),
    status: 201,
    service: candidates.createCandidate,
  },
  {
    route: 'POST /candidates/bulk-assign',
    send: (http) => http.post('/candidates/bulk-assign').send({ candidate_ids: [CAND_ID], job_id: JOB_ID }),
    status: 202,
    service: bulkAssign.enqueue,
  },
  {
    route: 'PATCH /candidates/:id/stage',
    send: (http) => http.patch(`/candidates/${CAND_ID}/stage`).send({ hiring_stage_id: STAGE_ID }),
    status: 200,
    service: candidates.updateStage,
  },
  {
    route: 'DELETE /candidates/:id',
    send: (http) => http.delete(`/candidates/${CAND_ID}`),
    status: 204,
    service: candidates.deleteCandidate,
  },
  {
    route: 'PATCH /candidates/:id',
    send: (http) => http.patch(`/candidates/${CAND_ID}`).send({ full_name: 'Dana Levi' }),
    status: 200,
    service: candidates.updateCandidate,
  },
  {
    route: 'POST /candidates/:id/reject',
    send: (http) => http.post(`/candidates/${CAND_ID}/reject`).send({ reason: 'not_a_fit' }),
    status: 200,
    service: candidates.rejectCandidate,
  },
  {
    route: 'POST /candidates/:id/score/revert',
    send: (http) => http.post(`/candidates/${CAND_ID}/score/revert`),
    status: 200,
    service: candidates.revertScore,
  },
  {
    route: 'POST /candidates/:id/cv',
    send: (http) => http.post(`/candidates/${CAND_ID}/cv`).attach('cv_file', Buffer.from('%PDF-1.7'), 'cv.pdf'),
    status: 201,
    service: candidates.uploadCv,
  },
  {
    route: 'POST /candidates/:id/stages/:stage_id/summary',
    send: (http) => http.post(`/candidates/${CAND_ID}/stages/${STAGE_ID}/summary`).send({ summary: 'Strong fit' }),
    status: 200,
    service: candidates.saveStageSummary,
  },
  {
    route: 'POST /candidates/:id/stages/:stage_id/advance',
    send: (http) => http.post(`/candidates/${CAND_ID}/stages/${STAGE_ID}/advance`).send({ summary: 'Strong fit' }),
    status: 200,
    service: candidates.advanceWithSummary,
  },
  {
    route: 'POST /jobs',
    send: (http) => http.post('/jobs').send({ title: 'Backend Engineer' }),
    status: 201,
    service: jobs.createJob,
  },
  {
    route: 'PUT /jobs/:id',
    send: (http) => http.put(`/jobs/${JOB_ID}`).send({ title: 'Backend Engineer' }),
    status: 200,
    service: jobs.updateJob,
  },
  {
    route: 'DELETE /jobs/:id',
    send: (http) => http.delete(`/jobs/${JOB_ID}`),
    status: 204,
    service: jobs.deleteJob,
  },
  {
    route: 'DELETE /jobs/:id/hard',
    send: (http) => http.delete(`/jobs/${JOB_ID}/hard`),
    status: 204,
    service: jobs.hardDeleteJob,
  },
];

const READS = [
  { route: 'GET /candidates/counts', path: '/candidates/counts' },
  { route: 'GET /candidates', path: '/candidates' },
  { route: 'GET /candidates/:id', path: `/candidates/${CAND_ID}` },
  { route: 'GET /candidates/:id/cv-url', path: `/candidates/${CAND_ID}/cv-url` },
  { route: 'GET /candidates/:id/cv-file', path: `/candidates/${CAND_ID}/cv-file` },
  { route: 'GET /jobs', path: '/jobs' },
  { route: 'GET /jobs/list', path: '/jobs/list' },
  { route: 'GET /jobs/:id', path: `/jobs/${JOB_ID}` },
];

/** Every route a controller declares, as "METHOD /path", read from Nest's route metadata. */
function declaredRoutes(controller: Type): string[] {
  const base = Reflect.getMetadata(PATH_METADATA, controller) as string;
  const proto = controller.prototype as Record<string, object>;
  return Object.getOwnPropertyNames(proto)
    .map((name) => proto[name])
    .filter((handler) => Reflect.hasMetadata(METHOD_METADATA, handler))
    .map((handler) => {
      const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod];
      const path = Reflect.getMetadata(PATH_METADATA, handler) as string;
      return `${method} /${[base, path].filter((p) => p && p !== '/').join('/')}`;
    });
}

describe('Viewers are read-only on the candidates and jobs API', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CandidatesController, JobsController],
      providers: [
        { provide: CandidatesService, useValue: candidates },
        { provide: BulkAssignService, useValue: bulkAssign },
        { provide: JobsService, useValue: jobs },
        { provide: SessionGuard, useClass: RoleSessionGuard },
      ],
    })
      .overrideGuard(SessionGuard)
      .useClass(RoleSessionGuard)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // A new route fails this until it is listed below: in MUTATIONS (viewers get 403) or in
  // READS (viewers allowed). Nothing reaches production with an unexamined role decision.
  it('classifies every route the two controllers declare', () => {
    const declared = [...declaredRoutes(CandidatesController), ...declaredRoutes(JobsController)];
    const classified = [...MUTATIONS.map((m) => m.route), ...READS.map((r) => r.route)];
    expect(classified.sort()).toEqual(declared.sort());
  });

  describe.each(MUTATIONS)('$route', ({ send, status, service }) => {
    it('refuses a viewer with 403 FORBIDDEN before any work runs', async () => {
      role = 'viewer';
      const res = await send(request(app.getHttpServer())).expect(403);
      expect(res.body).toEqual({ error: { code: 'FORBIDDEN', message: 'Viewers have read-only access' } });
      expect(service).not.toHaveBeenCalled();
    });

    it.each(['member', 'admin', 'owner'] as const)('lets a %s through', async (writer) => {
      role = writer;
      await send(request(app.getHttpServer())).expect(status);
      expect(service).toHaveBeenCalledTimes(1);
    });
  });

  describe.each(READS)('$route', ({ path }) => {
    it('stays open to a viewer', async () => {
      role = 'viewer';
      await request(app.getHttpServer()).get(path).expect(200);
    });
  });
});

// The same guards wired as production wires them (auth.module.ts): SessionGuard as the global
// APP_GUARD, a real signed session cookie, and the role read from the user row, not the token.
describe('Viewer block behind the real SessionGuard', () => {
  const prisma = { user: { findUnique: jest.fn() } };
  let app: INestApplication;
  let jwt: JwtService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CandidatesController, JobsController],
      providers: [
        { provide: CandidatesService, useValue: candidates },
        { provide: BulkAssignService, useValue: bulkAssign },
        { provide: JobsService, useValue: jobs },
        { provide: ConfigService, useValue: { getOrThrow: () => 'test-secret-with-at-least-32-characters' } },
        { provide: PrismaService, useValue: prisma },
        JwtService,
        SessionGuard,
        { provide: APP_GUARD, useExisting: SessionGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    jwt = moduleRef.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const sessionCookie = async (tokenRole: JwtPayload['role']): Promise<string> =>
    `talent_os_session=${await jwt.sign({ sub: 'user-uuid', org: TENANT_ID, role: tokenRole })}`;

  const userRow = (dbRole: JwtPayload['role']) => ({ isActive: true, role: dbRole, organizationId: TENANT_ID });

  it('refuses a user demoted to viewer even while their token still says admin', async () => {
    prisma.user.findUnique.mockResolvedValue(userRow('viewer'));
    await request(app.getHttpServer())
      .patch(`/candidates/${CAND_ID}/stage`)
      .set('Cookie', await sessionCookie('admin'))
      .send({ hiring_stage_id: STAGE_ID })
      .expect(403);
    expect(candidates.updateStage).not.toHaveBeenCalled();
  });

  it('lets a user promoted to member through even while their token still says viewer', async () => {
    prisma.user.findUnique.mockResolvedValue(userRow('member'));
    await request(app.getHttpServer())
      .patch(`/candidates/${CAND_ID}/stage`)
      .set('Cookie', await sessionCookie('viewer'))
      .send({ hiring_stage_id: STAGE_ID })
      .expect(200);
    expect(candidates.updateStage).toHaveBeenCalledTimes(1);
  });

  it('answers 401, not 403, without a session cookie: the session check runs first', async () => {
    await request(app.getHttpServer()).delete(`/jobs/${JOB_ID}/hard`).expect(401);
    expect(jobs.hardDeleteJob).not.toHaveBeenCalled();
  });
});
