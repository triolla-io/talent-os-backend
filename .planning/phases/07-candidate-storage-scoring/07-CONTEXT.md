# Phase 7: Candidate Storage & Scoring - Context

**Gathered:** 2026-03-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Enrich the minimal candidate shell created by Phase 6 with all AI-extracted fields, upsert `applications` rows for every active job, and score each candidate-job pair with Claude Sonnet. Phase 7 is the final step of the ingestion pipeline — it ends with a fully-stored + scored candidate record and `email_intake_log.processingStatus = 'completed'`.

Phase 7 lives inside `IngestionProcessor.process()`, replacing the `// Phase 7 stub` comment at line 184. It also activates the real extraction call scaffold in `ExtractionAgentService` (currently a mock) and introduces a new `ScoringAgentService` (mock with real call scaffolded).

</domain>

<decisions>
## Implementation Decisions

### Candidate Enrichment (CAND-01, CAND-02, CAND-03)
- **D-01:** Phase 7 issues a targeted `candidate.update()` on the `candidateId` from Phase 6 — writes all enrichment fields: `currentRole`, `yearsExperience`, `skills`, `cvText`, `cvFileUrl`, `aiSummary`, `metadata`. No re-insert; update only.
- **D-02:** `cvText` comes from `context.cvText` (plain text extracted in Phase 3). `cvFileUrl` is derived from `context.fileKey` (Phase 5). Both are already on `ProcessingContext` — no re-extraction needed.
- **D-03:** `aiSummary` is the 2-sentence summary field from `CandidateExtractSchema.summary`. `metadata` JSONB is left `null` in Phase 7 (no metadata use case yet).

### Haiku Extraction Activation
- **D-04:** `ExtractionAgentService.extract()` remains a deterministic mock in Phase 7. The real Anthropic `generateObject()` call stays commented out and scaffold-ready — same pattern established in Phase 4. Activation is deferred until LLM credentials are available.
- **D-05:** No changes to `CandidateExtractSchema` — schema is already correct and matches all fields to be stored.

### Scoring Agent (SCOR-01 – SCOR-05)
- **D-06:** New `ScoringAgentService` in a new `ScoringModule` — follows the same module-per-concern pattern as `StorageModule` and `DedupModule`. Lives at `src/scoring/scoring.service.ts` (and `.module.ts`).
- **D-07:** Scoring input (when real Anthropic call is activated): full `cvText` + all structured candidate fields + job `title`, `description`, `requirements[]`. This gives Sonnet the most complete signal. Currently scaffolded as mock — the interface is defined now so activation is a one-line swap.
- **D-08:** Scoring output Zod schema: `{ score: z.number().int().min(0).max(100), reasoning: z.string(), strengths: z.array(z.string()), gaps: z.array(z.string()) }`. Maps directly to `candidate_job_scores` columns.
- **D-09:** `ScoringAgentService.score()` is a deterministic mock in Phase 7 (same pattern as extraction) — returns hardcoded score with real call commented out and ready.
- **D-10:** `model_used` field records the literal model string (e.g., `claude-sonnet-4-6`) — hardcoded in the mock, passed from `generateObject` result when real call activates.

### Applications + Score Flow (SCOR-01, SCOR-02, SCOR-03, SCOR-04)
- **D-11:** Fetch all active jobs: `prisma.job.findMany({ where: { tenantId, status: 'active' } })`. If no active jobs, skip scoring loop entirely — candidate is still stored and `processingStatus` is set to `completed`.
- **D-12:** For each active job: upsert `applications` row first (`stage = 'new'`), then call `scoringService.score()`. The upsert uses the UNIQUE constraint `(tenant_id, candidate_id, job_id)` — idempotent on BullMQ retry.
- **D-13:** Score result is INSERT-only into `candidate_job_scores` — never upsert, never update. `applicationId` links the score to the application row. This preserves full score history across retries.

