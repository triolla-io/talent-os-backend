import { Test, TestingModule } from '@nestjs/testing';
import { ScoringAgentService, ScoreSchema, ScoringInput } from './scoring.service';

const mockScoringInput = (overrides: Partial<ScoringInput> = {}): ScoringInput => ({
  cvText: 'Experienced TypeScript engineer with Node.js background.',
  candidateFields: {
    currentRole: 'Senior Software Engineer',
    yearsExperience: 7,
    skills: ['TypeScript', 'Node.js'],
  },
  job: {
    title: 'Backend Engineer',
    description: 'Build scalable APIs.',
    requirements: ['TypeScript', 'PostgreSQL'],
  },
  ...overrides,
});

describe('ScoringAgentService', () => {
  let service: ScoringAgentService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ScoringAgentService],
    }).compile();

    service = module.get<ScoringAgentService>(ScoringAgentService);
  });

  afterEach(() => { jest.clearAllMocks(); });

  // SCOR-03: score() returns ScoreResult shape
  it('SCOR-03: score() returns score, reasoning, strengths, gaps', async () => {
    const result = await service.score(mockScoringInput());
    expect(result.score).toBe(72);
    expect(typeof result.reasoning).toBe('string');
    expect(Array.isArray(result.strengths)).toBe(true);
    expect(Array.isArray(result.gaps)).toBe(true);
  });

  // SCOR-05: modelUsed is recorded
  it('SCOR-05: score() returns modelUsed = "claude-sonnet-4-6"', async () => {
    const result = await service.score(mockScoringInput());
    expect(result.modelUsed).toBe('claude-sonnet-4-6');
  });

  // SCOR-03 shape: result passes ScoreSchema validation
  it('SCOR-03: score result satisfies ScoreSchema', async () => {
    const result = await service.score(mockScoringInput());
    expect(() => ScoreSchema.parse(result)).not.toThrow();
  });
});
