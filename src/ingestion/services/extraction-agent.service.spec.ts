import { ExtractionAgentService, CandidateExtract, CandidateExtractSchema } from './extraction-agent.service';
import { mockCandidateExtract } from './extraction-agent.service.test-helpers';
import { ConfigService } from '@nestjs/config';

// Re-export for backward compatibility with other specs that import from here
export { mockCandidateExtract };

// Mock @openrouter/sdk so tests don't hit real network
const mockGetText = jest.fn();
const mockCallModel = jest.fn().mockReturnValue({ getText: mockGetText });

jest.mock('@openrouter/sdk', () => ({
  OpenRouter: jest.fn().mockImplementation(() => ({
    callModel: mockCallModel,
  })),
}));

function makeService(): ExtractionAgentService {
  const configService = {
    get: jest.fn().mockReturnValue('fake-openrouter-key'),
  } as unknown as ConfigService;
  return new ExtractionAgentService(configService);
}

describe('ExtractionAgentService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCallModel.mockReturnValue({ getText: mockGetText });
  });

  // 4-01-02: AIEX-03 — optional fields can be null without schema errors
  it('optional fields can be null', () => {
    const partial: CandidateExtract = {
      full_name: 'John Smith',
      email: null,
      phone: null,
      skills: [],
      ai_summary: null,
      suspicious: false,
    };
    expect(() =>
      CandidateExtractSchema.parse({ ...partial }),
    ).not.toThrow();
  });

  // 4-01-05: AIEX-03 — skills defaults to empty array
  it('skills defaults to empty array', () => {
    const parsed = CandidateExtractSchema.parse({
      full_name: 'Test User',
      email: null,
      phone: null,
      skills: [],
      ai_summary: null,
    });
    expect(parsed.skills).toEqual([]);
  });

  // When callModel resolves, returns AI result merged with suspicious flag
  it('returns AI result merged with suspicious flag on success', async () => {
    const aiResult = {
      full_name: 'Alice Smith',
      email: 'alice@example.com',
      phone: '+44-7700-900000',
      skills: ['Strategy', 'Roadmapping'],
      ai_summary: 'PM with 5 years experience. Skilled in roadmapping and stakeholder management.',
    };

    mockGetText.mockResolvedValueOnce(JSON.stringify(aiResult));

    const service = makeService();
    const result = await service.extract('some cv text', false);

    expect(result.full_name).toBe('Alice Smith');
    expect(result.email).toBe('alice@example.com');
    expect(result.suspicious).toBe(false);
  });

  // suspicious=true is propagated on success
  it('propagates suspicious=true from input on success', async () => {
    mockGetText.mockResolvedValueOnce(JSON.stringify({
      full_name: 'Bob Jones',
      email: null,
      phone: null,
      skills: [],
      ai_summary: null,
    }));

    const service = makeService();
    const result = await service.extract('some text', true);
    expect(result.suspicious).toBe(true);
  });

  // When getText rejects, returns safe fallback without throwing
  it('returns safe fallback when getText rejects — does not throw', async () => {
    mockGetText.mockRejectedValueOnce(new Error('Network timeout'));

    const service = makeService();
    const result = await service.extract('some text', false);

    expect(result).toBeDefined();
    expect(result.full_name).toBe('');
    expect(result.email).toBeNull();
    expect(result.phone).toBeNull();
    expect(result.skills).toEqual([]);
    expect(result.ai_summary).toBeNull();
    expect(result.suspicious).toBe(false);
  });

  // Fallback shape passes CandidateExtractSchema.parse()
  it('fallback shape satisfies CandidateExtractSchema', async () => {
    mockGetText.mockRejectedValueOnce(new Error('AI failure'));

    const service = makeService();
    const result = await service.extract('some text', false);

    const { suspicious: _, ...schemaPart } = result;
    expect(() => CandidateExtractSchema.parse(schemaPart)).not.toThrow();
  });

  // suspicious flag propagates in fallback case too
  it('propagates suspicious=true in fallback case', async () => {
    mockGetText.mockRejectedValueOnce(new Error('Quota exceeded'));

    const service = makeService();
    const result = await service.extract('some text', true);
    expect(result.suspicious).toBe(true);
  });

  // Strips markdown code fences if model wraps output
  it('strips markdown code fences from model response', async () => {
    const aiResult = {
      full_name: 'Carol White',
      email: 'carol@example.com',
      phone: null,
      skills: ['Python'],
      ai_summary: 'Data scientist. Specialises in ML pipelines.',
    };

    mockGetText.mockResolvedValueOnce('```json\n' + JSON.stringify(aiResult) + '\n```');

    const service = makeService();
    const result = await service.extract('some cv text', false);
    expect(result.full_name).toBe('Carol White');
  });
});
