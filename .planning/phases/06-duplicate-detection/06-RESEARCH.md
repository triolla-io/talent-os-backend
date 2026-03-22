# Phase 6: Duplicate Detection - Research

**Researched:** 2026-03-22
**Domain:** PostgreSQL pg_trgm fuzzy matching, Prisma 7 raw query patterns, NestJS service architecture
**Confidence:** HIGH

## Summary

Phase 6 implements PostgreSQL-native duplicate detection using the pg_trgm extension for fuzzy name matching. The phase runs entirely within `IngestionProcessor.process()` (replacing the stub at line 137) and performs a two-step dedup check: exact email match first (fastest), then fuzzy name similarity > 0.7. Matched candidates are either UPSERT-ed (exact email) or flagged for human review (fuzzy). A new `ai_summary` column is added to `candidates` via Prisma migration. No candidates are loaded into application memory — all queries run in PostgreSQL.

**Primary recommendation:** Use Prisma 7's `$queryRaw<MatchType[]>` with explicit generic type parameter for pg_trgm results. Create a new `DedupService` in `src/dedup/` module, wire into `IngestionModule`, inject `PrismaService` via constructor. Add new Prisma migration for `ai_summary` column. Extend `ProcessingContext` with `candidateId` field.

---

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Two-step sequence: exact email match first (Prisma `findFirst`), then fuzzy name similarity > 0.7 via `$queryRaw` + pg_trgm. Stop at first match.
- **D-02:** Fuzzy check on `full_name` ONLY — not phone. Phone GIN index exists but not used for Phase 6 matching (false positive risk).
- **D-03:** Dedup runs with `tenantId` scope on every query — never matches candidates across tenants.
- **D-04:** Phase 6 inserts MINIMAL candidate shell: `tenantId`, `fullName`, `email`, `phone`, `source`, `sourceEmail` only.
- **D-05:** Skills, `currentRole`, `yearsExperience`, `cvText`, `cvFileUrl`, `sourceAgency`, `aiSummary`, and `metadata` NOT written in Phase 6 — Phase 7 enriches.
- **D-06:** On exact email match, UPSERT existing candidate. Fields updated: `fullName`, `phone` ONLY. Source and sourceEmail are NEVER updated on UPSERT.
- **D-10:** `email_intake_log.candidate_id` set IMMEDIATELY after candidate INSERT/UPSERT — before Phase 7 work.
- **D-12:** Fuzzy match: INSERT new candidate + create `duplicate_flags` row. Never auto-merge.
- **D-14:** Add `ai_summary TEXT` nullable column to `candidates` via new Prisma migration. Phase 6 migrates, Phase 7 populates.
- **D-16:** After Phase 6 completes, pass `candidateId` forward to Phase 7.

### Claude's Discretion

- **Module location:** `DedupService` lives in `src/dedup/` per spec §5 (not `src/ingestion/services/`).
- **Type annotation for pg_trgm fuzzy result:** Use explicit generic `$queryRaw<MatchType[]>` type parameter.
- **Repository abstraction:** Can use inline Prisma calls in `DedupService` (no separate repo needed for Phase 6 scope).

### Deferred Ideas (OUT OF SCOPE)

- Phone-based fuzzy matching — deferred; false positive risk
- Confidence score combining name + phone — Phase 2 v2 scope
- Recruiter duplicate flag review endpoint — v2 scope
- Auto-merge after recruiter approval — v2 scope

