import { CandidateExtract } from './extraction-agent.service';

export function mockCandidateExtract(
  overrides: Partial<CandidateExtract> = {},
): CandidateExtract {
  return {
    full_name: 'Jane Doe',
    email: 'jane.doe@example.com',
    phone: '+1-555-0100',
    skills: ['TypeScript', 'Node.js', 'PostgreSQL'],
    ai_summary: 'Experienced engineer with 7 years building TypeScript backends. Strong in distributed systems and database design.',
    suspicious: false,
    ...overrides,
  };
}
