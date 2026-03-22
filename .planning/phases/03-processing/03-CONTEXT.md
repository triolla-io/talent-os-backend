# Phase 3: Processing Pipeline & Spam Filter - Context

**Gathered:** 2026-03-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Email and CV attachments parsed to plain text inside the BullMQ `IngestionProcessor`; obvious non-CV emails discarded before any LLM call. Phase 3 produces a structured text payload that Phase 4 (AI Extraction) will consume. No AI calls, no DB writes for candidates, no file storage — those are Phases 4–5.

</domain>

<decisions>
## Implementation Decisions

### Multiple attachments

- **D-01:** Parse ALL supported attachments (PDF and DOCX), not just the first one. If an email has a CV and a cover letter as separate files, both get parsed.
- **D-02:** Merge extracted text into a single string with clear per-file demarcation:
  ```
  --- Attachment: <filename> ---
  <extracted text>
  ```
  The email body is prepended before all attachment text:
  ```
  --- Email Body ---
  <TextBody>

  --- Attachment: cv.pdf ---
  <pdf text>

  --- Attachment: cover-letter.docx ---
  <docx text>
  ```
- **D-03:** This merged string is the single `fullText` value passed to Phase 4's extraction agent.

### Unsupported file types

- **D-04:** Skip unsupported attachment formats gracefully — no error thrown, no processing halted. Log a warning with filename and content type.
- **D-05:** Supported types: `application/pdf` (ContentType) for PDF; `application/vnd.openxmlformats-officedocument.wordprocessingml.document` or `.docx` extension for DOCX. Any other ContentType → skip.
- **D-06:** Processing continues with whatever text has been extracted (email body + any successfully parsed attachments). If zero text is extracted and body is also empty/short, the spam filter (which runs first) will have already caught it.

### Spam filter logic

- **D-07:** The `AND` condition in PROC-02 is strict: reject ONLY when there is NO attachment (of any type, including unsupported) AND body length < 100 chars. If an attachment exists — even an unsupported one — this rule does not trigger.
- **D-08:** Marketing keyword scan covers BOTH Subject AND Body (not Subject only). Case-insensitive. Keywords: `unsubscribe`, `newsletter`, `promotion`, `deal`, `offer`.
- **D-09:** Keyword match + valid attachment present = do NOT hard-reject. Mark the email as `suspicious: true` and pass it to Phase 4's extraction agent for LLM evaluation. The suspicious flag is carried in the job's context object, not stored in DB at this stage.
- **D-10:** Keyword match + NO valid attachment = hard reject (status `spam`, processing stops).
- **D-11:** Spam filter runs first, before any parsing. No need to parse attachments for emails that are hard-rejected.

### Status transitions

- **D-12:** On hard-reject: update `email_intake_log.processing_status = 'spam'` and return from the processor. No further processing.
- **D-13:** On pass: update `email_intake_log.processing_status = 'processing'` before parsing begins.

### Claude's Discretion

- Exact class/service decomposition inside `src/ingestion/` (e.g., separate `SpamFilterService`, `AttachmentExtractorService`, or inline logic in processor)
- pdf-parse and mammoth error handling (corrupted files) — catch, log, skip that attachment
- Whether `suspicious` flag lives in the job context object or is a field on a parsed-payload interface

</decisions>

<specifics>
## Specific Ideas

- The spec's `spam-filter.service.ts` (§6) only scans Subject for keywords — Phase 3 expands this to also scan Body per D-08
- The spec's `attachmentExtractor.extract()` returns a single string — Phase 3 extends this to produce demarcated multi-file text per D-02
- The spec's `fullText = ${payload.TextBody}\n\n${cvText}` is the right shape; implement it with the demarcation format from D-02
- The spec's optional Haiku pre-filter (§6) is NOT used for the `suspicious` path — the `suspicious` flag is just metadata passed to Phase 4; Phase 4 decides whether to call the LLM

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Spam filter

