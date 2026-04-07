---
quick_id: 260407-hys
goal: Refactor DedupService.check() to detect duplicates exclusively by phone number instead of sender email, with a no-phone fallback that creates a duplicate flag for HR review
success_criteria:
  - check() returns confidence 1.0 only when phone numbers match exactly (both non-null)
  - check() never reads email_from / payload.From as a dedup signal (it was never actually used; the old Step 1 matched candidate.email from the CV extract, not from_email — clarify and keep CV email match removed)
  - When phone is null on the incoming candidate, check() returns null (no dedup match) and a flag is created downstream to surface the gap to HR
  - Fuzzy name match is removed — HR review is the fallback for ambiguous cases, not an automated guess
  - All existing dedup tests updated or replaced; new phone-dedup tests pass
artifacts:
  - src/dedup/dedup.service.ts
  - src/dedup/dedup.service.spec.ts
---

## Rationale

The current `DedupService.check()` has two steps:

1. **Exact candidate email match** — intended to catch the same person re-applying. This is logically sound but the task description confirms the real-world bug: the *sender* email (agency / recruiter) was conflated with the *candidate* email. One agency sends multiple unique CVs, and the stored `email` field comes from LLM extraction (`candidate.email`), not from `payload.From`. However, email is not a reliable dedup key because many CVs omit candidate email entirely. Replace it.

2. **Fuzzy name match via pg_trgm** — catches typos/token-order variants but produces false positives (two different "John Smith" candidates from different agencies). The business rule is: do not auto-merge on fuzzy signals, always send to HR. The fuzzy step should be removed; HR review is already the mechanism for ambiguous cases.

**New logic:**
- Phone number exact match (normalized, non-null both sides) → confidence 1.0, `fields: ['phone']`
- No phone on incoming candidate → return `null` (treat as new candidate), but the processor must create a `DuplicateFlag` with a special `fields: ['phone_missing']` so HR sees it needs manual review
- No phone match found → return `null` (new candidate, proceed normally)

The UI already knows how to render `duplicate_flags` (visible via `GET /candidates?filter=duplicates` and the counts endpoint). No UI changes needed.

---

## Task 1 — Refactor DedupService.check() to phone-only logic

**files:**
- `src/dedup/dedup.service.ts`

**action:**

Replace the entire `check()` method body. Remove the email exact-match step and the pg_trgm fuzzy-name step entirely. Implement:

```
Step 1: If candidate.phone is null or empty string → return { match: null, confidence: 0, fields: ['phone_missing'] }
         (special sentinel result so IngestionProcessor can create a phone_missing flag)

Step 2: Exact phone match — strip non-digit characters from both sides before comparing
         SELECT id FROM candidates
         WHERE tenant_id = $tenantId
           AND regexp_replace(phone, '[^0-9]', '', 'g') = regexp_replace($phone, '[^0-9]', '', 'g')
         LIMIT 1

         If found → return { match: { id }, confidence: 1.0, fields: ['phone'] }

Step 3: No match → return null
```

Update the `DedupResult` interface to allow `match: { id: string } | null` (the phone_missing sentinel has no match target). Add a `PHONE_MISSING` sentinel constant or use `fields: ['phone_missing']` as the discriminator.

Also update `createFlag()`: change the hardcoded `matchFields: ['name']` to accept the `fields` array from `DedupResult` and pass it through. This makes the flag self-describing.

Signature change for `createFlag`:
```typescript
async createFlag(
  candidateId: string,
  matchedCandidateId: string | null,   // null when phone is missing (no match target)
  confidence: number,
  tenantId: string,
  fields: string[],                     // was hardcoded ['name']
  tx?: Prisma.TransactionClient,
): Promise<void>
```

When `matchedCandidateId` is null (phone_missing case), set `matchedCandidateId = candidateId` in the upsert (self-referencing flag) — this satisfies the FK constraint and HR can identify it as a "needs phone review" flag rather than a true duplicate pair.

**done:** `DedupService.check()` no longer references `$queryRaw` for pg_trgm. Phone-exact SQL query is used instead. `createFlag` accepts dynamic `fields` array.

---

## Task 2 — Update IngestionProcessor to handle phone_missing sentinel and update DedupService tests

**files:**
- `src/ingestion/ingestion.processor.ts`
- `src/dedup/dedup.service.spec.ts`

**action:**

**IngestionProcessor changes** (Phase 6 transaction block, lines ~233–265):

The processor currently branches on `dedupResult.confidence === 1.0` vs `< 1.0` vs `null`. Add a third discriminator for the phone_missing sentinel:

```typescript
if (dedupResult === null) {
  // No phone match — new candidate
  candidateId = await this.dedupService.insertCandidate(...);

} else if (dedupResult.fields.includes('phone_missing')) {
  // Phone not extracted from CV — insert as new candidate + flag for HR review
  candidateId = await this.dedupService.insertCandidate(...);
  await this.dedupService.createFlag(
    candidateId,
    null,               // no match target — self-referencing flag
    0,                  // confidence 0 — not a real duplicate signal
    tenantId,
    ['phone_missing'],
    tx,
  );

} else if (dedupResult.confidence === 1.0) {
  // Exact phone match — upsert existing candidate
  await this.dedupService.upsertCandidate(dedupResult.match!.id, extraction!, tx);
  candidateId = dedupResult.match!.id;
}
```

Remove the `dedupResult.confidence < 1.0` fuzzy-match branch entirely (that logic no longer exists).

Update the comment on the `DedupResult | null` type at line ~214 to reflect phone semantics.

**dedup.service.spec.ts changes:**

Remove tests DEDUP-02 (email exact match) and DEDUP-03, DEDUP-06, DEDUP-07 (fuzzy name). Replace with:

- `DEDUP-01`: phone null → returns `{ match: null, confidence: 0, fields: ['phone_missing'] }`
- `DEDUP-02`: exact phone match (digits only, both sides `+1-555-0100` vs `15550100`) → confidence 1.0, fields: `['phone']`
- `DEDUP-03`: phone provided but no DB match → returns `null`
- `DEDUP-04`: `createFlag` with `fields: ['phone_missing']` and `matchedCandidateId: null` self-references candidateId in upsert
- `DEDUP-05`: `createFlag` with `fields: ['phone']` passes through to `matchFields` in upsert

Remove `prisma.candidate.findFirst` mock (no longer needed — phone lookup uses `$queryRaw`). Keep `$queryRaw` mock for phone query.

**done:** `npm test` passes. No references to `findFirst` remain in dedup service. Processor handles `phone_missing` branch. Old fuzzy-name branches are deleted. Test count for dedup suite is 5 passing tests.

---

## Verification

```bash
npm test -- --testPathPattern=dedup
npm test -- --testPathPattern=ingestion.processor
npm test  # full suite — no regressions
```

Expected: all tests pass, no TypeScript errors (`npx tsc --noEmit`).

## Edge Cases Handled

| Scenario | Outcome |
|---|---|
| Same agency sends 5 different CVs | Each has a unique phone → 5 separate candidates, no flags |
| CV has no phone number | Inserted as new candidate + `phone_missing` flag for HR |
| Same candidate re-applies (same phone) | Upserted onto existing record, no new candidate row |
| Phone formatting varies (`+1-555-0100` vs `15550100`) | Normalized to digits-only before compare — still matches |
| Two different candidates happen to share a phone | Flagged as duplicate — HR resolves (acceptable false-positive rate is lower than name fuzzy matching) |
