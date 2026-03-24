---
phase: quick
plan: 260324-dvq
type: execute
wave: 1
depends_on: []
files_modified:
  - .planning/phases/10-add-job-creation-feature/10-02-PLAN.md
autonomous: true
requirements: []
---

<objective>
Fix a seeding loophole in the Plan 10-02 task description: the guard `dto.hiringStages ? ...` is truthy for an empty array `[]`, which would cause a job to be created with zero stages instead of the 4 defaults. The fix is to tighten the condition to `dto.hiringStages && dto.hiringStages.length > 0 ? ...` so that an empty array falls through to the default seeding path.

Purpose: Prevent a silent data-integrity bug where a caller passes `hiringStages: []` and receives a job with no stages at all — violating requirements D-04 and D-05.
Output: Updated 10-02-PLAN.md with the corrected guard in the Task 2 code example, the must_haves truth, and any it.todo stub comment that mentions the guard.
</objective>

<execution_context>
@/Users/danielshalem/triolla/telent-os-backend/.claude/get-shit-done/workflows/execute-plan.md
@/Users/danielshalem/triolla/telent-os-backend/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/10-add-job-creation-feature/10-02-PLAN.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Fix the hiringStages guard in 10-02-PLAN.md</name>
  <files>.planning/phases/10-add-job-creation-feature/10-02-PLAN.md</files>
  <action>
Open `.planning/phases/10-add-job-creation-feature/10-02-PLAN.md` and make the following three targeted edits:

**Edit 1 — Task 2 code example (the createJob() method body).**

Locate this line in the code block inside Task 2's `<action>` section:
```
  const hiringStages = dto.hiringStages
    ? dto.hiringStages.map((s) => ({ ...s, tenantId }))
```
Replace it with:
```
  const hiringStages = dto.hiringStages && dto.hiringStages.length > 0
    ? dto.hiringStages.map((s) => ({ ...s, tenantId }))
```

**Edit 2 — must_haves truth.**

Locate the truth that describes the provided-stages path:
```
    - "When dto.hiringStages is provided, provided stages are used (not defaults)"
```
Replace it with:
```
    - "When dto.hiringStages is a non-empty array, provided stages are used (not defaults); an empty array [] falls through to default seeding"
```

**Edit 3 — Task 2 behavior block.**

Locate the behavior item:
```
    - When `dto.hiringStages` is provided as `[{name:'Custom', order:1}]`: `prisma.job.create` is called with that stage (not defaults)
```
Replace it with:
```
    - When `dto.hiringStages` is a non-empty array `[{name:'Custom', order:1}]`: `prisma.job.create` is called with that stage (not defaults)
    - When `dto.hiringStages` is an empty array `[]`: treated the same as omitted — defaults are seeded
```

No other changes. Do not alter file structure, other tasks, frontmatter, or comments.
  </action>
  <verify>
    <automated>grep -n "hiringStages.length > 0" /Users/danielshalem/triolla/telent-os-backend/.planning/phases/10-add-job-creation-feature/10-02-PLAN.md</automated>
  </verify>
  <done>
    - `.planning/phases/10-add-job-creation-feature/10-02-PLAN.md` contains `dto.hiringStages && dto.hiringStages.length > 0`
    - The old `dto.hiringStages ?` guard (without length check) is gone from the code example
    - The must_haves truth now mentions the empty-array edge case
    - The behavior block now covers the empty-array case explicitly
  </done>
</task>

</tasks>

<verification>
```bash
grep -n "hiringStages.length" /Users/danielshalem/triolla/telent-os-backend/.planning/phases/10-add-job-creation-feature/10-02-PLAN.md
```
Expected: line with `dto.hiringStages && dto.hiringStages.length > 0`

```bash
grep -c "dto\.hiringStages ?" /Users/danielshalem/triolla/telent-os-backend/.planning/phases/10-add-job-creation-feature/10-02-PLAN.md
```
Expected: 0 (the bare truthy guard is fully replaced)
</verification>

<success_criteria>
- 10-02-PLAN.md contains `dto.hiringStages && dto.hiringStages.length > 0` in the createJob() code example
- The must_haves truth for the provided-stages path explicitly calls out the empty-array edge case
- The Task 2 behavior block has a bullet covering `hiringStages: []` falling through to defaults
- No other content in 10-02-PLAN.md is changed
</success_criteria>

<output>
After completion, create `.planning/quick/260324-dvq-fix-seeding-loophole-in-plan-10-02-hirin/260324-dvq-SUMMARY.md` using the summary template.
</output>
