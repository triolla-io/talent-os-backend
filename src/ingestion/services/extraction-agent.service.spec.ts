import { ExtractionAgentService, CandidateExtract, CandidateExtractSchema } from './extraction-agent.service';
import { ConfigService } from '@nestjs/config';

// Mock the 'ai' module's generateObject so tests don't hit real network
jest.mock('ai', () => ({
  generateObject: jest.fn(),
}));

import { generateObject } from 'ai';

const mockGenerateObject = generateObject as jest.MockedFunction<typeof generateObject>;

export function mockCandidateExtract(
  overrides: Partial<CandidateExtract> = {},
): CandidateExtract {
  return {
    fullName: 'Jane Doe',
    email: 'jane.doe@example.com',
    phone: '+1-555-0100',
    currentRole: 'Senior Software Engineer',
    yearsExperience: 7,
    skills: ['TypeScript', 'Node.js', 'PostgreSQL'],
    summary: 'Experienced engineer with 7 years building TypeScript backends. Strong in distributed systems and database design.',
    source: 'direct',
    suspicious: false,
    ...overrides,
  };
}

function makeService(): ExtractionAgentService {
  const configService = {
    get: jest.fn().mockReturnValue('fake-openrouter-key'),
  } as unknown as ConfigService;
  return new ExtractionAgentService(configService);
}

describe('ExtractionAgentService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // 4-01-02: AIEX-03 — optional fields can be null without schema errors
  it('optional fields can be null', () => {
    const partial: CandidateExtract = {
      fullName: 'John Smith',
      email: null,
      phone: null,
      currentRole: null,
      yearsExperience: null,
      skills: [],
      summary: null,
      source: 'direct',
      suspicious: false,
    };
    expect(() =>
      CandidateExtractSchema.parse({ ...partial }),
    ).not.toThrow();
  });

  // 4-01-05: AIEX-03 — skills defaults to empty array
  it('skills defaults to empty array', () => {
    const parsed = CandidateExtractSchema.parse({
      fullName: 'Test User',
      email: null,
      phone: null,
      currentRole: null,
      yearsExperience: null,
      skills: [],
      summary: null,
    });
    expect(parsed.skills).toEqual([]);
    expect(parsed.source).toBe('direct'); // default applies
  });

  // New: When generateObject resolves, returns AI result merged with suspicious flag
  it('returns AI result merged with suspicious flag on success', async () => {
    const aiResult = {
      fullName: 'Alice Smith',
      email: 'alice@example.com',
      phone: '+44-7700-900000',
      currentRole: 'Product Manager',
      yearsExperience: 5,
      skills: ['Strategy', 'Roadmapping'],
      summary: 'PM with 5 years experience. Skilled in roadmapping and stakeholder management.',
      source: 'linkedin' as const,
    };

    mockGenerateObject.mockResolvedValueOnce({ object: aiResult } as any);

    const service = makeService();
    const result = await service.extract('some cv text', false);

    expect(result.fullName).toBe('Alice Smith');
    expect(result.email).toBe('alice@example.com');
    expect(result.suspicious).toBe(false);
    expect(result.source).toBe('linkedin');
  });

  // New: suspicious=true is propagated on success
  it('propagates suspicious=true from input on success', async () => {
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        fullName: 'Bob Jones',
        email: null,
        phone: null,
        currentRole: null,
        yearsExperience: null,
        skills: [],
        summary: null,
        source: 'direct' as const,
      },
    } as any);

    const service = makeService();
    const result = await service.extract('some text', true);
    expect(result.suspicious).toBe(true);
  });

  // New: When generateObject rejects, returns safe fallback without throwing
  it('returns safe fallback when generateObject rejects — does not throw', async () => {
    mockGenerateObject.mockRejectedValueOnce(new Error('Network timeout'));

    const service = makeService();
    const result = await service.extract('some text', false);

    expect(result).toBeDefined();
    expect(result.fullName).toBe('');
    expect(result.email).toBeNull();
    expect(result.phone).toBeNull();
    expect(result.currentRole).toBeNull();
    expect(result.yearsExperience).toBeNull();
    expect(result.skills).toEqual([]);
    expect(result.summary).toBeNull();
    expect(result.source).toBe('direct');
    expect(result.suspicious).toBe(false);
  });

  // New: Fallback shape passes CandidateExtractSchema.parse()
  it('fallback shape satisfies CandidateExtractSchema', async () => {
    mockGenerateObject.mockRejectedValueOnce(new Error('AI failure'));

    const service = makeService();
    const result = await service.extract('some text', false);

    // strip suspicious (not part of schema) and validate shape
    const { suspicious: _, ...schemaPart } = result;
    expect(() => CandidateExtractSchema.parse(schemaPart)).not.toThrow();
  });

  // New: suspicious flag propagates in fallback case too
  it('propagates suspicious=true in fallback case', async () => {
    mockGenerateObject.mockRejectedValueOnce(new Error('Quota exceeded'));

    const service = makeService();
    const result = await service.extract('some text', true);
    expect(result.suspicious).toBe(true);
  });
});
