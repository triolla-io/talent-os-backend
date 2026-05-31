# Mailgun Migration Design

**Date:** 2026-05-28  
**Status:** Approved  
**Scope:** Replace Postmark (inbound) and Resend SMTP (outbound) with Mailgun

---

## Context

The current email setup uses two providers:

- **Inbound (CV intake):** Postmark inbound webhook → `POST /webhooks/email`. Postmark receives emails at their own inbound address; a Google Workspace forwarding rule routes `fun@triolla.io` → Postmark's inbound address.
- **Outbound (auth emails):** Nodemailer SMTP pointed at `smtp.resend.com` for magic links and invitations.

The goal is to consolidate to Mailgun for both, replacing the Postmark forwarding hack with a proper Mailgun-owned subdomain, and swapping SMTP credentials for outbound.

---

## What Changes

### Files modified (webhooks module only)

| File | Change |
|---|---|
| `src/webhooks/dto/postmark-payload.dto.ts` | Delete → new `mailgun-payload.dto.ts` |
| `src/webhooks/guards/postmark-auth.guard.ts` | Delete → new `mailgun-auth.guard.ts` |
| `src/webhooks/webhooks.controller.ts` | Update body parsing decorators, remove Postmark test ping detection |
| `src/webhooks/webhooks.service.ts` | Update field name mapping (Mailgun → internal job format) |
| `src/webhooks/webhooks.module.ts` | Implement `NestModule`, register multer middleware, swap guard reference |
| `src/main.ts` | Remove 10 MB JSON body limit (was needed for Postmark base64 blobs) |
| `.env.example` | Swap `POSTMARK_WEBHOOK_TOKEN` → `MAILGUN_WEBHOOK_SIGNING_KEY`, update SMTP vars |
| `local-test/run.js` | Update simulator: multipart/form-data + HMAC-SHA256 signature |

### Untouched

Worker, ingestion pipeline, storage service, scoring, dedup, auth/email service code, all non-webhook tests, queue job shape.

---

## Part A — Inbound Webhook

### Why it's non-trivial

Mailgun's inbound webhook format is fundamentally different from Postmark's:

| | Postmark | Mailgun |
|---|---|---|
| Content-Type | `application/json` | `multipart/form-data` |
| Attachments | Base64 strings inside JSON | Actual file uploads (`req.files`) |
| Auth mechanism | HTTP Basic Auth header | HMAC-SHA256 signature **inside the payload** |
| Body inflation | ~1.37× (base64 overhead) | None — native binary uploads |

### Multipart parsing order

NestJS guards run before interceptors. The `MailgunAuthGuard` needs `timestamp`, `token`, and `signature` from the parsed body. Solving this by registering multer as a **NestJS middleware** on the webhook route — middleware runs before guards.

```typescript
// webhooks.module.ts
export class WebhooksModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(multer({ storage: multer.memoryStorage() }).any())
      .forRoutes({ path: 'webhooks/email', method: RequestMethod.POST });
  }
}
```

Files land on `req.files`, form fields on `req.body` — both available to the guard and controller.

### Auth guard — `MailgunAuthGuard`

Mailgun embeds auth fields inside the multipart body:

- `timestamp` — Unix timestamp (string)
- `token` — random 50-char string (prevents double-processing)
- `signature` — `HMAC-SHA256(signingKey, timestamp + token)` hex digest

Verification logic:
1. Compute `HMAC-SHA256(MAILGUN_WEBHOOK_SIGNING_KEY, timestamp + token)`
2. Compare with `signature` using `timingSafeEqual` (timing-safe)
3. Reject if `|now − timestamp| > 300s` (replay protection)

### Payload schema — `MailgunPayloadSchema`

Mailgun field → internal mapping:

| Mailgun field | Internal field | Notes |
|---|---|---|
| `message-headers` (JSON array) | `messageId` | Extract `Message-Id` header value |
| `from` | `from` | From header value — more reliable than `sender` (MAIL FROM) when email passes through Google Workspace forwarding |
| `subject` | `subject` | |
| `body-plain` | `textBody` | Optional |
| `body-html` | `htmlBody` | Optional |
| `timestamp` | `date` | Unix int → ISO string |
| `req.files[].originalname` | `attachments[].name` | |
| `req.files[].buffer.toString('base64')` | `attachments[].content` | Keeps downstream format unchanged |
| `req.files[].mimetype` | `attachments[].contentType` | |
| `req.files[].size` | `attachments[].contentLength` | |

The internal `IngestEmailJob` queue shape is **unchanged** — only the parsing layer changes.

