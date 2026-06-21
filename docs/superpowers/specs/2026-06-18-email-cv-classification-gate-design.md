# Email → Candidate: CV Classification Gate

**Date:** 2026-06-18
**Status:** Design — approved in conversation, pending spec review
**Scope:** Backend logic only. No database migration. No frontend.

---

## 1. Problem (root cause)

Almost every inbound email becomes a new candidate, even when it is not a CV.

The pipeline never asks *"is this a job application?"* It only asks two things, and **both fail open**:

1. **Spam filter is a keyword blocklist** (`spam-filter.service.ts`). It blocks emails that match known bad words (real-estate, sales, "unsubscribe", calendar invites, EN + HE). Anything that does *not* match those words passes — replies, invoices, vendor mail, questions, newsletters without the exact trigger words.
2. **Any non-image, non-calendar attachment is treated as a CV** (`hasMeaningfulAttachment`). An invoice / contract / brochure PDF passes.
3. **The extraction LLM is told the input *is* a CV** and that `full_name` is required ("use empty string only if truly undetectable"). `gpt-4o-mini` will almost always find *a* name (sender, signature, "Dear David"). A non-empty `full_name` is the **only** gate to candidate creation (`ingestion.processor.ts:139`).

Net effect: **not-obvious-spam + any-name-found → candidate.** That is nearly every email.

**Secondary finding:** the spam filter already computes a `suspicious` flag ("looked non-CV-ish but had an attachment"). It is threaded through the whole pipeline and **never read by any decision** — a dead signal.

---

## 2. Goal

Add an affirmative **"is this a job application / CV?"** decision *before* a candidate is ever created. Posture chosen by the user: **strict, but never lose a real candidate.**

Three outcomes:

| Verdict | Action | Candidate created? |
|---|---|---|
| **CV** (confident) | continue the existing pipeline | yes |
| **NOT a CV** (confident) | stop, stamp intake `not_cv` | no |
| **UNCERTAIN** | stop, stamp intake `needs_review` (saved for a human) | no |

No email is ever deleted — every email is already persisted in `email_intake_log` (+ full payload in R2), so `not_cv` and `needs_review` rows remain fully recoverable.

---

## 3. Design

### 3.1 New unit: `CvClassifierService`

A single-purpose service whose only job is the verdict. It does **not** extract candidate fields — that stays in `ExtractionAgentService`. Keeping the two jobs separate is the actual fix: the extractor is *told* "this is a CV," so it cannot be trusted to also judge whether it is one.

**Location:** `src/ingestion/services/cv-classifier.service.ts`

**Interface:**

```ts
interface CvClassifierInput {
  fullText: string;          // body + attachment text (already built in the processor)
  subject: string;
  fromEmail: string;
  suspicious: boolean;            // revived spam-filter signal
  hasMeaningfulAttachment: boolean;
  bodyLength: number;
  resolvedAgency: string | null;  // from resolveAgencyFromEmail()
  tenantId: string;
  messageId: string;              // for retry-safe caching
}

type CvVerdict = 'cv' | 'not_cv' | 'uncertain';

interface CvClassification {
  verdict: CvVerdict;
  reason: string;            // one line, for logs / future review UI
}

classify(input: CvClassifierInput): Promise<CvClassification>
```

**Decision logic — two layers:**

**Layer 1 — deterministic short-circuit (no AI):**
- Known recruiting-agency sender (`resolvedAgency !== null`) **and** has a meaningful attachment → `cv`. Agencies submitting a document is an unambiguous CV signal; skip the AI call.

**Layer 2 — AI judge (everything else):**
- One `generateObject` call via the existing OpenRouter provider, cheap model (`CLASSIFIER_MODEL`, default `openai/gpt-4o-mini`), `temperature: 0`.
- Zod schema: `{ verdict: enum(['cv','not_cv','uncertain']), reason: string }`.
- Focused prompt. In essence:
  > Decide whether this email is someone applying for a job (a CV / resume submission, a cover letter, or an agency presenting a candidate).
  > It is **NOT** a job application if it is: an invoice, sales/marketing, a newsletter, vendor mail, an internal reply/thread, a calendar item, a general question, or a support request.
  > If you genuinely cannot tell, answer `uncertain` — **do not guess.** Losing a real candidate is worse than asking a human.