---

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DEDUP-01 | Dedup runs entirely in PostgreSQL via pg_trgm — no candidates loaded into application memory | pg_trgm GIN indexes already exist (Phase 1 migration line 173-178). `$queryRaw` with explicit type parameter executes in DB, returns typed result to app only. |
| DEDUP-02 | Exact email match (confidence = 1.0) → UPSERT existing candidate record | Prisma `findFirst` + `upsert` pattern. UPSERT updates `fullName`, `phone` only. Preserves `source`, `sourceEmail` (first-submission ROI attribution). |
| DEDUP-03 | Fuzzy name match (similarity > 0.7) → INSERT new candidate + create `duplicate_flags` row for human review | `$queryRaw` with pg_trgm `similarity()` function. INSERT candidate shell (Phase 6 minimal fields). DuplicateFlag model has UNIQUE constraint (tenant_id, candidate_id, matched_candidate_id) for idempotency. |
| DEDUP-04 | No match → INSERT new candidate record | When no exact or fuzzy match found, INSERT new candidate shell with Phase 6 minimal fields. |
| DEDUP-05 | System never auto-merges on fuzzy match — creates `duplicate_flags` with `reviewed = false` | DuplicateFlag row created with `reviewed: false`. Phase 7 processes all candidates (flagged or not) for enrichment + scoring. |
| DEDUP-06 | pg_trgm GIN indexes on `candidates.full_name` and `candidates.phone` created in migration | Already created in Phase 1 migration (lines 177-178). DEDUP-06 pre-satisfied — Phase 6 has no index migration to create. |

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Prisma | 7.0.0 | ORM + type-safe DB operations | Schema-first, migrations baked in, Prisma 7 handles `$queryRaw` generics correctly |
| PostgreSQL | 16 | Database with pg_trgm extension | `similarity()` function for fuzzy string matching; GIN indexes pre-created |
| NestJS | 11.0.1 | Service/module framework | Constructor injection, @Injectable() pattern, already in use for other services |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @nestjs/common | 11.0.1 | Logger, Inject decorator | Dependency injection for PrismaService in DedupService |
| pg_trgm | (PostgreSQL extension) | Fuzzy text matching | Exact database extension — no npm package needed; accessed via Prisma `$queryRaw` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| pg_trgm + PostgreSQL | Vector DB (Pinecone, Weaviate) | Adds external service + cost; overkill at 500 CVs/month scale; pg_trgm is built-in, free, scales naturally |
| pg_trgm + PostgreSQL | Elasticsearch | Same cost/complexity as vector DB; pg_trgm sufficient for name dedup |
| Prisma `$queryRaw<T>` | TypedSQL (Prisma new feature) | TypedSQL is newer, more verbose setup; `$queryRaw<T>` is proven, sufficient for this use case |

**Installation:** No new packages needed — Prisma 7 and PostgreSQL 16 already in stack.

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── dedup/                          # NEW: Duplicate detection (Phase 6)
│   ├── dedup.module.ts            # Module definition
│   ├── dedup.service.ts           # DedupService: check() + createFlag()
│   └── dedup.service.spec.ts      # Unit tests
├── ingestion/
│   ├── ingestion.processor.ts     # Phase 6 stub → integrated here
│   ├── ingestion.module.ts        # Wire DedupModule import
│   └── services/
│       ├── spam-filter.service.ts
│       ├── attachment-extractor.service.ts
│       └── extraction-agent.service.ts
└── prisma/
    ├── schema.prisma              # Add ai_summary column to Candidate
    └── migrations/
        ├── 20260322110817_init/
        └── {timestamp}_add_ai_summary/  # NEW migration for ai_summary
```

### Pattern 1: Prisma $queryRaw with pg_trgm Fuzzy Match

**What:** Type-safe raw SQL query for fuzzy string matching via pg_trgm's `similarity()` function.

**When to use:** When Prisma ORM doesn't support PostgreSQL-specific functions (like `similarity()`) and you need full type safety on results.

**Example:**

```typescript
// Source: Prisma 7 docs - Raw Queries (https://www.prisma.io/docs/orm/prisma-client/using-raw-sql/raw-queries)
interface FuzzyMatch {
  id: string;
  full_name: string;
  phone: string | null;
  name_sim: number; // similarity() returns numeric 0.0–1.0
}

const fuzzyMatches = await this.prisma.$queryRaw<FuzzyMatch[]>`
  SELECT id, full_name, phone,
         similarity(full_name, ${candidate.fullName}) AS name_sim
  FROM candidates
  WHERE tenant_id = ${tenantId}
    AND full_name % ${candidate.fullName}  -- % operator: matches using pg_trgm index
  ORDER BY name_sim DESC
  LIMIT 1
`;

