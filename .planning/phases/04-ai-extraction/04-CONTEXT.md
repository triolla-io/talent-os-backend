# Phase 4: AI Extraction - Context

**Gathered:** 2026-03-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Claude Haiku extracts structured candidate data from the `fullText` produced by Phase 3's `ProcessingContext`. Output is a typed `CandidateExtract` object. No DB writes, no file uploads — those are Phases 5 and 7. Phase 4 lives entirely inside `IngestionProcessor.process()`, inline after Phase 3's text extraction.

This phase uses a **mock service implementation** — the infrastructure (service, Zod schema, prompt, wiring, tests) is fully built but the real Anthropic call is stubbed. Real AI calls are activated in a follow-up task.

</domain>

<decisions>
## Implementation Decisions

### `suspicious` flag handling

- **D-01:** Ignore the `suspicious` flag for LLM routing — extraction always runs regardless. The flag is passed through as metadata on the result object for downstream phases (Phase 7 scoring may weigh it), but Phase 4 does not change prompt behavior or skip the call based on it.

### Extraction prompt

- **D-02:** Use a structured system prompt — not the spec's one-liner. System prompt instructs Haiku on:
  - Source detection rules: agency emails typically include recruiter name + agency name + "on behalf of" phrasing; `linkedin` if subject contains "LinkedIn"; `referral` if body mentions "referred by"; default to `direct`
  - Summary format: exactly 2 sentences — sentence 1 is the candidate's role/experience level, sentence 2 highlights top skills or notable achievement
  - Handling ambiguous text: if content is clearly not a CV (no name, no professional context), still attempt extraction — don't throw
- **D-03:** User prompt is: `"Extract candidate information from the following email and CV text:\n\n${fullText}"`

### Missing `fullName` failure handling

- **D-04:** If extraction throws OR the returned `fullName` is empty/null/whitespace after trimming, catch the error, update `email_intake_log.processing_status = 'failed'`, log the error with `MessageID`, and return from the processor. BullMQ's existing 3-retry limit handles transient LLM failures naturally — no extra retry logic needed.
- **D-05:** Do NOT insert a candidate with a placeholder name. A nameless record is worse than a failed job.

### Mock implementation

- **D-06:** `ExtractionAgentService.extract()` returns a hardcoded `CandidateExtract` stub in Phase 4. The real `generateObject` call is wrapped in a `// TODO: replace mock with real Anthropic call` comment block, disabled by default.
- **D-07:** Mock returns deterministic data so integration tests can assert on specific field values without nondeterminism.

### Claude's Discretion

- Exact system prompt wording (within the constraints of D-02)
- Whether the Zod schema lives in the service file or a separate `schemas/` file
- Whether to export `CandidateExtract` type from the service or from a shared types file

</decisions>

<specifics>
## Specific Ideas

- Same service decomposition pattern as Phase 3: dedicated `ExtractionAgentService`, registered in `IngestionModule`, injected into `IngestionProcessor`
- Spec's `CandidateExtractSchema` (§7) is the canonical schema — use it exactly, don't diverge
- `source` enum values from spec: `direct | agency | linkedin | referral | website`
- Phase 3 output shape already available: `const _context: ProcessingContext = { fullText, suspicious }` at line 73 of `ingestion.processor.ts`

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### AI extraction schema and agent pattern
- `spec/backend-architecture-proposal.md` §7 — `CandidateExtractSchema` Zod definition, `email-parser.agent.ts` reference implementation, `generateObject` usage pattern

### Requirements
- `.planning/REQUIREMENTS.md` §AI Extraction — AIEX-01, AIEX-02, AIEX-03

### Integration point
- `src/ingestion/ingestion.processor.ts` — Phase 3 stub at line 73; Phase 4 replaces `_context` usage and adds extraction call after it

### Existing patterns to follow
- `src/ingestion/services/spam-filter.service.ts` — NestJS service structure, `@Injectable()`, constructor, single-method pattern
- `src/ingestion/ingestion.module.ts` — how to register new services

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/ingestion/ingestion.processor.ts` — Phase 4 plugs in directly at the `_context` variable (line 73). Replace stub with real extraction call.
- `src/ingestion/ingestion.module.ts` — add `ExtractionAgentService` to `providers` array, same pattern as `SpamFilterService` and `AttachmentExtractorService`
- `src/config/env.ts` — `ANTHROPIC_API_KEY` already in Zod schema; `ConfigService` already injected in processor

### Established Patterns
- All services are `@Injectable()` NestJS classes in `src/ingestion/services/`
- Unit tests live next to service: `extraction-agent.service.spec.ts`
- `ProcessingContext` interface already exported from `ingestion.processor.ts`
- `PrismaService` already injected in processor for status updates

### Integration Points
- `IngestionProcessor.process()` → calls `ExtractionAgentService.extract(fullText)` after building `fullText`
- On `fullName` failure: `prisma.emailIntakeLog.update({ processingStatus: 'failed' })` — same pattern as spam reject (line 39–44)
- Extraction result flows to Phase 5 (file upload) inline, same processor method — no re-queue

</code_context>

<deferred>
## Deferred Ideas

- Real Anthropic API call — activate in follow-up task after mock infrastructure is validated
- `suspicious` flag influencing prompt skepticism — deferred; may revisit if false positives emerge in Phase 7 scoring
- Source detection accuracy tuning — prompt v1 uses heuristics; fine-tune based on real data later

</deferred>

---

*Phase: 04-ai-extraction*
*Context gathered: 2026-03-22*
