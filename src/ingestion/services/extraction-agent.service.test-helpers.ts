import { CandidateExtract } from './extraction-agent.service';

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