// Result is typed as FuzzyMatch[], safe to access fuzzyMatches[0].name_sim
if (fuzzyMatches[0]?.name_sim > 0.7) {
  return { match: fuzzyMatches[0], confidence: fuzzyMatches[0].name_sim };
}
```

**Key notes:**
- Generic type parameter `$queryRaw<FuzzyMatch[]>` tells TypeScript the shape of results
- Template literal `${variable}` is parameterized (safe from SQL injection)
- `full_name % ${fullName}` uses pg_trgm `%` operator (matches via GIN index)
- `similarity()` returns DECIMAL 0.0–1.0; column alias `AS name_sim` maps to interface property

### Pattern 2: NestJS Service with Constructor Injection

**What:** Injectable NestJS service that receives dependencies (PrismaService) via constructor, available throughout app via DI container.

**When to use:** Any domain logic (DedupService, SpamFilterService, etc.) that needs database access or other injected services.

**Example:**

```typescript
// Source: NestJS docs - Providers (https://docs.nestjs.com/providers)
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface DedupResult {
  match: { id: string; fullName: string };
  confidence: number;
  fields: string[];
}

@Injectable()
export class DedupService {
  constructor(private readonly prisma: PrismaService) {}

  async check(
    extracted: CandidateExtract,
    tenantId: string,
  ): Promise<DedupResult | null> {
    // Step 1: Exact email match
    if (extracted.email) {
      const exact = await this.prisma.candidate.findFirst({
        where: { tenantId, email: extracted.email },
      });
      if (exact) {
        return { match: exact, confidence: 1.0, fields: ['email'] };
      }
    }

    // Step 2: Fuzzy name match via pg_trgm
    const fuzzy = await this.prisma.$queryRaw<FuzzyMatch[]>`...`;
    if (fuzzy[0]?.name_sim > 0.7) {
      return { match: fuzzy[0], confidence: fuzzy[0].name_sim, fields: ['name'] };
    }

    return null;
  }

  async createFlag(
    newCandidateId: string,
    matchedCandidateId: string,
    dupResult: DedupResult,
  ): Promise<void> {
    // Upsert on unique constraint (tenant_id, candidate_id, matched_candidate_id)
    await this.prisma.duplicateFlag.upsert({
      where: {
        idx_duplicates_pair: {
          tenantId,
          candidateId: newCandidateId,
          matchedCandidateId,
        },
      },
      create: {
        tenantId,
        candidateId: newCandidateId,
        matchedCandidateId,
        confidence: new Decimal(dupResult.confidence.toString()),
        matchFields: dupResult.fields,
        reviewed: false,
      },
      update: {}, // No-op on retry — idempotent
    });
  }
}
```

**Key notes:**
- `@Injectable()` registers service in NestJS DI container
- Constructor parameter `private readonly prisma: PrismaService` auto-injected
- Methods typed with explicit return types (DedupResult | null)
- Async/await for all DB calls
- Upsert on UNIQUE constraint handles idempotency on BullMQ retry

### Pattern 3: Module Imports and Provider Wiring

**What:** NestJS module that imports DedupService, exports it, so other modules can inject it.

**When to use:** Organizing related services into modules; enabling dependency injection across module boundaries.

**Example:**

```typescript
// Source: NestJS docs - Modules (https://docs.nestjs.com/modules)
// src/dedup/dedup.module.ts
import { Module } from '@nestjs/common';
import { DedupService } from './dedup.service';
import { PrismaModule } from '../prisma/prisma.module'; // Import PrismaModule to access PrismaService

@Module({
  imports: [PrismaModule],  // Ensure PrismaService is available
  providers: [DedupService],
  exports: [DedupService],  // Export so IngestionModule can inject it
})
export class DedupModule {}
```

```typescript
// src/ingestion/ingestion.module.ts (updated)
import { Module } from '@nestjs/common';
import { DedupModule } from '../dedup/dedup.module'; // NEW import

