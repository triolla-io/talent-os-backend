import { Test, TestingModule } from '@nestjs/testing';
import { DedupService } from './dedup.service';
import { PrismaService } from '../prisma/prisma.service';
import { CandidateExtract } from '../ingestion/services/extraction-agent.service';

export function mockCandidateDedupExtract(
  overrides: Partial<CandidateExtract> = {},
): CandidateExtract {
  return {
    full_name: 'Jane Doe',
    email: 'jane.doe@example.com',
    phone: '+1-555-0100',
    current_role: 'Software Engineer',
    years_experience: 5,
    location: 'Tel Aviv, Israel',
    skills: ['TypeScript', 'Node.js'],
    ai_summary: 'Experienced engineer.',
    source_hint: null,
    source_agency: null,
    ...overrides,
  };
}

describe('DedupService', () => {
  let service: DedupService;
  let prisma: {
    candidate: {
      create: jest.Mock;
      update: jest.Mock;
      upsert: jest.Mock;
      findFirst: jest.Mock;
    };
    duplicateFlag: { upsert: jest.Mock };
    $queryRaw: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      candidate: {
        create: jest.fn().mockResolvedValue({ id: 'new-candidate-id' }),
        update: jest.fn().mockResolvedValue({}),
        upsert: jest.fn().mockResolvedValue({ id: 'upserted-id' }),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      duplicateFlag: {
        upsert: jest.fn().mockResolvedValue({}),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DedupService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<DedupService>(DedupService);
  });

  afterEach(() => jest.clearAllMocks());

  // DEDUP-01: phone null → returns phone_missing sentinel
  it('DEDUP-01: phone null returns { match: null, confidence: 0, fields: ["phone_missing"] }', async () => {
    const extract = mockCandidateDedupExtract({ phone: null });

    const result = await service.check(extract, 'tenant-abc');

    expect(result).toEqual({ match: null, confidence: 0, fields: ['phone_missing'] });
    // $queryRaw must NOT be called — phone check short-circuits immediately
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  // DEDUP-02: exact phone match (digits only, formatting varies) → confidence 1.0
  it('DEDUP-02: exact phone match returns confidence 1.0 and fields=["phone"]', async () => {
    prisma.$queryRaw.mockResolvedValue([{ id: 'existing-123' }]);
    const extract = mockCandidateDedupExtract({ phone: '+1-555-0100' });

    const result = await service.check(extract, 'tenant-abc');

    expect(result).toEqual({
      match: { id: 'existing-123' },
      confidence: 1.0,
      fields: ['phone'],
    });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  // DEDUP-03: phone provided but no DB match → returns null (new candidate)
  it('DEDUP-03: phone provided but no DB match returns null', async () => {
    prisma.$queryRaw.mockResolvedValue([]); // no match
    const extract = mockCandidateDedupExtract({ phone: '+1-555-9999' });

    const result = await service.check(extract, 'tenant-abc');

    expect(result).toBeNull();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  // DEDUP-06: email already exists in tenant → returns email match so caller REUSES the row.
  // Email is the strongest key and the DB enforces one email per tenant; this prevents the
  // INSERT that would violate idx_candidates_tenant_email_unique and drop the candidate.
  it('DEDUP-06: existing email returns { match, confidence 1.0, fields: ["email"] } and skips phone query', async () => {
    prisma.candidate.findFirst.mockResolvedValue({ id: 'existing-by-email' });
    const extract = mockCandidateDedupExtract({ email: 'jane.doe@example.com', phone: '+1-555-0100' });

    const result = await service.check(extract, 'tenant-abc');

    expect(result).toEqual({ match: { id: 'existing-by-email' }, confidence: 1.0, fields: ['email'] });
    expect(prisma.candidate.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 'tenant-abc', email: 'jane.doe@example.com' } }),
    );
    // email match short-circuits — phone lookup never runs
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  // DEDUP-07: null email → skip the email lookup entirely, fall through to phone logic.
  it('DEDUP-07: null email skips email lookup and uses phone match', async () => {
    prisma.$queryRaw.mockResolvedValue([{ id: 'phone-match-id' }]);
    const extract = mockCandidateDedupExtract({ email: null, phone: '+1-555-0100' });

    const result = await service.check(extract, 'tenant-abc');

    expect(prisma.candidate.findFirst).not.toHaveBeenCalled();
    expect(result).toEqual({ match: { id: 'phone-match-id' }, confidence: 1.0, fields: ['phone'] });
  });

  // DEDUP-04: createFlag with fields=['phone_missing'] and matchedCandidateId=null self-references candidateId
  it('DEDUP-04: createFlag with phone_missing self-references candidateId in upsert', async () => {
    await service.createFlag('cand-id', null, 0, 'tenant-abc', ['phone_missing']);

    expect(prisma.duplicateFlag.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          idx_duplicates_pair: {
            tenantId: 'tenant-abc',
            candidateId: 'cand-id',
            matchedCandidateId: 'cand-id', // self-reference when null
          },
        },
        create: expect.objectContaining({
          reviewed: false,
          matchFields: ['phone_missing'],
          confidence: expect.anything(),
        }),
        update: {},
      }),
    );
  });

  // DEDUP-05: createFlag with fields=['phone'] passes through to matchFields in upsert
  it('DEDUP-05: createFlag with fields=["phone"] passes matchFields=["phone"] to upsert', async () => {
    await service.createFlag('new-id', 'match-id', 1.0, 'tenant-abc', ['phone']);

    expect(prisma.duplicateFlag.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          idx_duplicates_pair: {
            tenantId: 'tenant-abc',
            candidateId: 'new-id',
            matchedCandidateId: 'match-id',
          },
        },
        create: expect.objectContaining({
          reviewed: false,
          matchFields: ['phone'],
        }),
        update: {},
      }),
    );
  });
});
