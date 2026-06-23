import { apiEnvSchema, envSchema } from './env';

const validEnv = {
  DATABASE_URL: 'postgresql://triolla:password@localhost:5432/triolla',
  REDIS_URL: 'redis://localhost:6379',
  // ANTHROPIC_API_KEY: 'sk-ant-test',
  OPENROUTER_API_KEY: 'sk-or-test',
  MAILGUN_WEBHOOK_SIGNING_KEY: 'test-signing-key',
  TENANT_ID: '123e4567-e89b-12d3-a456-426614174000',
  R2_ACCOUNT_ID: 'acc123',
  R2_ACCESS_KEY_ID: 'key123',
  R2_SECRET_ACCESS_KEY: 'secret123',
  R2_BUCKET_NAME: 'triolla-cvs',
  NODE_ENV: 'test' as const,
  JWT_SECRET: 'test-jwt-secret-for-unit-tests-minimum-32chars',
  JIRA_BASE_URL: 'https://example.atlassian.net',
  JIRA_EMAIL: 'test@example.com',
  JIRA_API_TOKEN: 'jira-token',
  JIRA_DEFAULT_ASSIGNEE_ACCOUNT_ID: 'acc-daniel',
  PM_HOLD_TOKEN_SECRET: 's'.repeat(32),
};

describe('envSchema', () => {
  it('parses a valid environment object', () => {
    expect(() => envSchema.parse(validEnv)).not.toThrow();
  });

  it('throws when DATABASE_URL is missing', () => {
    const { DATABASE_URL, ...rest } = validEnv;
    expect(() => envSchema.parse(rest)).toThrow();
  });

  it('throws when DATABASE_URL is not a valid URL', () => {
    expect(() => envSchema.parse({ ...validEnv, DATABASE_URL: 'not-a-url' })).toThrow();
  });

  it('throws when TENANT_ID is not a valid UUID', () => {
    expect(() => envSchema.parse({ ...validEnv, TENANT_ID: 'not-a-uuid' })).toThrow();
  });

  // it('throws when ANTHROPIC_API_KEY is empty string', () => {
  //   expect(() => envSchema.parse({ ...validEnv, ANTHROPIC_API_KEY: '' })).toThrow();
  // });

  it('defaults NODE_ENV to production when omitted', () => {
    const { NODE_ENV, ...rest } = validEnv;
    const result = envSchema.parse(rest);
    expect(result.NODE_ENV).toBe('production');
  });

  // The BullMQ worker validates against the base envSchema and never calls Jira, so it must
  // boot without Jira credentials — otherwise a separate worker deployment crashes on startup.
  it('worker schema (envSchema) parses without Jira credentials', () => {
    const { JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, ...noJira } = validEnv;
    expect(() => envSchema.parse(noJira)).not.toThrow();
  });

  // The API runs PM Bridge, so its schema must require Jira credentials (fail fast at startup).
  it('api schema (apiEnvSchema) parses a valid environment object', () => {
    expect(() => apiEnvSchema.parse(validEnv)).not.toThrow();
  });

  it('api schema (apiEnvSchema) throws when Jira credentials are missing', () => {
    const { JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, ...noJira } = validEnv;
    expect(() => apiEnvSchema.parse(noJira)).toThrow();
  });
});

describe('apiEnvSchema PM-Bridge smart-intake vars', () => {
  it('requires JIRA_DEFAULT_ASSIGNEE_ACCOUNT_ID and a ≥32-char PM_HOLD_TOKEN_SECRET, defaults the notify email', () => {
    const { JIRA_DEFAULT_ASSIGNEE_ACCOUNT_ID, PM_HOLD_TOKEN_SECRET, ...missing } = validEnv;
    expect(() => apiEnvSchema.parse(missing)).toThrow();
    expect(() => apiEnvSchema.parse({ ...validEnv, PM_HOLD_TOKEN_SECRET: 'too-short' })).toThrow();
    const ok = apiEnvSchema.parse(validEnv);
    expect(ok.PM_HOLD_NOTIFY_EMAIL).toBe('daniel.s@triolla.io');
  });

  it('worker base schema does NOT require the API-only PM-Bridge vars', () => {
    const { JIRA_DEFAULT_ASSIGNEE_ACCOUNT_ID, PM_HOLD_TOKEN_SECRET, ...noApiVars } = validEnv;
    expect(() => envSchema.parse(noApiVars)).not.toThrow();
  });
});
