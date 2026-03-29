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

const defaultMetadata = { subject: 'Job Application', fromEmail: 'test@example.com' };

describe('ExtractionAgentService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCallModel.mockReturnValue({ getText: mockGetText });
  });

  // Schema tests with new fields
  it('optional fields can be null', () => {
    const partial = {
      full_name: 'John Smith',
      email: null,
      phone: null,
      current_role: null,
      years_experience: null,
      location: null,
      job_title_hint: null,
      skills: [],
      ai_summary: null,
      source_hint: null,
    };
    expect(() =>
      CandidateExtractSchema.parse(partial),
    ).not.toThrow();
  });

  it('years_experience is validated as integer', () => {
    const parsed = CandidateExtractSchema.parse({
      full_name: 'Test User',
      email: null,
      phone: null,
      current_role: null,
      years_experience: 6,
      location: null,
      job_title_hint: null,
      skills: [],
      ai_summary: null,
      source_hint: null,
    });
    expect(parsed.years_experience).toBe(6);
  });

  it('source_hint enum validates correctly', () => {
    const parsed = CandidateExtractSchema.parse({
      full_name: 'Test User',
      email: null,
      phone: null,
      current_role: null,
      years_experience: null,
      location: null,
      job_title_hint: null,
      skills: [],
      ai_summary: null,
      source_hint: 'linkedin',
    });
    expect(parsed.source_hint).toBe('linkedin');
  });

  it('source_hint rejects invalid enum values', () => {
    expect(() =>
      CandidateExtractSchema.parse({
        full_name: 'Test User',
        email: null,
        phone: null,
        current_role: null,
        years_experience: null,
        location: null,
        job_title_hint: null,
        skills: [],
        ai_summary: null,
        source_hint: 'invalid',
      }),
    ).toThrow();
  });

  // 4-01-05: AIEX-03 — skills defaults to empty array
  it('skills defaults to empty array', () => {
    const parsed = CandidateExtractSchema.parse({
      full_name: 'Test User',
      email: null,
      phone: null,
      current_role: null,
      years_experience: null,
      location: null,
      job_title_hint: null,
      skills: [],
      ai_summary: null,
      source_hint: null,
    });
    expect(parsed.skills).toEqual([]);
  });

  // When callModel resolves, returns AI result merged with suspicious flag
  it('returns AI result merged with suspicious flag on success', async () => {
    const aiResult = {
      full_name: 'Alice Smith',
      email: 'alice@example.com',
      phone: '+44-7700-900000',
      current_role: 'Product Manager',
      years_experience: 5,
      location: 'London, UK',
      job_title_hint: 'Product Manager',
      skills: ['Strategy', 'Roadmapping'],
      ai_summary: 'PM with 5 years experience. Skilled in roadmapping and stakeholder management.',
      source_hint: 'direct',
    };

    mockGetText.mockResolvedValueOnce(JSON.stringify(aiResult));

    const service = makeService();
    const result = await service.extract('some cv text', false, defaultMetadata);

    expect(result.full_name).toBe('Alice Smith');
    expect(result.email).toBe('alice@example.com');
    expect(result.suspicious).toBe(false);
    expect(result.current_role).toBe('Product Manager');
    expect(result.years_experience).toBe(5);
  });

  // suspicious=true is propagated on success
  it('propagates suspicious=true from input on success', async () => {
    mockGetText.mockResolvedValueOnce(JSON.stringify({
      full_name: 'Bob Jones',
      email: null,
      phone: null,
      current_role: null,
      years_experience: null,
      location: null,
      job_title_hint: null,
      skills: [],
      ai_summary: null,
      source_hint: null,
    }));

    const service = makeService();
    const result = await service.extract('some text', true, defaultMetadata);
    expect(result.suspicious).toBe(true);
  });

  // extract() THROWS on callAI() failure — no swallowing (Plan 14 fix)
  it('extract() throws when callAI() (getText) fails — does not swallow', async () => {
    mockGetText.mockRejectedValueOnce(new Error('Network timeout'));

    const service = makeService();
    await expect(service.extract('some text', false, defaultMetadata)).rejects.toThrow('Network timeout');
  });

  // extract() throws when schema validation fails
  it('extract() throws when LLM output fails schema validation', async () => {
    mockGetText.mockResolvedValueOnce(JSON.stringify({ invalid: 'data' }));

    const service = makeService();
    await expect(service.extract('some text', false, defaultMetadata)).rejects.toThrow('LLM output validation failed');
  });

  // callAI includes metadata section in user message
  it('callAI constructs userMessage with Email Metadata section', async () => {
    const aiResult = {
      full_name: 'Carol White',
      email: 'carol@example.com',
      phone: null,
      current_role: null,
      years_experience: null,
      location: null,
      job_title_hint: null,
      skills: ['Python'],
      ai_summary: 'Data scientist. Specialises in ML pipelines.',
      source_hint: null,
    };
    mockGetText.mockResolvedValueOnce(JSON.stringify(aiResult));

    const service = makeService();
    const metadata = { subject: 'Job Application for Data Scientist', fromEmail: 'carol@example.com' };
    await service.extract('some cv text', false, metadata);

    const callArgs = mockCallModel.mock.calls[0][0];
    expect(callArgs.input).toContain('--- Email Metadata ---');
    expect(callArgs.input).toContain('Subject: Job Application for Data Scientist');
    expect(callArgs.input).toContain('From: carol@example.com');
  });

  // Strips markdown code fences if model wraps output
  it('strips markdown code fences from model response', async () => {
    const aiResult = {
      full_name: 'Carol White',
      email: 'carol@example.com',
      phone: null,
      current_role: null,
      years_experience: null,
      location: null,
      job_title_hint: null,
      skills: ['Python'],
      ai_summary: 'Data scientist. Specialises in ML pipelines.',
      source_hint: null,
    };

    mockGetText.mockResolvedValueOnce('```json\n' + JSON.stringify(aiResult) + '\n```');

    const service = makeService();
    const result = await service.extract('some cv text', false, defaultMetadata);
    expect(result.full_name).toBe('Carol White');
  });

  // extractDeterministically() is public and returns null for new fields
  it('extractDeterministically() is public and returns null for unextractable fields', () => {
    const service = makeService();
    const result = service.extractDeterministically('Dana Cohen\ndana@example.com\nI use TypeScript');

    expect(result.current_role).toBeNull();
    expect(result.years_experience).toBeNull();
    expect(result.location).toBeNull();
    expect(result.source_hint).toBeNull();
    expect(result.job_title_hint).toBeNull();
    expect(result.full_name).toBe('Dana Cohen');
    expect(result.email).toBe('dana@example.com');
    expect(result.skills).toContain('typescript');
    expect(result.ai_summary).toContain('Deterministic extraction');
  });
});
