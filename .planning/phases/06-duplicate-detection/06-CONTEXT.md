# Phase 6: Duplicate Detection - Context

**Gathered:** 2026-03-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Run pg_trgm duplicate detection entirely in PostgreSQL, insert a minimal candidate shell (name/email/phone/source), create `duplicate_flags` rows for fuzzy matches, and link `email_intake_log.candidate_id` immediately. Phase 6 ends with a `candidateId` in hand. Phase 7 enriches the candidate record (skills, cv_text, cv_file_url, ai_summary, etc.) and handles scoring.

Phase 6 lives entirely inside `IngestionProcessor.process()`, replacing the `// Phase 6 stub` comment at line 137.

</domain>

<decisions>
## Implementation Decisions

### Dedup query sequence
- **D-01:** Two-step sequence: (1) exact email match via Prisma `findFirst` — fastest, no pg_trgm needed; (2) fuzzy name similarity via `$queryRaw` with pg_trgm `similarity()` > 0.7. Stop at first match — do not run fuzzy if exact email match is found.
- **D-02:** Fuzzy check is on `full_name` only — the pg_trgm query does NOT combine phone. Phone GIN index exists but is not used for match detection in Phase 6. Phone matching introduces false positives (shared family phones, agency numbers). `duplicate_flags.match_fields` records which fields triggered the flag (`['name']`).
- **D-03:** Dedup runs with `tenantId` scope on every query — never matches candidates across tenants.

### Phase 6 candidate INSERT (minimal shell)
- **D-04:** Phase 6 inserts a MINIMAL candidate shell with only the fields needed to anchor the record and enable dedup attribution:
  - `tenantId` (required)
  - `fullName` (from extraction)
  - `email` (from extraction, nullable)
  - `phone` (from extraction, nullable)
  - `source` (from extraction — e.g. `direct`, `agency`, `linkedin`)
  - `sourceEmail` (from Postmark `From` field — attribution, NOT from extraction)
- **D-05:** Skills, `currentRole`, `yearsExperience`, `cvText`, `cvFileUrl`, `sourceAgency`, `aiSummary`, and `metadata` are NOT written in Phase 6. Phase 7 enriches these via a targeted UPDATE.

### UPSERT behavior on exact email match (source attribution preserved)
- **D-06:** On exact email match (`confidence = 1.0`), Phase 6 UPSERTs the existing candidate. Fields updated: `fullName`, `phone` only. Rationale: we want the latest identity data (name/phone may have changed) but no other Phase 6 shell fields.
- **D-07:** `source` and `sourceEmail` are NEVER updated on UPSERT — first-submission wins for ROI attribution. Overwriting the source channel would corrupt acquisition reporting.
- **D-08:** `updated_at` is triggered automatically via Prisma `@updatedAt` on any update — no explicit set needed.
- **D-09:** The UPSERT is idempotent — repeated BullMQ retries on the same `email` produce the same candidate row state.

### email_intake_log.candidate_id linkage (immediate)
- **D-10:** Phase 6 sets `email_intake_log.candidate_id = candidateId` **immediately** after the candidate INSERT or UPSERT — before any Phase 7 work. Rationale: if Phase 7 fails, the log row is not orphaned. The link exists the moment the candidate ID is known.
- **D-11:** For exact email match (UPSERT): `candidate_id` is set to the ID of the EXISTING matched candidate, not a new row.

### duplicate_flags creation
- **D-12:** Fuzzy match only — `duplicate_flags` row is created with: `candidateId` (new), `matchedCandidateId` (existing), `confidence` (name_sim value), `matchFields: ['name']`, `reviewed: false`.
- **D-13:** `duplicate_flags` has a UNIQUE constraint on `(tenant_id, candidate_id, matched_candidate_id)` (already in schema). On BullMQ retry, the INSERT is idempotent — use `upsert` with no-op on conflict.

