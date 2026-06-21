# Local Manual Testing

> Test the full email-intake flow end-to-end: Mailgun → ngrok → API → Worker → DB.

## Prerequisites

| Service | How to verify |
|---|---|
| Docker stack | `docker ps` — api, worker, postgres, redis all UP |
| DB seeded | Prisma Studio → `tenants` has 1 row, `jobs` has 1 active row |
| ngrok | Running and forwarding to `localhost:3000` |
| Mailgun route | Configured to forward to the correct ngrok URL (see below) |

## Setup

### 1. Start Docker stack
```bash
docker compose up --build -d
```

### 2. Seed the database (first time only)
```bash
docker compose exec api npx prisma db push
docker compose exec api npx prisma db seed
```

### 3. Start ngrok
```bash
ngrok http 3000
```
Copy the generated `https://xxxxx.ngrok-free.dev` URL.

### 4. Configure Mailgun route

In the [Mailgun dashboard](https://app.mailgun.com) → Receiving → Routes → add a "Forward" action pointing at your ngrok URL:

```
https://<YOUR-NGROK-URL>/api/webhooks/email
```

No credentials go in the URL. Mailgun signs every request (HMAC-SHA256 over `timestamp` + `token` using your **HTTP webhook signing key**), and `MailgunAuthGuard` verifies it. The signing key in Mailgun → Webhooks must match `MAILGUN_WEBHOOK_SIGNING_KEY` in `.env`.

### 5. Open Prisma Studio
```bash
npx prisma studio --url="postgresql://triolla:password@localhost:5432/triolla"
```

---

## Testing via real email (recommended)

1. **Open 2 terminal tabs** for watching logs:
   ```bash
   # Tab 1 — API logs (webhook receipt + enqueue)
   docker compose logs -f api

   # Tab 2 — Worker logs (CV extraction, scoring, duplicate detection)
   docker compose logs -f worker
   ```

2. **Send an email** with a PDF/DOCX CV attached to your Mailgun inbound address (e.g. `fun@mg.triolla.io`).

3. **Watch the flow** in the logs:
   - **API tab**: Should show `Enqueued job for MessageID: xxx`
   - **Worker tab**: Should show extraction → scoring → duplicate detection steps

4. **Verify in Prisma Studio** (refresh each table):

   | Table | What to check |
   |---|---|
   | `email_intake_log` | `processing_status` = `success` (if `failed`, read `error_message`) |
   | `candidates` | `full_name`, `email`, `skills`, `cv_text` populated by AI |
   | `applications` | Linked to the active job, `stage` = `new` |
   | `candidate_job_scores` | `score` (0–100), `reasoning`, `strengths`, `gaps` |
   | `duplicate_flags` | Only if you sent the same CV twice |

---

## Testing via local script (without Mailgun)

Use the bundled script to simulate signed Mailgun webhook calls directly against the API.
It builds a valid HMAC signature from `MAILGUN_WEBHOOK_SIGNING_KEY`, so that must be set in `.env`.

```bash
# Drop CV files into local-test/files/
cp ~/Desktop/some-cv.pdf local-test/files/

# Send all files in the directory
node local-test/run.js

# Send a specific file
node local-test/run.js "some-cv.pdf"

# Health check only
node local-test/run.js --health
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `401 Unauthorized` | Signature mismatch — check `MAILGUN_WEBHOOK_SIGNING_KEY` in `.env` matches the signing key in Mailgun → Webhooks |
| `processing_status = failed` | Read `error_message` in `email_intake_log` — usually missing API key or unsupported file |
| Worker logs silent | Check `docker compose logs worker` — worker might have crashed on start |
| ngrok `502 Bad Gateway` | API container not running or not on port 3000 |
| Prisma Studio `No URL found` | Use `--url=` flag: `npx prisma studio --url="postgresql://triolla:password@localhost:5432/triolla"` |
