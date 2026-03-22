import { ExtractionAgentService, CandidateExtract } from './extraction-agent.service';

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

describe('ExtractionAgentService', () => {
  let service: ExtractionAgentService;

  beforeEach(() => {
    service = new ExtractionAgentService();
  });

  // 4-01-01: AIEX-02 — mock returns all required fields including fullName
  it.todo('mock extract returns all CandidateExtract fields');

  // 4-01-02: AIEX-03 — optional fields are nullable in schema; mock can return them as null
  it.todo('optional fields can be null');

  // 4-01-03: AIEX-01 — suspicious flag passed through onto result object
  it.todo('suspicious flag passed through as metadata');

  // 4-01-04: AIEX-02 — source enum defaults to direct when not detected
  it.todo('source defaults to direct');

  // 4-01-05: AIEX-03 — skills defaults to empty array when none detected
  it.todo('skills defaults to empty array');
});
