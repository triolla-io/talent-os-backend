# Mailgun + Cloudflare Integration Design

**Date:** 2026-05-31
**Status:** Approved
**Scope:** Infrastructure setup for Mailgun inbound/outbound after the code migration is complete. Covers DNS records in Cloudflare, Mailgun domain verification, inbound route, production secrets in Coolify, Google Workspace cutover, and MCP server install.

---

## Context

The code migration (Postmark → Mailgun) is fully complete as of this date. The webhook handler, auth guard, DTO, multer middleware, and test runner are all updated. What remains is the infrastructure side: wiring up the domain, DNS, routing, and secrets so real emails can flow through the new stack.

The approach is **staged cutover**: complete all setup and verify it before touching Google Workspace. Google Workspace routing is the single atomic cutover step — Postmark stays live until that moment.

---

## Email Flow (post-cutover)

```
Sender → fun@triolla.io
  → Google Workspace routing rule (server-side)
  → fun@mg.triolla.io
  → Mailgun receives it (MX records on mg.triolla.io)
  → Mailgun inbound route fires
  → POST https://api.talentos.triolla.io/api/webhooks/email
  → MailgunAuthGuard (HMAC-SHA256)
  → WebhooksController → EmailPayloadDto
  → BullMQ ingest-email queue
  → Worker processes CV
```

Outbound auth emails:

```
NestJS Nodemailer → smtp.mailgun.org:587 → sent from noreply@mg.triolla.io
```

---

## Infrastructure

- **DNS provider:** Cloudflare (manages `triolla.io`)
- **Production API:** `api.talentos.triolla.io` → `89.167.63.189` (Hetzner), DNS only (not proxied)
- **Hosting:** Hetzner + Coolify
- **Webhook URL:** `https://api.talentos.triolla.io/api/webhooks/email`

---

## Phase 0 — Pre-flight Check

Before adding any records, check Cloudflare → `triolla.io` → Email → Email Routing.

If Email Routing is active, Cloudflare manages MX records for `triolla.io`. This does **not** conflict — `mg.triolla.io` subdomain MX records are independent. Just confirm you are not accidentally adding records to `triolla.io` root; all records below go on the `mg` subdomain.

---

## Phase 1 — Add Domain in Mailgun

1. Mailgun Dashboard → Sending → Domains → **Add Domain**
2. Enter `mg.triolla.io`
3. Mailgun displays the DNS records to add — copy them; they are used in Phase 2

---

## Phase 2 — Cloudflare DNS Records

Add all five records in Cloudflare DNS for `triolla.io`. Every record must be **DNS only (grey cloud)** — never proxied. Proxying breaks MX resolution and DKIM validation silently.

| Type | Name | Content | Proxy |
|------|------|---------|-------|
| MX | `mg` | `mxa.mailgun.org` (priority 10) | DNS only |
| MX | `mg` | `mxb.mailgun.org` (priority 10) | DNS only |
| TXT | `mg` | `v=spf1 include:mailgun.org ~all` | DNS only |
| CNAME | `krs._domainkey.mg` | Provided by Mailgun | DNS only |
| CNAME | `pic._domainkey.mg` | Provided by Mailgun | DNS only |

Optional tracking pixel CNAME (for Mailgun open/click tracking):

| Type | Name | Content | Proxy |
|------|------|---------|-------|
| CNAME | `email.mg` | `mailgun.org` | DNS only |

**Verification:** Mailgun → Domain → Verify DNS Settings → all checks must go green before proceeding. Cloudflare propagation is typically fast (~5 min), but allow up to 30 min.

---

## Phase 3 — Mailgun Inbound Route

After DNS is verified, create the inbound route:

- Mailgun → Receiving → Routes → **Add Route**

| Field | Value |
|-------|-------|
| Filter expression | `match_recipient("fun@mg.triolla.io")` |
| Action | `forward("https://api.talentos.triolla.io/api/webhooks/email")` |
| Priority | `1` |
| Description | `CV intake webhook` |

