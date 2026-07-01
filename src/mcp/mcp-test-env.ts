// Test-only helper. McpModule's `ConfigModule.forRoot({ validate })` runs at IMPORT
// time (decorator evaluation), so the env it validates against must exist before
// `mcp.module.ts` is required. Import this module FIRST in any MCP spec so these
// defaults are set before McpModule loads. Real process.env values (CI, .env) win —
// we only fill keys that are absent.
const defaults: Record<string, string> = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379',
  OPENROUTER_API_KEY: 'test-openrouter',
  MAILGUN_WEBHOOK_SIGNING_KEY: 'test-mailgun',
  R2_ACCOUNT_ID: 'acct',
  R2_ACCESS_KEY_ID: 'akid',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_BUCKET_NAME: 'bucket',
  JWT_SECRET: 'j'.repeat(40),
  GOOGLE_CLIENT_ID: 'test-google',
  MCP_PUBLIC_URL: 'http://localhost:3100',
  MCP_JWT_SECRET: 'm'.repeat(40),
};
for (const [k, v] of Object.entries(defaults)) {
  if (!process.env[k]) process.env[k] = v;
}
export {};
