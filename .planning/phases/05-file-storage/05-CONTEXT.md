# Phase 5: File Storage - Context

**Gathered:** 2026-03-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Upload the original CV attachment to Cloudflare R2; return the storage key to be passed through the processor context. No candidate record is created in this phase — `cv_file_url` (stored as an R2 key) and `cv_text` are written to the `candidates` table in Phase 7 when the candidate record is inserted. Phase 5 lives entirely inside `IngestionProcessor.process()`, replacing the Phase 5 stub at line 117.

</domain>

<decisions>
## Implementation Decisions

### Attachment selection (STOR-01)
- **D-01:** Upload the **largest attachment** whose `ContentType` matches `application/pdf` or `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (DOCX). This filters out email signature images, logos, and other small embedded files.
- **D-02:** If no PDF/DOCX attachment is found after filtering, skip the upload — pass `null` as the file key through the processor context. No error is thrown; the job continues and Phase 7 will insert the candidate with `cv_file_url = null`.

### R2 bucket access pattern (STOR-02)
- **D-03:** R2 bucket is **strictly private** — no public access.
- **D-04:** `candidates.cv_file_url` stores the **R2 object key** (e.g., `cvs/{tenantId}/{messageId}.pdf`), NOT a URL. Despite the column name, this is intentional.
- **D-05:** Pre-signed URLs are generated on-demand by the backend API when the recruiter UI needs to render/download a file. This endpoint is **Phase 2 / v2 scope** — not built here.
- **D-06:** The S3 client is configured with Cloudflare R2's S3-compatible endpoint: `https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com`. Use `@aws-sdk/client-s3` with `PutObjectCommand`.

### Upload failure behavior (STOR-03 / reliability)
- **D-07:** Do **not** catch R2 upload errors in the processor. Let the error propagate so BullMQ retries the entire job automatically. The base64 attachment content is preserved in the job payload across retries.
- **D-08:** Do **not** update `email_intake_log.processing_status` to `'failed'` on upload errors. Only mark as `'failed'` when **all BullMQ retries are exhausted** (handled by BullMQ's `failed` event on the queue, not inline in the processor).
- **D-09:** This is different from Phase 3/4 error handling where failures are caught inline. Upload errors are transient (network/R2 outage) — retrying the full job is correct.

### R2 key format and Content-Type (STOR-01 refinement)
- **D-10:** Key format: `cvs/{tenantId}/{messageId}.pdf` or `cvs/{tenantId}/{messageId}.docx` — append the correct extension based on the attachment's `ContentType`.
- **D-11:** Explicitly set `ContentType` on the `PutObjectCommand` to match the file's MIME type so browsers can render/download the file properly.

### Claude's Discretion
- Whether `StorageService` uses constructor injection for `ConfigService` or reads env vars via a module-level config factory
- Whether to expose a single `upload(buffer, key, contentType)` method or a more domain-specific `uploadCv(...)` method
- Test strategy for `StorageService` (mock `@aws-sdk/client-s3` at the command level)

</decisions>

<specifics>
## Specific Ideas

- "The R2 bucket must be strictly private — store only the R2 file key, and the frontend will request a short-lived Pre-signed URL from the backend API when needed to protect PII."
- "BullMQ will automatically retry since the base64 content is still in the job payload" — don't catch upload errors inline, let BullMQ retry the job.
- "Append the proper file extension (.pdf or .docx) to the R2 key and explicitly set the correct Content-Type on upload so browsers can render/download the file properly."

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Storage module structure and processor wiring
- `spec/backend-architecture-proposal.md` §4 (line ~158) — `src/storage/` module layout (`storage.module.ts`, `storage.service.ts`)
- `spec/backend-architecture-proposal.md` §5 (line ~285) — `IngestionProcessor` pseudocode showing Step 3: upload before dedup, `storageService.upload(payload.Attachments[0], key)` call pattern
- `spec/backend-architecture-proposal.md` §6 (line ~607) — `cv_file_url` column description: "R2 URL of original PDF/DOCX — set on intake"

### Requirements
- `.planning/REQUIREMENTS.md` §File Storage — STOR-01, STOR-02, STOR-03

### Integration point
- `src/ingestion/ingestion.processor.ts:117` — Phase 5 stub; Phase 5 replaces this comment with the upload call and passes `{ fileKey, cvText }` forward in the processor context

### Environment variables (already defined)
- `src/config/env.ts:9-12` — `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` already in Zod schema

### Existing patterns to follow
- `src/ingestion/services/spam-filter.service.ts` — `@Injectable()` NestJS service structure, single-method pattern
- `src/ingestion/ingestion.module.ts` — how to register new services in `providers` and `exports`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/ingestion/ingestion.processor.ts:117` — stub comment marks exact insertion point for Phase 5 upload call
- `src/config/env.ts` — R2 env vars already validated; inject via `ConfigService` (already wired in processor constructor)
- `payload.Attachments` — available in `IngestionProcessor.process()` as `PostmarkPayloadDto.Attachments` (array of `{ Name, ContentType, Content (base64), ContentLength }`)

### Established Patterns
- All services are `@Injectable()` in `src/ingestion/services/` (or a new `src/storage/` module per spec)
- Unit test files live next to the service: `storage.service.spec.ts`
- `ConfigService` already injected in `IngestionProcessor` — `StorageService` can receive it the same way
- Phase 3/4 inline error handling pattern (catch → update status → return) does NOT apply here — D-07 overrides it for upload errors

### Integration Points
- `IngestionProcessor.process()` receives the upload result (R2 key string or `null`) and carries it forward
- Phase 7 will read this key from the processor context object and write it to `candidates.cv_file_url`
- `cv_text` (from Phase 3's `fullText`) also gets passed forward here so Phase 7 can write `candidates.cv_text`

</code_context>

<deferred>
## Deferred Ideas

- Pre-signed URL generation endpoint for recruiter UI — Phase 2 (v2 API, RAPI scope)
- Multi-file upload (all CV attachments) — current decision is largest-wins; revisit if clients send portfolios
- R2 lifecycle rules (auto-delete after N days) — operational concern, post-Phase 7
- Activating the real Anthropic `generateObject` call in `ExtractionAgentService` — deferred from Phase 4, not Phase 5 scope

</deferred>

---

*Phase: 05-file-storage*
*Context gathered: 2026-03-22*