@Module({
  imports: [
    BullModule.registerQueue({ name: 'ingest-email' }),
    StorageModule,
    DedupModule,  // NEW: Wire DedupModule
  ],
  providers: [
    IngestionProcessor,
    SpamFilterService,
    AttachmentExtractorService,
    ExtractionAgentService,
  ],
})
export class IngestionModule {}
```

**Key notes:**
- `imports: [PrismaModule]` ensures PrismaService is available for injection
- `providers: [DedupService]` registers the service in this module
- `exports: [DedupService]` exposes it to modules that import DedupModule
- IngestionProcessor can now inject DedupService via constructor

### Anti-Patterns to Avoid

- **Loading all candidates into memory for comparison:** Use PostgreSQL `$queryRaw` + pg_trgm, not JavaScript loops. At 500 CVs/month scale this is safe in PostgreSQL; at 50k/month it scales naturally via indexes without app-level changes.
- **Creating duplicate_flags without checking UNIQUE constraint:** Always use `upsert` on `(tenant_id, candidate_id, matched_candidate_id)` to handle BullMQ retries idempotently.
- **Updating source/sourceEmail on exact email UPSERT:** Those fields are write-once for ROI tracking. Only update `fullName` and `phone`.
- **Fuzzy matching on multiple fields:** Stick to `full_name` only. Phone matching causes false positives (shared family phones, agency numbers).
- **Setting email_intake_log.candidate_id in Phase 7:** Set it immediately in Phase 6 after candidate INSERT/UPSERT. If Phase 7 fails, the log is not orphaned.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Fuzzy string matching | Custom similarity algorithm (Levenshtein, etc.) in JavaScript | PostgreSQL pg_trgm extension | pg_trgm uses trigram decomposition + GIN index — orders of magnitude faster, battle-tested, built into PostgreSQL 9.1+ |
| Exact email dedup | Manual query loop | Prisma `findFirst` | Handles NULL comparisons correctly, type-safe, single DB round-trip |
| Raw SQL type safety | Manual interface definitions that drift from query | Prisma `$queryRaw<T>` | Generic type parameter ensures results match expected shape; catch mismatches at compile time |
| Idempotency on fuzzy flag | Check-before-insert pattern | Prisma `upsert` on UNIQUE constraint | Single atomic operation; no race conditions between check and insert on worker retries |

**Key insight:** Duplicate detection has many edge cases (NULL emails, phone vs. name conflicts, idempotency on retry). PostgreSQL pg_trgm + Prisma abstractions handle these correctly. Custom code will miss cases.

---

## Runtime State Inventory

> Rename/refactor phase: explicitly answer each question.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| **Stored data** | None — Phase 6 creates new `ai_summary` column but Phase 1 migration created empty candidates table (zero existing records in dev). New column is nullable, no backfill needed. | None — migration only adds column, no data movement. |
| **Live service config** | None — DedupService is application code, no external config. | None. |
| **OS-registered state** | None — no system-level registration. | None. |
| **Secrets/env vars** | None — dedup uses `TENANT_ID` (already in use since Phase 2), no new secrets. | None. |
| **Build artifacts** | None — compiled code only, no egg-info or generated artifacts carrying old names. | None. |

---

## Common Pitfalls

### Pitfall 1: NULL Email Handling in Exact Match

**What goes wrong:** Query for exact email match when `extracted.email` is NULL. PostgreSQL NULL semantics: `WHERE email = NULL` returns no rows (always false). Fuzzy match is then performed, creating a new candidate instead of detecting the same person applying twice without an email.

**Why it happens:** Email is an optional field in `CandidateExtract` and optional in Candidate model. Developers assume `WHERE email = X` works for all values of X.

**How to avoid:** Always check `if (extracted.email)` before running exact match query. Only run fuzzy match if email is missing or no exact match found.

**Warning signs:** Two identical candidates in DB with same `fullName`, both have NULL `email`. Duplicate flag not created because exact match wasn't attempted.

### Pitfall 2: Fuzzy Match on Unindexed Column

**What goes wrong:** Query `similarity(phone, ...)` when phone GIN index doesn't exist or isn't used. Query becomes O(n) table scan. At 500 CVs/month no problem; at 50k+/month, slow queries OOM the DB.

**Why it happens:** Assumption that `similarity()` always uses the index. PostgreSQL query planner chooses table scan if it thinks it's faster (e.g., small result set expected).

**How to avoid:** Phase 1 migration already created GIN indexes on both `full_name` and `phone`. Phase 6 uses `full_name` only (per D-02) — matching on phone deferred. If phone matching is added later, verify index is used via `EXPLAIN ANALYZE`.

**Warning signs:** `EXPLAIN` shows `Seq Scan` instead of `Index Scan` for similarity query. Query takes seconds instead of milliseconds.

### Pitfall 3: BullMQ Retry Creates Duplicate duplicate_flags

**What goes wrong:** Task runs, fuzzy match found, `duplicateFlags` row inserted. Then BullMQ retries (e.g., network timeout after insert). Code doesn't check if flag already exists, inserts again. Now two identical rows exist, both with `reviewed = false`.

**Why it happens:** Missing idempotency check. Developer assumed each job runs only once.

**How to avoid:** Use Prisma `upsert` on the UNIQUE constraint `(tenant_id, candidate_id, matched_candidate_id)`. On retry, upsert returns existing row; no duplicate created.

```typescript
await this.prisma.duplicateFlag.upsert({
  where: {
    idx_duplicates_pair: { tenantId, candidateId: newId, matchedCandidateId: existingId },
  },
  create: { /* ... */ },
  update: {}, // No-op on retry
});
```

**Warning signs:** Duplicate flags table has multiple rows with same (tenant_id, candidate_id, matched_candidate_id).

### Pitfall 4: Overwriting source/sourceEmail on Exact Email UPSERT

**What goes wrong:** Two-year-old candidate applies again via LinkedIn. Code UPSERTs and overwrites `source` from `'linkedin'` to `'direct'` (or whatever the second submission was). Now the candidate's acquisition source is wrong — breaks ROI reporting.

**Why it happens:** Developer assumes all candidate fields should be updated on UPSERT. "Update everything to latest" is intuitive but wrong for source.

**How to avoid:** UPSERT updates ONLY `fullName` and `phone`. Never touch `source` or `sourceEmail` — first submission wins.

```typescript
await this.prisma.candidate.upsert({
  where: { idx_candidates_email: { tenantId, email: extracted.email } },
  create: { tenantId, email: extracted.email, fullName: extracted.fullName, /* ... source, sourceEmail ... */ },
  update: { fullName: extracted.fullName, phone: extracted.phone }, // ONLY these two
});
```

**Warning signs:** Recruiter checks acquisition analytics, sees "direct" for a candidate known to come from LinkedIn.

### Pitfall 5: Not Setting email_intake_log.candidate_id Immediately

**What goes wrong:** Phase 6 creates candidate, Phase 7 starts enrichment. Phase 7 crashes partway through (e.g., AI API timeout). email_intake_log row has no `candidate_id`, now orphaned. Recruiter sees candidate in DB but not in intake log — inconsistent state.

**Why it happens:** Deferring the link to Phase 7 feels natural ("let Phase 7 finish, then link"). But failures are inevitable in distributed systems.

**How to avoid:** Set `email_intake_log.candidate_id` immediately after candidate INSERT/UPSERT, before any Phase 7 work. This is a single UPDATE query, happens atomically.

```typescript
// Phase 6 — after candidate INSERT/UPSERT
await this.prisma.emailIntakeLog.update({
  where: { idx_intake_message_id: { tenantId, messageId } },
  data: { candidateId: newCandidateId },
});
// Now safe — even if Phase 7 fails, log is linked
```

**Warning signs:** email_intake_log rows with status='completed' but candidateId=NULL.

---

## Code Examples

Verified patterns from official sources:

### Exact Email Match (Prisma findFirst)

```typescript
// Source: Prisma docs - findFirst (https://www.prisma.io/docs/orm/reference/prisma-client-reference#findfirst)
const exact = await this.prisma.candidate.findFirst({
  where: {
    tenantId: tenantId,
    email: extracted.email,
  },
});