### ai_summary column (new migration)
- **D-14:** Add `ai_summary TEXT` nullable column to `candidates` table via a new Prisma migration in Phase 6. Rationale: the AI-extracted 2-sentence summary is a core recruiter UI feature — not a metadata concern, gets its own column for queryability.
- **D-15:** Phase 6 does NOT write `ai_summary` (it is Phase 7's enrichment). The migration just adds the column so Phase 7 can populate it without needing its own schema change.

### Processing continuation
- **D-16:** After Phase 6 completes (regardless of match type — exact, fuzzy, or no match), pass `candidateId` forward to Phase 7. Fuzzy-flagged candidates ARE scored in Phase 7 — the duplicate flag is for human review, not a processing halt.

### Claude's Discretion
- Whether `DedupService` lives in `src/dedup/` (per spec §5) or `src/ingestion/services/` (per existing pattern) — spec says `src/dedup/`; follow spec to keep dedup as a standalone concern
- Exact `$queryRaw` type annotation for pg_trgm fuzzy result
- Whether to use a `candidatesRepository` abstraction or inline Prisma calls in `DedupService`

</decisions>

<specifics>
## Specific Ideas

- "For ROI and attribution, we must never lose the initial source of acquisition" — source and source_email are write-once fields on the candidate record
- "Link candidateId to email_intake_log the moment it is known" — do not defer to Phase 7; orphaned logs on Phase 7 failure are unacceptable
- Phase 6 = shell creation + dedup logic; Phase 7 = enrichment + scoring. Clear separation of concerns.
- `ai_summary` gets its own column (not `metadata.summary`) because it is a first-class recruiter-facing field

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Dedup detection logic
- `spec/backend-architecture-proposal.md` §8 — Full `DedupService.check()` pseudocode, detection table, fuzzy match rationale, "never auto-merge" principle

### Database schema
- `spec/backend-architecture-proposal.md` §9 — `candidates` table columns, `duplicate_flags` table with UNIQUE constraint, indexes
- `prisma/schema.prisma` — Prisma model definitions for `Candidate`, `DuplicateFlag`, `EmailIntakeLog`
- `prisma/migrations/20260322110817_init/migration.sql:173-178` — pg_trgm extension + GIN indexes ALREADY created (DEDUP-06 pre-satisfied, no new index migration needed — only `ai_summary` column migration needed)

### Requirements
- `.planning/REQUIREMENTS.md` §Duplicate Detection — DEDUP-01 through DEDUP-06
- `.planning/REQUIREMENTS.md` §Candidate Storage — CAND-03 (email_intake_log.candidate_id — set in Phase 6, not Phase 7)

### Integration point
- `src/ingestion/ingestion.processor.ts:137` — `// Phase 6 stub` comment; Phase 6 replaces this with `DedupService.check()` + candidate INSERT/UPSERT + flag creation + intake log update
- `src/ingestion/ingestion.processor.ts:12-17` — `ProcessingContext` interface; extend with `candidateId: string` for Phase 7 to consume

### Phase 7 contract
- `.planning/phases/05-file-storage/05-CONTEXT.md` §D-04 — `cv_file_url` stores R2 object key; Phase 7 writes this to `candidates.cv_file_url` during enrichment

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/ingestion/ingestion.processor.ts:36` — `tenantId` already resolved from `ConfigService` — pass directly to `DedupService.check()`
- `src/ingestion/ingestion.processor.ts:88-118` — extraction result (`CandidateExtract`) already in scope; has `fullName`, `email`, `phone`, `source` fields
- `src/ingestion/ingestion.processor.ts:125-131` — `fileKey` (R2 object key) already in scope at Phase 6 insertion point
- `src/prisma/prisma.service.ts` — `PrismaService` already injected in processor; `DedupService` needs it too

### Established Patterns
- `@Injectable()` NestJS services with constructor injection
- `PrismaService` injected via `IngestionModule` providers
- Unit test files co-located with service: `dedup.service.spec.ts` next to `dedup.service.ts`
- `IngestionModule` wires dependencies — `DedupModule` must be imported there

### Integration Points
- `IngestionProcessor.process()` line 137: add dedup call, candidate shell INSERT/UPSERT, duplicate_flags creation, `email_intake_log.candidate_id` update
- `ProcessingContext` interface: add `candidateId: string` field so Phase 7 knows which candidate to enrich
- New `DedupModule` (`src/dedup/`) must be imported into `IngestionModule` or `WorkerModule`

</code_context>

<deferred>
## Deferred Ideas

- Phone-based fuzzy matching — deferred; false positive risk (shared agency numbers); revisit if name-only matching produces too many misses in production
- Confidence score combining name + phone similarity — Phase 2 / v2 scope
- Recruiter duplicate flag review endpoint (RAPI-04) — v2 scope
- Auto-merge after recruiter approval — v2 scope
- `updated_at` on exact-match UPSERT triggers Phase 7 re-enrichment — interesting idea, deferred; requires change-detection logic

</deferred>

---

*Phase: 06-duplicate-detection*
*Context gathered: 2026-03-22*
