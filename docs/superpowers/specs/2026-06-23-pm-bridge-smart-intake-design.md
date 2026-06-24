# PM Bridge → Smart Jira Intake — Design

- **Date:** 2026-06-23
- **Status:** Approved design, pre-implementation
- **Repos affected:** `talent-os-backend` (core), `talent-os-client` (UI), `PROTOCOL.md` (both)
- **Author:** Daniel (daniel.s@triolla.io) + Claude

---

## 1. Problem & goal

Today's PM Bridge lets a non-technical PM file Jira tickets from the app: he types plain text →
AI drafts **one** ticket (Epic/Story/Task/Bug) and checks it against the open board + recorded
"product decisions" → he reviews a **technical verdict card** (issue-type badges, ticket keys,
acceptance-criteria, radio buttons to pick which ticket to update) → it files. It is **one-shot**,
**assigns no one**, builds **no hierarchy**, and lets the PM **override conflicts** with a typed reason.

We want it to behave like a senior technical PM who does not trust an impulsive, non-technical
stakeholder:

1. **Assign everything to Daniel** (`daniel.s@triolla.io`) at every level.
2. **Build a professional, right-sized Jira structure** (Epic / Story / Task / Sub-task) — but the
   PM never sees or hears about that structure; it confuses him.
3. **Validate hard ("never trust the PM")** — interrogate vague/contradictory asks, and never let
   him file work that duplicates or overrides existing tickets/decisions.

The PM's job is to express *intent in plain words*. The system's job is to turn that into
developer-ready Jira work, or to stop it.

---

## 2. Locked decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | PM experience | **Clarify, then auto-file** — adaptive plain-language clarify loop → one-line goal confirm → silent hierarchy build → file |
| 2 | Conflict posture | **Hold for approval** — duplicates fold into existing; genuine conflicts/overrides are held for Daniel; the PM can never force one through |
| 3 | Duplicate visibility | **Plain question, no keys** — the clarify loop asks a plain yes/no; the system routes silently. No ticket keys or Jira terms shown to the PM |
| 4 | Structure depth | **Right-size per request** — tiny → one Task; feature → Epic + Stories/Tasks + Sub-tasks. No fixed template |
| 5 | Confirm card | **Goal only, one line** — PM sees a single restated goal + [File it] / [Reword]. No outcomes, no size, no Jira |
| 6 | Held review surface | **Notify only** — held items live in the app DB; Daniel gets an email (Mailgun) with the request + conflict + Approve/Reject links. No queue screen. Jira untouched until approved |
| 7 | AI architecture | **Hybrid** — clarify is a flexible agentic loop; validate → decompose → hold/file are strict, deterministic, schema-validated, individually testable stages |

---

## 3. PM-facing experience

The PM **never** sees a Jira concept (issue type, key, epic, acceptance criteria, assignee, override).
Four states only:

1. **Dump** — “What do you need?” textarea + mic (existing speech-to-text, Hebrew/English).
2. **Clarify** *(only when needed)* — chat-style: ≤ 3 plain questions, each with tappable chips when
   the options are knowable, plus free text / voice. Examples: *“Is search slow, or showing the wrong
   people?”* / *“This sounds like the search-speed work already in progress — same thing, or new?”*
3. **Confirm** — one line: *“I’ll make candidate search fast. File it?”* + **[File it]** / **[Reword]**.
4. **Result** — one of:
   - *“Done — it’s set up and on the team’s list.”* (filed)
   - *“Added to work already underway.”* (folded into a duplicate)
   - *“Flagged for the team to confirm before we start.”* (held for Daniel)

If the PM closes the panel mid-conversation, nothing is persisted and nothing is filed.

---

## 4. Architecture — the hybrid brain

