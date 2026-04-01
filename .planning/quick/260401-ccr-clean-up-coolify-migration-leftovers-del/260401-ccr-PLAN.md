---
phase: quick
plan: 260401-ccr
type: execute
wave: 1
depends_on: []
files_modified:
  - nginx/nginx.conf
  - scripts/deploy.sh
  - scripts/setup-ssl.sh
  - Makefile
  - .github/workflows/ci.yml
autonomous: true
requirements: []

must_haves:
  truths:
    - "nginx/nginx.conf, scripts/deploy.sh, and scripts/setup-ssl.sh no longer exist in the repo"
    - "Makefile .PHONY line and help block contain no references to migrate-prod or ssl-setup"
    - "CI workflow uses node-version: '22' matching the Dockerfile"
  artifacts:
    - path: "Makefile"
      provides: "Cleaned Makefile without Coolify-era targets"
      contains: ".PHONY: up down reset seed logs test backup restore ngrok help"
    - path: ".github/workflows/ci.yml"
      provides: "CI workflow with correct Node version"
      contains: "node-version: '22'"
  key_links:
    - from: "Makefile .PHONY"
      to: "Makefile targets"
      via: "target name must match .PHONY entry"
      pattern: "\\.PHONY.*migrate-prod"
---

<objective>
Remove three files and two Makefile targets left over from the Coolify/nginx/SSL era, and fix a node-version mismatch in CI.

Purpose: The previous quick task (260401-c3k) migrated to Coolify and GitHub Actions CI. Three now-orphaned files remain in the repo and two Makefile targets reference deleted scripts. CI also specifies Node 20 while the Dockerfile uses Node 22.
Output: Clean repo with no Coolify/nginx/SSL remnants; CI node-version aligned with Dockerfile.
</objective>

<execution_context>
@/Users/danielshalem/triolla/telent-os-backend/.claude/get-shit-done/workflows/execute-plan.md
@/Users/danielshalem/triolla/telent-os-backend/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Delete orphaned Coolify/nginx/SSL files</name>
  <files>nginx/nginx.conf, scripts/deploy.sh, scripts/setup-ssl.sh</files>
  <action>
    Delete the three files that are no longer referenced after the Coolify migration:
    - nginx/nginx.conf — nginx was removed from docker-compose; this file is unused
    - scripts/deploy.sh — Coolify handles deployment; manual deploy script is obsolete
    - scripts/setup-ssl.sh — Coolify handles SSL termination; certbot script is obsolete

    Run:
      git rm nginx/nginx.conf scripts/deploy.sh scripts/setup-ssl.sh

    If the nginx/ directory becomes empty after removing nginx.conf, it will also be removed by git automatically.
  </action>
  <verify>
    <automated>git status --short | grep -E "^D.*(nginx/nginx\.conf|scripts/deploy\.sh|scripts/setup-ssl\.sh)" | wc -l | grep -q 3 && echo "PASS: 3 files staged for deletion" || echo "FAIL"</automated>
  </verify>
  <done>All three files are staged for deletion via git rm; none present in working tree.</done>
</task>

<task type="auto">
  <name>Task 2: Clean Makefile and fix CI node-version</name>
  <files>Makefile, .github/workflows/ci.yml</files>
  <action>
    **Makefile — remove migrate-prod and ssl-setup targets:**

    1. Update the `.PHONY` line from:
       `.PHONY: up down reset seed logs test backup restore ngrok migrate-prod ssl-setup help`
       to:
       `.PHONY: up down reset seed logs test backup restore ngrok help`

    2. Remove the two help lines for migrate-prod and ssl-setup from the `help` target:
       - Delete: `@echo "  make migrate-prod          Run prisma migrate deploy on production server"`
       - Delete: `@echo "  make ssl-setup DOMAIN=x EMAIL=y  Provision Let's Encrypt certificate"`

    3. Delete the entire `migrate-prod` target block (lines 78-84 in current file):
       ```
       # D-07: Run prisma migrate deploy on production server
       # Requires PROD_HOST environment variable (or edit this target)
       migrate-prod:
       ifndef PROD_HOST
       	$(error PROD_HOST is required. ...)
       endif
       	ssh $(PROD_HOST) "cd ~/triolla && ..."
       ```

    4. Delete the entire `ssl-setup` target block (lines 87-95 in current file):
       ```
       # D-38: Provision Let's Encrypt certificate
       ssl-setup:
       ifndef DOMAIN
       	$(error DOMAIN is required. ...)
       endif
       ifndef EMAIL
       	$(error EMAIL is required. ...)
       endif
       	./scripts/setup-ssl.sh $(DOMAIN) $(EMAIL)
       ```

    **ci.yml — fix node-version:**

    Change:
      `node-version: '20'`
    to:
      `node-version: '22'`
  </action>
  <verify>
    <automated>grep -c "migrate-prod\|ssl-setup" /Users/danielshalem/triolla/telent-os-backend/Makefile | grep -q "^0$" && grep -q "node-version: '22'" /Users/danielshalem/triolla/telent-os-backend/.github/workflows/ci.yml && echo "PASS" || echo "FAIL"</automated>
  </verify>
  <done>
    - Makefile .PHONY has no migrate-prod or ssl-setup entries
    - Makefile help block has no migrate-prod or ssl-setup lines
    - migrate-prod and ssl-setup target blocks are gone
    - ci.yml specifies node-version: '22'
  </done>
</task>

</tasks>

<verification>
After both tasks:
- `grep -r "migrate-prod\|ssl-setup\|nginx.conf\|deploy.sh\|setup-ssl" Makefile .github/workflows/ci.yml` returns no matches
- `ls nginx/nginx.conf scripts/deploy.sh scripts/setup-ssl.sh 2>&1` reports "No such file or directory" for all three
- `make help` output contains no migrate-prod or ssl-setup entries (run `make help` to confirm)
- `grep node-version .github/workflows/ci.yml` shows `'22'`
</verification>

<success_criteria>
- Three Coolify-era files deleted from repo (git rm staged)
- Makefile contains no migrate-prod or ssl-setup references anywhere
- CI uses node-version: '22' matching Dockerfile
</success_criteria>

<output>
After completion, create `.planning/quick/260401-ccr-clean-up-coolify-migration-leftovers-del/260401-ccr-SUMMARY.md`
</output>