- The clues (`suspicious`, `hasMeaningfulAttachment`, `bodyLength`, sender) are passed in the prompt so the model decides with context.
- **Retry-safe cache:** cache the verdict in R2 keyed by `messageId` (mirror `ExtractionAgentService`'s `loadExtractionCache` / `saveExtractionCache` pattern) so a BullMQ retry does not re-call the model.

### 3.2 Pipeline wiring (`ingestion.processor.ts`)

Insert the gate **after** `fullText` is built (so the attachment text is available to judge) and **before** the AI extraction call.

```
spam filter ──spam──▶ stamp "spam", return            (unchanged)
   │ not spam
extract attachment text → build fullText               (unchanged)
   │
NEW: cvClassifier.classify(fullText, clues)
   ├─ not_cv     → stamp "not_cv",       log reason, return   (no candidate)
   ├─ uncertain  → stamp "needs_review", log reason, return   (no candidate)
   └─ cv         → continue ↓
   │
AI extraction → dedup → insert candidate → job match → score   (all unchanged)
```

`suspicious` is now consumed by the classifier (its real purpose). It no longer needs to be threaded into `ExtractionAgentService`; that dead parameter can be removed for clarity.

### 3.3 New intake statuses

`email_intake_log.processing_status` is a plain `@db.Text` column with **no CHECK constraint** (verified in `schema.prisma:259` and the init migration). New string values require **no migration**:

- `not_cv` — confident non-CV. Terminal. No candidate.
- `needs_review` — uncertain. Terminal for now. No candidate. The human-facing pile.

Existing statuses (`pending`, `processing`, `spam`, `failed`, `completed`) are unchanged.

---

## 4. Data flow & visibility

- A human sees the `needs_review` pile today via the dev DB viewer (`npm run db:studio`), filtering `processing_status = needs_review`. The full original email is in `raw_payload` / R2.
- The classifier `reason` is written to the logs (pino). It is **not** stored in a column (that would need a migration — out of scope).

---

## 5. Error handling

- **Classifier AI call fails:** throw, so BullMQ retries (3 attempts, exponential backoff — same as extraction). If all retries fail, the existing catch path stamps `failed` (visible, not silently dropped). Consistent with `ExtractionAgentService` behaviour.
- **Malformed AI output:** Zod validation in `generateObject` forces a model retry; persistent failure surfaces as a thrown error → handled as above.
- **Deterministic layer never throws** for normal input.

---

## 6. Testing (TDD — write failing tests first)

**`CvClassifierService` (unit, AI mocked):**
- Known agency + attachment → `cv` with **no** AI call (short-circuit).
- AI returns `cv` / `not_cv` / `uncertain` → returned verbatim.
- Cache hit → returns cached verdict, no AI call.
- AI throws → propagates (for retry).

**`IngestionProcessor` (integration, services mocked):**
- verdict `cv` → extraction + `candidate.create` run; status ends `completed`.
- verdict `not_cv` → `candidate.create` **never called**; status `not_cv`.
- verdict `uncertain` → `candidate.create` **never called**; status `needs_review`.
- spam still short-circuits before the classifier (unchanged).

**Representative fixtures:** resume PDF → cv; invoice PDF → not_cv; newsletter → not_cv; "thanks, talk tomorrow" reply → not_cv; agency submission → cv; document with no job context → uncertain.

Existing spam-filter and extraction specs must stay green.

---

## 7. Out of scope (explicit)

- In-app "Review inbox" UI + endpoint to list / approve / reject `needs_review` emails (frontend — "logic only" excludes it).
- Re-processing an approved `needs_review` email into a candidate.
- Storing the classifier `reason` in a DB column.
- Reworking the spam-filter keyword lists.

---

## 8. Files touched

- **New:** `src/ingestion/services/cv-classifier.service.ts` (+ spec)
- **Edit:** `src/ingestion/ingestion.processor.ts` (wire the gate)
- **Edit:** `src/ingestion/ingestion.module.ts` (provide the new service)
- **Edit (cleanup):** `src/ingestion/services/extraction-agent.service.ts` (drop the now-unused `suspicious` parameter)
- **Maybe:** `src/storage/storage.service.ts` (classifier verdict cache helpers, mirroring the extraction cache)