```
PM dump
  │
  ▼
① CLARIFY   (agentic loop · Claude)  ◄──► PM answers (chips / voice)
   • Is the ask clear, coherent, non-contradictory, and safe to act on?
   • May ask a plain dedup question if it suspects overlap (no keys).
   • Asks ≤ 3 questions total; if still unclear after 3 rounds → HOLD for Daniel.
   • When satisfied → emits  goal (one line, PM sees)  +  InternalBrief (hidden).
  │   PM taps "File it"
  ▼
② VALIDATE  (strict · Claude + live board read)   → clean | duplicate | conflict
  │
  ├─ duplicate → FOLD: add a comment to the existing issue with the PM's context
  │              (never overwrite). PM: "added to work already underway."
  ├─ conflict  → HOLD: persist pm_held_request, email Daniel. PM: "flagged for the team."
  └─ clean     ▼
              ③ DECOMPOSE  (strict · Claude)
                 • right-sizes the InternalBrief into a native Jira tree
                 • enriches with the technical detail Daniel needs to build it
                 • assigns every issue to Daniel
              ▼
              ④ FILE → Jira (top-down: Epic → children → sub-tasks). PM: "Done."
```

Only **①** is a free-form loop. **②③④** are deterministic, each a focused schema-validated Claude
call (or pure code for ④'s Jira writes), and unit-testable in isolation — matching the existing
`pm-bridge` service style.

### Conversation state
`/converse` is **stateless** on the server: the client holds the full transcript and resends it each
turn (chat-completion style). Nothing about an in-progress conversation is stored. Only a **held**
item is ever written to the DB.

### InternalBrief (hidden from PM)
Emitted by stage ① when ready; consumed by ②③. Indicative shape:
```ts
interface InternalBrief {
  goal: string;            // the one line shown to the PM
  problem: string;         // what's actually wrong / desired, fuller
  desiredOutcomes: string[];
  constraints: string[];   // incl. anything pulled from clarify answers
  affectedArea: { name: string; route: string };   // from useCurrentPage
  sizeHint: 'tiny' | 'medium' | 'large';            // decompose may override
  devNotes: string[];      // technical seeds for enrichment
  rawText: string;         // PM's original words
  conversationDigest: string;
}
```

---

## 5. Backend changes (`talent-os-backend/src/pm-bridge/`)

### Endpoints
| Method | Path | Change | Body → Response |
|--------|------|--------|------------------|
| POST | `/converse` | **new** (replaces `/draft`) | `{ messages: Turn[], page }` → `{type:'clarify', questions[]}` \| `{type:'ready', goal, brief}` |
| POST | `/commit` | **changed** | `{ brief, page }` → `{type:'filed'}` \| `{type:'merged'}` \| `{type:'held'}` |
| POST | `/holds/:id/approve` | **new** | token-authed (signed link) → builds & files, redirects to a tiny confirmation page |
| POST | `/holds/:id/reject` | **new** | token-authed → marks rejected |
| GET/POST/PATCH | `/decisions` | unchanged | — |

The old **409 conflict + `overrideReason`** path on `/commit` is **deleted**. The PM can no longer
push a conflict through; conflicts become holds.

### Conversation turn / clarify shapes
```ts
type Turn = { role: 'pm' | 'assistant'; content: string };
interface ClarifyQuestion { id: string; prompt: string; chips?: string[]; allowFreeText: boolean }
```

### Services
- `pm-ai.service.ts` — split the single `draftAndValidate()` into three focused calls:
  `clarify(messages, boardSummary)`, `validate(brief, board, decisions)`, `decompose(brief)`.
  Each has its own Zod output schema in `dto/`.
- `jira-gateway.service.ts` — add: `createIssueTree(nodes)` (top-down create, returns keys per node),
  `addComment(key, adf)` (for folding duplicates), `resolveAssignee()` (accountId, see §7). Keep the
  existing `readBoard()`.
- `pm-bridge.service.ts` — orchestrates the pipeline; owns fold/hold/file branching and held-item
  persistence + notification.
- new `pm-notify.service.ts` — held-item email; **reuses the existing outbound mailer** (SMTP via
  Mailgun, the same `SMTP_*` transport used for magic-link/invite emails — find and reuse the auth
  module's mail service rather than adding a new provider). See §8.
- `pm-bridge.guard.ts` / `SessionGuard` — unchanged for `/converse`+`/commit`+`/decisions`.
  `/holds/*` use a **signed-token guard** instead (clicked from email, no session).

### Data model (Prisma) — new table
```prisma
model PmHeldRequest {
  id            String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId      String   @map("tenant_id") @db.Uuid
  rawText       String   @db.Text
  goal          String   @db.Text
  conversation  Json     @db.JsonB           // full transcript
  brief         Json     @db.JsonB           // InternalBrief
  verdict       Json     @db.JsonB           // why it conflicted (plain + keys, for Daniel)
  status        String   @default("pending") @db.Text  // pending | approved | rejected
  createdBy     String   @map("created_by") @db.Text    // PM email
  approveToken  String   @map("approve_token") @db.Text // hashed signed token
  jiraKeys      Json?    @map("jira_keys") @db.JsonB     // set on approve
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz
  resolvedAt    DateTime? @map("resolved_at") @db.Timestamptz

  organization  Organization @relation(fields: [tenantId], references: [id], onDelete: Restrict)

  @@index([tenantId, status], name: "idx_pm_held_tenant_status")
  @@map("pm_held_requests")
}
```
`pm_product_decisions` is unchanged.

---

## 6. Jira hierarchy mapping (the one real constraint)

Native Jira Cloud hierarchy is **3 levels**: `Epic` ▸ `Story`/`Task`/`Bug` ▸ `Sub-task`. **Story and
Task are the same level (siblings)** — a literal 4-deep `Epic → Story → Task → Sub-task` chain
requires Advanced Roadmaps (**Premium**) custom hierarchy. We map "right-size" onto the native 3:

| Size | Structure |
|------|-----------|
| **tiny** ("rename a label") | one `Task` (or `Bug`) |
| **medium** ("add filter X") | one `Story` + a few `Sub-tasks` (the dev checklist) |
| **large** ("referral program") | one `Epic` ▸ several `Story`/`Task` children ▸ `Sub-tasks` under each |

- Built **top-down**: create Epic → capture key → create children with `fields.parent = {key: epicKey}`
  → create Sub-tasks (issuetype `Sub-task`) with `fields.parent = {key: childKey}`.
- The existing gateway already sets `parent.key` (for epic linking) and `customfield_10020` (sprint);
  reuse those patterns.
- Decompose **enriches** every issue with the technical specifics the PM never gave (concrete tasks,
  acceptance criteria, implementation notes) so each ticket is ready for Daniel to pick up.

---

## 7. Assignee

Jira Cloud assignment needs an **`accountId`**, not an email. Resolve Daniel's accountId once and set
`fields.assignee = { accountId }` on **every** issue at **every** level (Epic, Story, Task, Sub-task).

- New env `JIRA_DEFAULT_ASSIGNEE_ACCOUNT_ID`. (`resolveAssignee()` may look it up from
  `JIRA_DEFAULT_ASSIGNEE_EMAIL` via `/rest/api/3/user/search` at boot and cache it, as a fallback.)

---

## 8. Held-item flow (notify-only) + Mailgun

On a **conflict** verdict:
1. Persist a `pm_held_request` (status `pending`) with a hashed signed token.
2. Send an email via **Mailgun** to `daniel.s@triolla.io` containing: the PM's raw words, the
   one-line goal, the plain-language reason it conflicted, and **Approve** / **Reject** links:
   `…/api/pm-bridge/holds/:id/approve?t=<signed>` and `…/reject?t=<signed>`.
3. PM sees *“Flagged for the team to confirm before we start.”*

- **Approve** → verifies token, runs decompose + file, stores `jiraKeys`, sets `status=approved`,
  shows a tiny confirmation page. If the underlying decision conflict should be retired, Daniel can
  supersede the `pm_product_decision` as part of approval.
- **Reject** → verifies token, sets `status=rejected`. Nothing reaches Jira.
- Tokens are single-use / time-bounded; an already-resolved hold shows a "already handled" page.

Email transport: **reuse the existing outbound mailer** — the backend already sends auth email over
SMTP via Mailgun (`SMTP_HOST/PORT/USER/PASS/FROM`). No new email provider or credentials. **Not
Postmark** — the project has moved off Postmark.

---

## 9. Frontend changes (`talent-os-client/src/components/pm-bridge/`)

- `pm-bridge-draft-view.tsx` → **conversation view**: renders the clarify Q&A (chips + textarea +
  existing mic via `use-speech-to-text`), then the one-line **confirm** step.
- `pm-bridge-verdict-view.tsx` → **deleted**. The technical card (badges, keys, AC timeline,
  update-radio, override/supersede reason boxes) is gone from the PM surface.
- `pm-bridge-panel.tsx` → reducer states become `tabs | conversing | confirming | committing | result`.
- `src/lib/api/pm-bridge.ts` → `draftTicket()` → `converse()` (sends transcript); `commitTicket()`
  takes `{ brief }`; drop override/targetKey args.
- `src/types/pm-bridge.ts` → add `Turn`, `ClarifyQuestion`, `ConverseResponse`, `CommitResult`,
  `InternalBrief` (opaque to UI — passed straight back to `/commit`). Remove `BridgeVerdict`,
  `RelatedTicket`, `RecommendedAction`, etc. from the PM path.
- `pm-bridge-decision-form.tsx` and the decision tab — unchanged.
- Allowlist gating (`VITE_PM_BRIDGE_ALLOWLIST`) — unchanged.

---

## 10. Config / env (new)

| Var | Purpose |
|-----|---------|
| `JIRA_DEFAULT_ASSIGNEE_ACCOUNT_ID` | Daniel's Jira accountId for assignment |
| `JIRA_DEFAULT_ASSIGNEE_EMAIL` *(optional)* | fallback for accountId lookup |
| *(reuse existing `SMTP_*` Mailgun mailer)* | held-item notification email — no new vars |
| `PM_BRIDGE_TOKEN_SECRET` | sign approve/reject links |
| `PM_HOLD_NOTIFY_EMAIL` *(default `daniel.s@triolla.io`)* | recipient |

Existing `OPENROUTER_API_KEY`, `PM_BRIDGE_MODEL` (default `anthropic/claude-sonnet-4.6`),
`JIRA_BASE_URL/EMAIL/API_TOKEN/PROJECT_KEY/SPRINT_ID`, `PM_BRIDGE_ALLOWLIST` are reused. Model stays
configurable; Sonnet 4.6 is adequate for all three stages.

---

## 11. Edge cases

- **PM never gets clear after 3 clarify rounds** → HOLD for Daniel (never auto-file something the AI
  couldn't pin down).
- **Panel closed mid-conversation** → nothing persisted, nothing filed (transcript is client-side).
- **Jira create fails mid-hierarchy** (no transactions in Jira) → record the keys created so far on the
  record, surface the failure to **Daniel**; the PM sees a soft "saved, the team will finish setting
  this up." Re-run/cleanup is a Daniel-side action.
- **Duplicate fold** never overwrites the existing ticket — it only adds a comment with the PM's context.
- **Decision conflict** → held like any conflict; Daniel can supersede the decision on approval.
- **Concurrency / multi-tenant** → everything tenant-scoped, as today.

---

## 12. PROTOCOL.md

PM Bridge is currently **undocumented** in `PROTOCOL.md`. Add a "PM Bridge" section describing
`/converse`, `/commit`, `/holds/:id/{approve,reject}`, and `/decisions`, and keep it **byte-identical
in both repos** per the workspace contract.

---

## 13. Out of scope (future)

- A persistent in-app approval queue (we chose notify-only).
- Slack notification channel (same payload could target a webhook later).
- True 4-level hierarchy via Advanced Roadmaps (Premium).
- Editing/re-opening filed hierarchies from the PM UI.

---

## 14. Verify against the live `TO` project before coding

Not blockers for the design, but confirm first thing in implementation:
1. Story and Sub-task issue types are enabled on project `TO`; exact Sub-task type name (`Sub-task`
   vs `Subtask`).
2. Daniel's Jira `accountId`.
3. Whether `parent` is the correct field for both Epic→child and child→Sub-task in this project's
   configuration (team-managed vs company-managed differences).