if (exact) {
  return {
    match: exact,
    confidence: 1.0,
    fields: ['email'],
  };
}
```

### Fuzzy Name Match with pg_trgm

```typescript
// Source: PostgreSQL pg_trgm docs (https://www.postgresql.org/docs/current/pgtrgm.html)
// + Prisma $queryRaw example from schema
interface FuzzyMatch {
  id: string;
  full_name: string;
  phone: string | null;
  name_sim: number;
}

const fuzzy = await this.prisma.$queryRaw<FuzzyMatch[]>`
  SELECT id, full_name, phone,
         similarity(full_name, ${extracted.fullName}) AS name_sim
  FROM candidates
  WHERE tenant_id = ${tenantId}
    AND full_name % ${extracted.fullName}
  ORDER BY name_sim DESC
  LIMIT 1
`;

if (fuzzy.length > 0 && fuzzy[0].name_sim > 0.7) {
  return {
    match: fuzzy[0],
    confidence: fuzzy[0].name_sim,
    fields: ['name'],
  };
}
```

### UPSERT on Exact Email (Preserve source)

```typescript
// Source: Prisma docs - upsert (https://www.prisma.io/docs/orm/reference/prisma-client-reference#upsert)
const candidate = await this.prisma.candidate.upsert({
  where: {
    idx_candidates_email: {
      tenantId: tenantId,
      email: extracted.email!,
    },
  },
  create: {
    tenantId,
    email: extracted.email!,
    fullName: extracted.fullName,
    phone: extracted.phone,
    source: extracted.source,
    sourceEmail: sourceEmailFromPostmark,
  },
  update: {
    // ONLY update name and phone — preserve source/sourceEmail
    fullName: extracted.fullName,
    phone: extracted.phone,
  },
});

