import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CandidatesService } from './candidates.service';
import { PrismaService } from '../prisma/prisma.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';

// Helper to build a mock candidate row as Prisma would return it
function mockCandidate(overrides: Partial<{
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  currentRole: string | null;
  location: string | null;
  cvFileUrl: string | null;
  source: string;
  createdAt: Date;
  skills: string[];
  applications: { scores: { score: number }[] }[];
  duplicateFlags: { id: string }[];
}> = {}) {
  return {
    id: 'cand-1',
    fullName: 'John Doe',
    email: 'john@example.com',
    phone: null,
    currentRole: 'Software Engineer',
    location: 'Tel Aviv',
    cvFileUrl: 'https://r2.example.com/cv.pdf',
    source: 'linkedin',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    skills: ['TypeScript', 'React'],
    applications: [],
    duplicateFlags: [],
    ...overrides,
  };
}

describe('CandidatesService', () => {
  let service: CandidatesService;
  let prismaMock: { candidate: { findMany: jest.Mock } };
  let configMock: { get: jest.Mock };

  beforeEach(async () => {
    prismaMock = {
      candidate: {
        findMany: jest.fn(),
      },
    };
    configMock = {
      get: jest.fn().mockReturnValue(TENANT_ID),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CandidatesService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ConfigService, useValue: configMock },
      ],
    }).compile();

    service = module.get<CandidatesService>(CandidatesService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // Test 1: no params → returns all candidates with ai_score computed from nested scores
  it('returns all candidates scoped to tenantId with ai_score computed', async () => {
    prismaMock.candidate.findMany.mockResolvedValue([
      mockCandidate({
        applications: [{ scores: [{ score: 80 }, { score: 65 }] }],
        duplicateFlags: [],
      }),
    ]);

    const result = await service.findAll();

    expect(prismaMock.candidate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: TENANT_ID }),
      }),
    );
    expect(result.candidates).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.candidates[0].ai_score).toBe(80); // MAX of [80, 65]
    expect(result.candidates[0].full_name).toBe('John Doe');
    expect(result.candidates[0].is_duplicate).toBe(false);
  });

  // Test 2: q='jane' → WHERE contains jane in fullName/email/currentRole
  it('filters by q param using ILIKE on fullName, email, currentRole', async () => {
    prismaMock.candidate.findMany.mockResolvedValue([]);

    await service.findAll('jane');

    expect(prismaMock.candidate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: TENANT_ID,
          OR: [
            { fullName: { contains: 'jane', mode: 'insensitive' } },
            { email: { contains: 'jane', mode: 'insensitive' } },
            { currentRole: { contains: 'jane', mode: 'insensitive' } },
          ],
        }),
      }),
    );
  });

  // Test 3: filter='high-score' → only candidates with ai_score >= 70
  it('filter=high-score returns only candidates with ai_score >= 70', async () => {
    prismaMock.candidate.findMany.mockResolvedValue([
      mockCandidate({ id: 'cand-1', applications: [{ scores: [{ score: 85 }] }] }),
      mockCandidate({ id: 'cand-2', applications: [{ scores: [{ score: 50 }] }] }),
      mockCandidate({ id: 'cand-3', applications: [] }), // no scores → null
    ]);

    const result = await service.findAll(undefined, 'high-score');

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].id).toBe('cand-1');
    expect(result.candidates[0].ai_score).toBe(85);
    expect(result.total).toBe(1);
  });

  // Test 4: filter='available' → WHERE applications.none in hired/rejected
  it('filter=available adds applications.none condition to where clause', async () => {
    prismaMock.candidate.findMany.mockResolvedValue([]);

    await service.findAll(undefined, 'available');

    expect(prismaMock.candidate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: TENANT_ID,
          applications: { none: { stage: { in: ['hired', 'rejected'] } } },
        }),
      }),
    );
  });

  // Test 5: filter='referred' → WHERE source='referral'
  it('filter=referred adds source=referral condition to where clause', async () => {
    prismaMock.candidate.findMany.mockResolvedValue([]);

    await service.findAll(undefined, 'referred');

    expect(prismaMock.candidate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: TENANT_ID,
          source: 'referral',
        }),
      }),
    );
  });

  // Test 6: filter='duplicates' → WHERE duplicateFlags.some reviewed=false
  it('filter=duplicates adds duplicateFlags.some condition to where clause', async () => {
    prismaMock.candidate.findMany.mockResolvedValue([]);

    await service.findAll(undefined, 'duplicates');

    expect(prismaMock.candidate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: TENANT_ID,
          duplicateFlags: { some: { reviewed: false } },
        }),
      }),
    );
  });

  // Test 7: no scores → ai_score is null
  it('returns ai_score=null when candidate has no application scores', async () => {
    prismaMock.candidate.findMany.mockResolvedValue([
      mockCandidate({ applications: [] }),
    ]);

    const result = await service.findAll();

    expect(result.candidates[0].ai_score).toBeNull();
  });

  // Test 8: no unreviewed flags → is_duplicate is false
  it('returns is_duplicate=false when all duplicate_flags are reviewed', async () => {
    prismaMock.candidate.findMany.mockResolvedValue([
      mockCandidate({ duplicateFlags: [] }), // reviewed=false flags filtered in select — empty means none unreviewed
    ]);

    const result = await service.findAll();

    expect(result.candidates[0].is_duplicate).toBe(false);
  });
});
