---
phase: quick-260323-mai
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - scripts/ngrok-webhook.sh
  - docker-compose.dev.yml
  - package.json
  - package-lock.json
  - prisma.config.ts
  - prisma/seed.ts
  - src/main.ts
  - README.md
autonomous: true
requirements: []

must_haves:
  truths:
    - "All uncommitted changes are reviewed and validated"
    - "The one real bug (ngrok token parsing) is fixed"
    - "Each logical group of changes is committed atomically"
  artifacts:
    - path: "scripts/ngrok-webhook.sh"
      provides: "Fixed token extraction that handles = signs in token values"
  key_links:
    - from: "scripts/ngrok-webhook.sh"
      to: "POSTMARK_WEBHOOK_TOKEN in .env"
      via: "grep + cut"
      pattern: "cut -d '=' -f2-"
---

<objective>
Review, validate, fix one confirmed bug, and commit all uncommitted changes atomically by logical group.

Purpose: The dev session left 8 modified files uncommitted. Changes span developer tooling, Prisma config, and seed wiring. One bug exists in the ngrok script's token parsing.
Output: Clean git history with atomic commits per concern, all changes validated.
</objective>

<execution_context>
@/Users/danielshalem/triolla/telent-os-backend/.claude/get-shit-done/workflows/execute-plan.md
@/Users/danielshalem/triolla/telent-os-backend/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Fix ngrok token parsing bug and validate all changes</name>
  <files>scripts/ngrok-webhook.sh</files>
  <action>
Fix the one confirmed bug in scripts/ngrok-webhook.sh:

Line 40 currently reads:
```
POSTMARK_TOKEN=$(grep -E "^POSTMARK_WEBHOOK_TOKEN=" .env | cut -d '=' -f2 | sed ...)
```

The `cut -d '=' -f2` only captures the text between the first and second `=` sign. If the token value contains `=` characters (common in base64 strings), the value is silently truncated.

Fix: change `cut -d '=' -f2` to `cut -d '=' -f2-` (the trailing dash means "field 2 through end of line").

Correct line 40 to:
```bash
POSTMARK_TOKEN=$(grep -E "^POSTMARK_WEBHOOK_TOKEN=" .env | cut -d '=' -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")
```

No other files need changes. The rest of the diff is correct:

- docker-compose.dev.yml: `npm install && npx prisma generate &&` prefix ensures Prisma client is generated before startup on fresh containers. Correct.
- package.json db:studio script: `--url` flag points Prisma Studio at localhost:5432 for local dev outside Docker. Correct.
- package-lock.json: removal of `libc` fields from optional native binaries is a valid platform-lock cleanup by npm. No action needed.
- prisma.config.ts: migrations.seed block is correct for Prisma 7. The prod path `node dist/prisma/seed.js` is acceptable — seeding is a manual dev op, not runtime code.
- prisma/seed.ts: explicit PrismaPg adapter is required for Prisma 7 driver adapter mode. Correct.
- src/main.ts: blank line removal. No action.
- README.md: table alignment cosmetic fix. No action.
  </action>
  <verify>
    <automated>bash -n scripts/ngrok-webhook.sh && echo "Shell syntax OK"</automated>
  </verify>
  <done>scripts/ngrok-webhook.sh has `cut -d '=' -f2-` on the token extraction line; shell syntax check passes.</done>
</task>

<task type="auto">
  <name>Task 2: Commit changes atomically by logical group</name>
  <files>scripts/ngrok-webhook.sh, docker-compose.dev.yml, package.json, package-lock.json, prisma.config.ts, prisma/seed.ts, src/main.ts, README.md</files>
  <action>
Commit the validated changes in 4 atomic groups. Use absolute paths with git commands. Run from /Users/danielshalem/triolla/telent-os-backend.

Commit 1 — Fix ngrok token parsing:
```
git add scripts/ngrok-webhook.sh
git commit -m "fix(quick-260323-mai): ngrok token extraction handles = in token values (cut -f2-)"
```

Commit 2 — Docker dev compose startup fix:
```
git add docker-compose.dev.yml
git commit -m "fix(quick-260323-mai): docker-compose.dev ensures npm install + prisma generate on container start"
```

Commit 3 — Prisma seed + config improvements:
```
git add prisma.config.ts prisma/seed.ts
git commit -m "fix(quick-260323-mai): prisma.config seed command per env; seed.ts uses PrismaPg adapter"
```

Commit 4 — Dev tooling and docs:
```
git add package.json package-lock.json src/main.ts README.md
git commit -m "chore(quick-260323-mai): db:studio --url flag, package-lock cleanup, README table alignment"
```

Each commit must be clean (no trailing staged files). Run `git status` after all commits to confirm working tree is clean.
  </action>
  <verify>
    <automated>cd /Users/danielshalem/triolla/telent-os-backend && git log --oneline -5 && git status --short</automated>
  </verify>
  <done>git status shows clean working tree; git log shows 4 new atomic commits in correct order.</done>
</task>

</tasks>

<verification>
- `bash -n scripts/ngrok-webhook.sh` passes (no shell syntax errors)
- `git status` is clean (no modified or untracked files in the 8 changed paths)
- `git log --oneline -5` shows the 4 atomic commits
- `cut -d '=' -f2-` is present in scripts/ngrok-webhook.sh line 40
</verification>

<success_criteria>
All 8 modified files committed in 4 atomic groups. The ngrok token parsing bug is fixed. Working tree is clean. No other bugs were introduced in the reviewed changes.
</success_criteria>

<output>
After completion, create `.planning/quick/260323-mai-validate-uncommitted-changes-find-potent/260323-mai-SUMMARY.md` with:
- What was reviewed (all 8 files)
- Bug found and fixed (ngrok cut -f2 -> cut -f2-)
- Commit SHAs for the 4 commits
- Validation outcome
</output>