return candidate.id;
```

### INSERT New Candidate (Minimal Shell)

```typescript
// Source: Prisma docs - create (https://www.prisma.io/docs/orm/reference/prisma-client-reference#create)
const candidate = await this.prisma.candidate.create({
  data: {
    tenantId,
    email: extracted.email,
    fullName: extracted.fullName,
    phone: extracted.phone,
    source: extracted.source,
    sourceEmail: sourceEmailFromPostmark,
    // Phase 7 enriches: currentRole, yearsExperience, skills, cvText, cvFileUrl, aiSummary, metadata
  },
});

return candidate.id;
```

### Create Duplicate Flag (Idempotent via Upsert)

```typescript
// Source: Prisma docs - upsert with UNIQUE constraint
import { Decimal } from '@prisma/client/runtime/library';

await this.prisma.duplicateFlag.upsert({
  where: {
    idx_duplicates_pair: {
      tenantId,
      candidateId: newCandidateId,
      matchedCandidateId: existingCandidateId,
    },
  },
  create: {
    tenantId,
    candidateId: newCandidateId,
    matchedCandidateId: existingCandidateId,
    confidence: new Decimal(fuzzyResult.name_sim.toString()),
    matchFields: ['name'],
    reviewed: false,
  },
  update: {}, // No-op on retry — idempotent
});
```

### Extend ProcessingContext with candidateId

```typescript
// Source: Phase 5 CONTEXT.md pattern — ProcessingContext extended with fileKey
// src/ingestion/ingestion.processor.ts

export interface ProcessingContext {
  fullText: string;
  suspicious: boolean;
  fileKey: string | null;
  cvText: string;
  candidateId: string; // NEW: Phase 6 output for Phase 7
}

// In IngestionProcessor.process():
const candidateId = await this.dedupService.check(extracted, tenantId);
context.candidateId = candidateId;

