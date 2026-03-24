---
phase: quick-260324-cbs
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - package.json
  - package-lock.json
  - src/ingestion/services/extraction-agent.service.ts
  - src/ingestion/services/extraction-agent.service.spec.ts
  - src/ingestion/services/extraction-agent.service.test-helpers.ts
  - src/ingestion/ingestion.processor.ts
  - src/ingestion/ingestion.processor.spec.ts
  - src/dedup/dedup.service.ts
  - src/dedup/dedup.service.spec.ts
  - src/webhooks/dto/postmark-payload.dto.ts
  - .planning/config.json
  - .planning/quick/260324-agv-replace-mock-ai-extraction-with-openrout/260324-agv-SUMMARY.md
  - PROTOCOL.md
autonomous: true
requirements: []
must_haves:
  truths:
    - All unstaged changes are committed in logical atomic units
    - Each commit message reflects what the code actually does
  artifacts:
    - path: PROTOCOL.md
      provides: API contract document
  key_links: []
---

<objective>
Commit all unstaged changes into logical atomic git commits.

Purpose: The working tree contains changes from at least two distinct work streams that accumulated since the last committed quick task (260324-c3g). These need to be committed cleanly so the repo history is accurate.
Output: 4 atomic commits covering SDK swap, schema rename, Zod v4 compat, and docs/config cleanup.
</objective>

<execution_context>
@/Users/danielshalem/triolla/telent-os-backend/.claude/get-shit-done/workflows/execute-plan.md
@/Users/danielshalem/triolla/telent-os-backend/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
</context>

<issues_found>
1. **`extractDeterministically` is dead code** — `extraction-agent.service.ts` still contains the full `extractDeterministically()` private method but nothing calls it. It was replaced by `callAI()`. This is not blocking; commit as-is and note.
2. **`currentRole` / `yearsExperience` hardcoded to `null`** — `CandidateExtractSchema` was slimmed to remove these fields (removed `currentRole`, `yearsExperience`, `source` from the schema). `ingestion.processor.ts` and `ingestion.processor.spec.ts` now pass `null` explicitly for these fields when updating candidates. This is intentional given Phase 7 intent per comments in the code, but worth noting in the commit message.
3. **`@openrouter/sdk` replaces `@ai-sdk/openai`** — The package swap happened but `@ai-sdk/openai` is fully removed from package.json and package-lock.json. Verify no other imports remain before committing.
</issues_found>

<tasks>

<task type="auto">
  <name>Task 1: Commit SDK swap — @ai-sdk/openai → @openrouter/sdk and schema rename</name>
  <files>package.json, package-lock.json, src/ingestion/services/extraction-agent.service.ts, src/ingestion/services/extraction-agent.service.spec.ts, src/ingestion/services/extraction-agent.service.test-helpers.ts</files>
  <action>
    Before staging, confirm no remaining @ai-sdk/openai imports in non-package files:

    ```
    grep -r "@ai-sdk/openai" src/ 2>/dev/null
    ```

    If the grep is clean, stage and commit these five files together. They form a single logical unit: the package swap and the CandidateExtract schema field rename (fullName→full_name, currentRole/yearsExperience/source removed, summary→ai_summary).

    Commit command:
    ```
    git add package.json package-lock.json \
      src/ingestion/services/extraction-agent.service.ts \
      src/ingestion/services/extraction-agent.service.spec.ts \
      src/ingestion/services/extraction-agent.service.test-helpers.ts
    git commit -m "$(cat <<'EOF'
refactor(extraction): swap @ai-sdk/openai for @openrouter/sdk; rename schema fields

- Replace @ai-sdk/openai with @openrouter/sdk in package.json and lock
- Rename CandidateExtractSchema fields: fullName→full_name, summary→ai_summary
- Drop currentRole, yearsExperience, source from schema (Phase 7 deferred)
- Update extraction-agent.service.ts to use OpenRouter.callModel() + getText()
- Update spec and test-helpers to match new field names and mock shape
- Add markdown code-fence stripping test (model sometimes wraps output)
- Note: extractDeterministically() is unreachable dead code — left for reference

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
    ```
  </action>
  <verify>git log --oneline -1 shows the refactor(extraction) commit</verify>
  <done>5 files committed; no @ai-sdk/openai references remain outside node_modules</done>
</task>