- `spec/backend-architecture-proposal.md` §6 — `spam-filter.service.ts` reference implementation (note: Phase 3 expands keyword scan to Body per D-08, and adds suspicious-flag path per D-09)
- `spec/backend-architecture-proposal.md` §6 — `IngestionProcessor` flow: Step 0 (spam), Step 1 (extract), shows how processor chains steps

### Attachment parsing

- `spec/backend-architecture-proposal.md` §5 — Directory layout: `src/ingestion/attachment-extractor.ts`

### Requirements

- `.planning/REQUIREMENTS.md` §Processing Pipeline — PROC-02 through PROC-06 (all Phase 3 requirements)

### Schema

- `spec/backend-architecture-proposal.md` §9 — `email_intake_log.processing_status` values: `pending`, `processing`, `completed`, `failed`, `spam`

</canonical_refs>

<code_context>

## Existing Code Insights

### Reusable Assets

- `src/ingestion/ingestion.processor.ts` — Phase 2 stub; all Phase 3 logic lands here (or in services it calls). `@Processor('ingest-email')` already wired.
- `src/ingestion/ingestion.module.ts` — Already exists; new services (`SpamFilterService`, `AttachmentExtractorService`) should be declared here.
- `src/prisma/prisma.service.ts` — Used for `email_intake_log` status updates (D-12, D-13).
- `src/config/env.ts` — `TENANT_ID` already in Zod schema.

### Established Patterns

- ConfigModule and PrismaModule are global — injectable anywhere without re-import.
- Job data shape: `job.data` is the sanitized Postmark payload (attachment blobs stripped, metadata retained — per Phase 2 D-03). `job.data.Attachments[n]` has `Name`, `ContentType`, `ContentLength` but NOT `Content`.
- Attachment binary content: NOT in `job.data`. Phase 3 must re-fetch attachment content from the raw payload... wait — the binary content WAS stripped in Phase 2 before storing to `email_intake_log` and before enqueuing. The BullMQ job payload also has blobs stripped. **Phase 3 must use the `Content` field from the original Postmark delivery.** Check Phase 2 enqueue decision: per Phase 2 D-06, the full sanitized payload (blobs stripped) is the job data. This means Phase 3 has no access to raw attachment bytes — researcher must confirm whether `Content` should be preserved in job payload for parsing.

### Integration Points

- `src/ingestion/ingestion.processor.ts` → calls `SpamFilterService.check()`, then `AttachmentExtractorService.extract()`
- Output of Phase 3 (`fullText` + `suspicious` flag) flows directly to Phase 4 inline (same processor method, no re-queue)

### Critical Research Question — Attachment Content Access

`WebhooksService.stripAttachmentBlobs()` removes `Content` from attachments **in the job payload** (same `sanitizedPayload` used for both DB insert and `queue.add()`). As implemented, Phase 3's `IngestionProcessor` receives `Attachments[n].Name / ContentType / ContentLength` but **no binary content** — nothing to parse.

The researcher MUST resolve this. Options to evaluate:
1. **Split the strip** — strip `Content` for DB `raw_payload` only; include `Content` in the BullMQ job payload. Increases Redis memory (~5-20MB per job) but keeps Phase 2 contract intact.
2. **Upload to R2 on intake** — Phase 2 uploads raw attachment bytes to R2 before stripping; Phase 3 fetches from R2. Requires Phase 5 (File Storage) logic to move earlier or be duplicated.
3. **Re-read from Postmark** — not viable; Postmark does not retain attachments after delivery.

Option 1 is the simplest but researcher should verify Redis memory implications at 500 CVs/month scale. **Planner must not proceed until this is resolved.**

</code_context>

<deferred>
## Deferred Ideas

- LLM pre-filter (optional Haiku `isCV` check from spec §6) — not used; suspicious flag + Phase 4 LLM handles ambiguous cases
- Image/scanned PDF support (OCR via Tesseract) — add to backlog if clients send scanned CVs
- `.txt` file support as an extension of unsupported-type handling — trivial to add but out of scope for Phase 3

</deferred>

---

*Phase: 03-processing*
*Context gathered: 2026-03-22*