// Phase 7 consumes candidateId from context
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Elasticsearch / Vector DB for dedup | PostgreSQL pg_trgm (built-in) | ~2015+ (when pg_trgm matured) | Zero infra overhead; scales naturally at 500–50k CVs/month without model tuning |
| Load all candidates, loop in JS | PostgreSQL `$queryRaw` + GIN index | ~2010+ (when Postgres 9.1 added pg_trgm GIN) | O(1)–O(log n) query instead of O(n) app code; faster, simpler |
| Manual upsert (check, then insert/update) | Prisma `upsert` on UNIQUE constraint | ~2018+ (when ORMs matured) | Atomic operation; no race conditions; idempotent on retry |
| ENUM columns for status | TEXT + CHECK constraints | This project (DB-03) | No migration needed to add new status values; scales with application evolution |

**Deprecated/outdated:**
- **Custom similarity algorithms (Levenshtein, Jaro-Winkler in app code):** PostgreSQL pg_trgm is 100x faster. Only use custom algorithms if PostgreSQL is unavailable.
- **Polling for duplicates post-insert:** Use triggers or direct queries during insert. Post-insert polling is error-prone.
- **Soft deletes on duplicate_flags:** Never delete flags; create them with `reviewed = false`. Phase 2 recruiter marks as reviewed. Audit trail matters.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest 30.0.0 with ts-jest |
| Config file | jest.config in package.json |
| Quick run command | `npm test -- dedup.service.spec.ts` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DEDUP-01 | $queryRaw executes pg_trgm similarity() in PostgreSQL only (no candidate loading) | unit | `npm test -- dedup.service.spec.ts --testNamePattern="executes in PostgreSQL"` | ❌ Wave 0 |
| DEDUP-02 | Exact email match returns DedupResult with confidence 1.0 | unit | `npm test -- dedup.service.spec.ts --testNamePattern="exact email match"` | ❌ Wave 0 |
| DEDUP-03 | Fuzzy name match > 0.7 returns DedupResult with fields=['name'], no auto-upsert | unit | `npm test -- dedup.service.spec.ts --testNamePattern="fuzzy match"` | ❌ Wave 0 |
| DEDUP-04 | No match returns null | unit | `npm test -- dedup.service.spec.ts --testNamePattern="no match"` | ❌ Wave 0 |
| DEDUP-05 | duplicate_flags.reviewed = false on fuzzy | unit | `npm test -- dedup.service.spec.ts --testNamePattern="reviewed false"` | ❌ Wave 0 |
| DEDUP-06 | GIN indexes exist (verified via schema, not runtime test) | integration | Schema check: `grep -r "idx_candidates_name_trgm\|idx_candidates_phone_trgm" prisma/migrations/` | ✅ Phase 1 |
| CAND-03 | email_intake_log.candidate_id set after Phase 6 | integration | `npm test -- ingestion.processor.spec.ts --testNamePattern="candidate_id set"` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test -- dedup.service.spec.ts` (unit tests only, < 10s)
- **Per wave merge:** `npm test` (full suite, < 30s)
- **Phase gate:** Full suite green + `npm run lint` before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/dedup/dedup.service.spec.ts` — covers DEDUP-01, DEDUP-02, DEDUP-03, DEDUP-04, DEDUP-05 (5 unit tests)
  - Mock PrismaService with `jest.mock('../prisma/prisma.service')`
  - Test exact match returns confidence 1.0
  - Test fuzzy > 0.7 triggers flag creation
  - Test fuzzy <= 0.7 returns null
  - Test null email skips exact match
- [ ] `src/ingestion/ingestion.processor.spec.ts` (extended) — covers CAND-03
  - Integration test: DedupService called, candidate inserted, email_intake_log.candidate_id set
  - Mock storage + extraction, verify candidateId in context
- [ ] `src/dedup/dedup.module.ts` — module definition + PrismaModule import
- [ ] `prisma/migrations/{timestamp}_add_ai_summary/migration.sql` — adds `ai_summary TEXT` column

*(Existing test infrastructure: 70 tests passing after Phase 5. No framework gaps. Phase 6 adds ~7 new tests.)*

---

## Open Questions

1. **Prisma 7 TypedSQL vs. $queryRaw<T>?**
   - What we know: Both are valid. `$queryRaw<T>` is proven, simpler setup.
   - What's unclear: Whether TypedSQL provides meaningful advantage for Phase 6 scope.
   - Recommendation: Use `$queryRaw<FuzzyMatch[]>` for Phase 6. TypedSQL is future-proof if schema becomes much more complex.