### Removed: Postmark test ping detection

`MessageID === '00000000-0000-0000-0000-000000000000'` was Postmark-specific. Removed. Mailgun's test webhook sends a real-looking payload; the worker handles no-attachment emails gracefully.

### New env var

```
MAILGUN_WEBHOOK_SIGNING_KEY=   # Mailgun dashboard → Webhooks → HTTP webhook signing key
```

---

## Part B — Outbound SMTP

No code changes. Update env vars only:

```env
SMTP_HOST=smtp.mailgun.org
SMTP_PORT=587
SMTP_USER=postmaster@mg.triolla.io        # or custom SMTP credential from Mailgun dashboard
SMTP_PASS=<mailgun-smtp-password>
SMTP_FROM="Talent OS <noreply@mg.triolla.io>"
```

Update in `.env.example` and production secrets.

---

## Part C — Mailgun Dashboard Setup (one-time)

### 1. Add and verify sending domain

- Mailgun → Sending → Domains → **Add Domain**: `mg.triolla.io`
- Add all DNS records Mailgun provides to your DNS registrar (all on `mg.triolla.io` — does not affect `triolla.io` MX records):
  - SPF: `TXT mg.triolla.io "v=spf1 include:mailgun.org ~all"`
  - DKIM: `TXT` record (provided by Mailgun)
  - MX: two MX records pointing to `mxa.mailgun.org` / `mxb.mailgun.org`
- Click **Verify DNS** in Mailgun dashboard

### 2. Create inbound route

- Mailgun → Receiving → **Add Route**
- Filter expression: `match_recipient("fun@mg.triolla.io")` (or `catch_all()` for the subdomain)
- Action: `forward("https://your-production-url/webhooks/email")`
- Priority: `1`
- Description: `CV intake webhook`

### 3. Update Google Workspace routing rule

- Google Workspace Admin → Apps → Google Workspace → Gmail → **Routing**
- Find the existing rule that forwards `fun@triolla.io` to the Postmark inbound address
- Change the forwarding target from Postmark's address → `fun@mg.triolla.io`
- This is server-side admin routing — not a user-level Gmail filter

### 4. Retrieve webhook signing key

- Mailgun → **Webhooks** → find "HTTP webhook signing key"
- Set as `MAILGUN_WEBHOOK_SIGNING_KEY` in production

---

## Part D — Mailgun MCP Server

Install once in the project:

```bash
claude mcp add mailgun -- npx -y @mailgun/mcp-server \
  -e MAILGUN_API_KEY=your-api-key-here
```

Add `MAILGUN_API_REGION=eu` if using an EU Mailgun account.

**Key operations available during and after migration:**
- Verify DNS configuration for `mg.triolla.io`
- Create/inspect inbound routes
- List and update webhook configurations
- Query delivery analytics and metrics
- Manage suppression lists (bounces, unsubscribes)

API keys are passed as env vars to the MCP server process and are never exposed to the AI model.

---

## Dependencies

No new npm packages required. `multer` is bundled with `@nestjs/platform-express` (already a dependency) and `@types/multer` is already in `package.json`.

---

## Testing Plan

### Unit tests
- `mailgun-payload.dto.spec.ts` — schema validation for multipart fields, attachment mapping, Message-Id extraction from headers
- `mailgun-auth.guard.spec.ts` — valid signature passes, tampered signature fails, expired timestamp fails, replay token rejected

### Local test runner (`local-test/run.js`)
Update to:
1. Send `multipart/form-data` instead of JSON
2. Compute valid `HMAC-SHA256(MAILGUN_WEBHOOK_SIGNING_KEY, timestamp + token)` signature
3. Attach PDF/DOCX files as actual file uploads (not base64 strings)

### End-to-end smoke test
1. Send a real email with CV attachment to `fun@triolla.io`
2. Confirm it arrives at `fun@mg.triolla.io` via the Google Workspace routing rule
3. Confirm Mailgun fires the webhook
4. Confirm the job appears in the BullMQ queue and the worker processes it
5. Confirm the candidate record appears in the DB

---

## Migration Sequence

1. Set up `mg.triolla.io` in Mailgun + DNS (Part C steps 1–2)
2. Install MCP server (Part D)
3. Implement webhook code changes (Part A)
4. Update env vars for outbound (Part B)
5. Deploy to staging, run smoke test with the local test runner
6. Update Google Workspace routing rule (Part C step 3) — this is the cutover point
7. Monitor first real CV through the pipeline
8. Remove Resend SMTP credentials from production secrets (SMTP_HOST, SMTP_USER, SMTP_PASS)