<task type="auto">
  <name>Task 2: Commit dedup and processor updates for renamed schema fields</name>
  <files>src/dedup/dedup.service.ts, src/dedup/dedup.service.spec.ts, src/ingestion/ingestion.processor.ts, src/ingestion/ingestion.processor.spec.ts</files>
  <action>
    These four files update call sites to use the renamed CandidateExtract fields (full_name instead of fullName, ai_summary instead of summary, currentRole/yearsExperience now hard-null). They depend on the schema change in Task 1 and form a single propagation commit.

    ```
    git add src/dedup/dedup.service.ts src/dedup/dedup.service.spec.ts \
      src/ingestion/ingestion.processor.ts src/ingestion/ingestion.processor.spec.ts
    git commit -m "$(cat <<'EOF'
fix(dedup,processor): update call sites for renamed CandidateExtract fields

- DedupService: replace candidate.fullName with candidate.full_name throughout
- IngestionProcessor: replace extraction.fullName/summary with full_name/ai_summary
- Set currentRole/yearsExperience to null explicitly (fields removed from schema)
- Update all spec mocks to use new field names
- Add jest.mock('@openrouter/sdk') in ingestion.processor.spec.ts to prevent ESM errors

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
    ```
  </action>
  <verify>git log --oneline -2 shows fix(dedup,processor) commit</verify>
  <done>4 files committed; processor and dedup specs reference full_name throughout</done>
</task>

<task type="auto">
  <name>Task 3: Commit Zod v4 email validator fix in postmark-payload.dto.ts</name>
  <files>src/webhooks/dto/postmark-payload.dto.ts</files>
  <action>
    The change replaces `z.string().email()` with `z.email()` — this is the Zod v4 API (the project uses zod ^4.x alongside ^3.x per package.json peerDeps). Stage and commit alone since it touches a different module boundary.

    ```
    git add src/webhooks/dto/postmark-payload.dto.ts
    git commit -m "$(cat <<'EOF'
fix(webhooks): use z.email() for Zod v4 compatibility in PostmarkPayloadSchema

z.string().email() is deprecated in Zod v4; replace with z.email() on the From field.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
    ```
  </action>
  <verify>git log --oneline -1 shows fix(webhooks) commit</verify>
  <done>1 file committed; PostmarkPayloadSchema From field uses z.email()</done>
</task>

<task type="auto">
  <name>Task 4: Commit planning/config and docs files</name>
  <files>.planning/config.json, .planning/quick/260324-agv-replace-mock-ai-extraction-with-openrout/260324-agv-SUMMARY.md, PROTOCOL.md</files>
  <action>
    Three unrelated-to-code files:
    - `.planning/config.json`: enables research flag, disables ui_phase/ui_safety_gate, adds research_before_questions and skip_discuss flags
    - `260324-agv-SUMMARY.md`: minor formatting cleanup (quote style, table alignment, blank lines)
    - `PROTOCOL.md`: new untracked file containing the client-facing REST API contract document

    ```
    git add .planning/config.json \
      ".planning/quick/260324-agv-replace-mock-ai-extraction-with-openrout/260324-agv-SUMMARY.md" \
      PROTOCOL.md
    git commit -m "$(cat <<'EOF'
docs: add PROTOCOL.md API contract; update planning config and agv summary

- PROTOCOL.md: MVP REST API contract for client (candidates, jobs, pipeline, dedup endpoints)
- config.json: enable research, disable ui_phase gate, add research_before_questions flag
- 260324-agv-SUMMARY.md: normalize quote style and table alignment (cosmetic)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
    ```
  </action>
  <verify>git status shows clean working tree (no unstaged changes)</verify>
  <done>All 3 files committed; git status is clean</done>
</task>

</tasks>

<verification>
After all 4 commits:
- `git status` shows clean working tree
- `git log --oneline -4` shows 4 logical commits
- `grep -r "@ai-sdk/openai" src/` returns no matches
- `grep -r "fullName" src/` returns no matches (all renamed to full_name)
</verification>

<success_criteria>
Working tree is clean. 4 atomic commits in git history. Each commit is self-contained and its message accurately describes the change.
</success_criteria>

<output>
After completion, create `.planning/quick/260324-cbs-commit-all-unsaved-changes-into-atomic-c/260324-cbs-SUMMARY.md`
</output>
