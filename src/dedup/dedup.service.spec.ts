import { Test, TestingModule } from '@nestjs/testing';
import { DedupService } from './dedup.service';
import { PrismaService } from '../prisma/prisma.service';

describe('DedupService', () => {
  let service: DedupService;
  let prisma: jest.Mocked<Partial<PrismaService>>;

  beforeEach(async () => {
    prisma = {
      candidate: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        upsert: jest.fn(),
      } as any,
      duplicateFlag: {
        upsert: jest.fn(),
      } as any,
      $queryRaw: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DedupService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<DedupService>(DedupService);
  });

  afterEach(() => jest.clearAllMocks());

  // DEDUP-01: pg_trgm query executes in PostgreSQL (no candidates loaded into app memory)
  it.todo('DEDUP-01: executes in PostgreSQL — $queryRaw called for fuzzy, no candidate array returned');

  // DEDUP-02: exact email match returns DedupResult with confidence 1.0
  it.todo('DEDUP-02: exact email match returns confidence 1.0 and fields=[email]');

  // DEDUP-03: fuzzy name match > 0.7 returns DedupResult with fields=[name]
  it.todo('DEDUP-03: fuzzy match name_sim > 0.7 returns confidence=name_sim and fields=[name]');

  // DEDUP-04: no match (no email, no fuzzy) returns null
  it.todo('DEDUP-04: no match returns null');

  // DEDUP-05: createFlag sets reviewed=false via upsert (never auto-merges)
  it.todo('DEDUP-05: createFlag upserts with reviewed=false on duplicate_flags');
});