### Scoring Failure Handling
- **D-14:** If `scoringService.score()` throws for any job, the entire Phase 7 throws — BullMQ retries the full job (up to 3x, exponential backoff). This is consistent with how extraction failure is handled in Phase 4. Safe because: applications upsert is idempotent, candidate enrichment UPDATE is idempotent, score INSERTs are append-only (retry creates duplicate rows on the same `applicationId` — acceptable for Phase 1).
- **D-15:** No try/catch around scoring loop — errors propagate directly to BullMQ worker.

### Final Pipeline Status
- **D-16:** `email_intake_log.processingStatus` is set to `'completed'` after all Phase 7 work succeeds — single terminal status regardless of whether scoring ran (active jobs may be 0). Consistent with Phase 1 scope where the recruiter UI doesn't read this field yet.

### Claude's Discretion
- Module file structure inside `src/scoring/` (service, module, spec file naming)
- Scoring prompt wording when real call activates
- How `metadata` JSONB is populated in future phases
- Whether to add a `location` field extraction (field exists in schema but not in CandidateExtractSchema)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

No external specs — requirements are fully captured in decisions above and REQUIREMENTS.md.

### Key source files to read before planning
- `src/ingestion/ingestion.processor.ts` — Phase 7 stub is at line 184; ProcessingContext interface at lines 13-19
- `src/ingestion/services/extraction-agent.service.ts` — mock pattern to replicate for ScoringAgentService
- `src/dedup/dedup.service.ts` — module/service pattern to follow for ScoringModule
- `src/dedup/dedup.module.ts` — module boilerplate pattern
- `src/ingestion/ingestion.module.ts` — where ScoringModule import needs to be added
- `prisma/schema.prisma` — `candidates`, `applications`, `candidate_job_scores` models

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ProcessingContext` interface (`ingestion.processor.ts:13-19`) — already has `candidateId`, `cvText`, `fileKey` fields needed by Phase 7
- `CandidateExtractSchema` + `CandidateExtract` type (`extraction-agent.service.ts`) — all enrichment fields are already defined; `summary` → `aiSummary`, `source` already set in Phase 6 shell
- `DedupModule` + `DedupService` — exact pattern to replicate for `ScoringModule` + `ScoringAgentService`
- `PrismaService` — injected into all services; `prisma.job.findMany`, `prisma.application.upsert`, `prisma.candidateJobScore.create` are all available

### Established Patterns
- **Mock-first with commented-out real call**: Phase 4 pattern. Scaffold the real Anthropic call, comment it out, ship the mock. Easy to activate by swapping the comment block.
- **Separate NestJS module per concern**: StorageModule, DedupModule — new ScoringModule follows this pattern
- **Throw on failure → BullMQ retries**: Used in extraction failure path (ingestion.processor.ts:110-123). Same pattern for scoring.
- **Idempotent writes**: `upsert` for applications (DB-06 unique), `create` (append-only) for scores — BullMQ retry safety built into DB constraints

### Integration Points
- **Entry point**: `IngestionProcessor.process()` at line 184 (`// Phase 7 stub`) — Phase 7 code appends here
- **Inputs available**: `context.candidateId` (Phase 6), `context.cvText` (Phase 3), `context.fileKey` (Phase 5), `extraction` (Phase 4), `tenantId` (from ConfigService)
- **ScoringModule** must be imported into `IngestionModule` (same as DedupModule at line 8)

</code_context>

<specifics>
## Specific Ideas

- Scoring agent modeled after extraction agent: same mock-first pattern, Zod schema for output, real call commented out and ready. "Easy activation" is the design goal — the user wants the integration to be trivially swappable.
- When the real Sonnet call activates: pass `cvText` + all structured candidate fields + job `title` + `description` + `requirements[]` as the prompt input.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

### Reviewed Todos (not folded)
None pending.

</deferred>

---

*Phase: 07-candidate-storage-scoring*
*Context gathered: 2026-03-23*