2. **CandidatesRepository abstraction needed in Phase 6?**
   - What we know: Phase 6 needs INSERT (exact match), INSERT (no match), UPSERT (exact match), UPDATE (email_intake_log).
   - What's unclear: Whether a dedicated repository layer saves complexity vs. inline Prisma in IngestionProcessor.
   - Recommendation: Inline Prisma in IngestionProcessor for Phase 6. If Phase 7 adds many more candidate queries, extract to repository then.

3. **Where does Decimal conversion for duplicate_flags.confidence happen?**
   - What we know: Database stores NUMERIC(4,3), JavaScript stores as number 0.0–1.0.
   - What's unclear: Does Prisma auto-convert or do we need `new Decimal()`?
   - Recommendation: Use `new Decimal(fuzzyResult.name_sim.toString())` for explicit type safety. Prisma supports both, explicit is safer.

4. **How to handle Decimal type in TypeScript for fuzzy similarity?**
   - What we know: `similarity()` returns numeric; Prisma Decimal type exists.
   - What's unclear: Should FuzzyMatch interface use `number` or `Decimal`?
   - Recommendation: Use `number` in interface (it's a ratio 0–1), convert to Decimal on INSERT to duplicate_flags.

---

## Sources

### Primary (HIGH confidence)
- **Prisma 7 Documentation - Raw Queries:** [https://www.prisma.io/docs/orm/prisma-client/using-raw-sql/raw-queries](https://www.prisma.io/docs/orm/prisma-client/using-raw-sql/raw-queries)
- **PostgreSQL pg_trgm Documentation:** [https://www.postgresql.org/docs/current/pgtrgm.html](https://www.postgresql.org/docs/current/pgtrgm.html)
- **NestJS Providers & Dependency Injection:** [https://docs.nestjs.com/providers](https://docs.nestjs.com/providers)
- **Project Architecture Spec (spec/backend-architecture-proposal.md §8):** Duplicate Detection logic, pseudocode, detection table
- **Project Prisma Schema (prisma/schema.prisma):** Candidate, DuplicateFlag, EmailIntakeLog models
- **Project Phase 1 Migration (prisma/migrations/20260322110817_init/):** pg_trgm indexes already created

### Secondary (MEDIUM confidence)
- **Prisma 7 TypedSQL:** [https://www.prisma.io/docs/orm/prisma-client/using-raw-sql/typedsql](https://www.prisma.io/docs/orm/prisma-client/using-raw-sql/typedsql) — newer approach, simpler than custom interfaces for complex queries
- **NestJS + Prisma Singleton Pattern:** [https://dev.to/micobarac/nestjs-prisma-singleton-provider-service-with-extensions-10j1](https://dev.to/micobarac/nestjs-prisma-singleton-provider-service-with-extensions-10j1) — wiring PrismaService into modules

### Tertiary (LOW confidence)
- **PostgreSQL Decimal Type:** [https://www.postgresql.org/docs/16/datatype-numeric.html](https://www.postgresql.org/docs/16/datatype-numeric.html) — Decimal vs. float precision

---

## Metadata

**Confidence breakdown:**
- **Standard stack:** HIGH — Prisma 7, PostgreSQL 16, NestJS 11 all current, locked in package.json
- **Architecture:** HIGH — Spec §8 is comprehensive; pg_trgm indexes pre-created; Prisma $queryRaw pattern proven
- **Pitfalls:** MEDIUM — Common duplicated issues identified from PostgreSQL + Prisma patterns, but phase-specific gotchas may emerge during implementation
- **Validation:** MEDIUM — Jest + ts-jest framework exists; test structure clear; Wave 0 test files not yet created

**Research date:** 2026-03-22
**Valid until:** 2026-04-22 (30 days — stable technology stack, no rapid changes expected)

---

*Phase 6: Duplicate Detection*
*Research completed: 2026-03-22*