`forward()` implies stop — no `store()` or explicit `stop()` needed.

**Smoke test:** Send a test email to `fun@mg.triolla.io` directly (not via Google Workspace yet). Check Mailgun → Logs to confirm it hit the route and the webhook returned 200.

---

## Phase 4 — Production Secrets in Coolify

Set these environment variables on the API service in Coolify. The signing key and SMTP password live in different parts of the Mailgun dashboard.

**Signing key location:** Mailgun → Webhooks → HTTP webhook signing key

**SMTP password location:** Mailgun → Sending → Domain Settings → SMTP credentials → `postmaster@mg.triolla.io`

```
MAILGUN_WEBHOOK_SIGNING_KEY=<signing key from Mailgun Webhooks tab>
SMTP_HOST=smtp.mailgun.org
SMTP_PORT=587
SMTP_USER=postmaster@mg.triolla.io
SMTP_PASS=<SMTP password from Mailgun Domain Settings>
SMTP_FROM="Talent OS <noreply@mg.triolla.io>"
```

Restart the API container after saving. Confirm no startup errors in Coolify logs.

**Verify SMTP:** Trigger a magic-link or invitation email via the app and confirm delivery.

---

## Phase 5 — Google Workspace Cutover

This is the single step that switches live traffic. Everything before this point is safe — Postmark is still active.

**Path:** Google Workspace Admin → Apps → Google Workspace → Gmail → Routing → find the existing rule forwarding `fun@triolla.io` to the Postmark inbound address → edit → change the destination to `fun@mg.triolla.io`.

**Rollback:** Revert that routing rule back to the Postmark inbound address. Keep Postmark configured until cutover is confirmed stable (at least 24 hours of live traffic).

**Post-cutover verification:** Send a real email with a CV attachment to `fun@triolla.io`. Confirm it appears in Mailgun logs, the webhook returns 200, a job appears in the BullMQ queue, and a candidate record is created in the DB.

---

## Phase 6 — Mailgun MCP Server

Install once locally for DNS verification, route inspection, and delivery monitoring:

```bash
claude mcp add mailgun -- npx -y @mailgun/mcp-server \
  -e MAILGUN_API_KEY=<your-api-key>
```

Add `-e MAILGUN_API_REGION=eu` if the Mailgun account is on the EU region.

Key operations: check DNS verification status, list inbound routes, query delivery logs, inspect bounce/suppression lists.

---

## Phase 7 — Cleanup (after stable cutover)

Once 24+ hours of live traffic have flowed through Mailgun successfully:

1. Remove `POSTMARK_WEBHOOK_TOKEN` from Coolify secrets
2. Optionally remove the Postmark inbound webhook configuration from the Postmark dashboard

---

## Verification Checkpoints

| Phase | Check |
|-------|-------|
| DNS records added | Mailgun → Domain → Verify DNS → all 4 checks green |
| Inbound route | Test email to `fun@mg.triolla.io` → Mailgun logs show 200 from webhook |
| Signing key | API restarts without errors; `local-test/run.js` returns 200 |
| SMTP | Magic-link email delivers successfully |
| Cutover live | Email to `fun@triolla.io` → candidate record appears in DB |

---

## R2 — No Changes Needed

The storage service and R2 bucket configuration are unaffected. The migration changed how attachments arrive (multipart file upload vs base64 JSON) but the R2 write path is unchanged. Message-Id angle brackets are stripped before use as R2 key path segments — this is correct and intentional.

---

## Sequencing Summary

```
Phase 0  Pre-flight: check Cloudflare Email Routing status
Phase 1  Add mg.triolla.io in Mailgun, get DNS values
Phase 2  Add DNS records in Cloudflare (DNS only), verify in Mailgun
Phase 3  Create inbound route, smoke test with direct email to fun@mg.triolla.io
Phase 4  Set production secrets in Coolify, verify SMTP
Phase 5  Update Google Workspace routing rule  ← cutover point
Phase 6  Install Mailgun MCP server
Phase 7  Cleanup: remove Postmark secrets (after 24h stable)
```
