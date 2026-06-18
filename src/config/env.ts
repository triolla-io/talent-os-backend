import { z } from 'zod';

export const envSchema = z.object({
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  // ANTHROPIC_API_KEY: z.string().min(1),
  OPENROUTER_API_KEY: z.string().min(1),
  POSTMARK_WEBHOOK_TOKEN: z.string().min(1),
  TENANT_ID: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Invalid UUID').optional(),
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET_NAME: z.string().min(1),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  // Auth email via nodemailer SMTP (provider-agnostic — use Resend via smtp.resend.com)
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  FRONTEND_URL: z.url().default('http://localhost:5173'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  EXTRACTION_MODEL: z.string().default('openai/gpt-4o-mini'),
  SCORING_MODEL: z.string().default('openai/gpt-4o-mini'),
  // PM Bridge — Jira integration.
  // Optional in this shared/base schema so the BullMQ worker (which never calls Jira) can boot
  // without these. The API process re-requires JIRA_BASE_URL/EMAIL/API_TOKEN via apiEnvSchema.
  JIRA_BASE_URL: z.url().optional(),
  JIRA_EMAIL: z.string().min(1).optional(),
  JIRA_API_TOKEN: z.string().min(1).optional(),
  JIRA_PROJECT_KEY: z.string().default('TO'),
  JIRA_SPRINT_ID: z.coerce.number().int().positive().optional(),
  PM_BRIDGE_ALLOWLIST: z.string().default(''),
  PM_BRIDGE_MODEL: z.string().default('anthropic/claude-sonnet-4.6'),
});

export type Env = z.infer<typeof envSchema>;

// API-process schema. PM Bridge runs only in the API, so Jira credentials are required there:
// the API fails fast at startup if they're missing. The worker validates against the base
// envSchema above and therefore boots without any Jira configuration.
export const apiEnvSchema = envSchema.extend({
  JIRA_BASE_URL: z.url(),
  JIRA_EMAIL: z.string().min(1),
  JIRA_API_TOKEN: z.string().min(1),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;
