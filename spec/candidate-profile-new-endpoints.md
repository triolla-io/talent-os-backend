# Missing API Endpoints for Candidate Profile Feature

This document lists the backend endpoints and operations that the frontend components in `src/components/candidate-profile` expect to use, but which are currently missing from the official `PROTOCOL.md`.

These endpoints are required to bring the candidate profile feature to full functionality.

## 1. Assign Candidate to a Job

**Component:** `candidate-profile-page.tsx`
**Current Frontend Implementation:**

```typescript
await api.patch(`/candidates/${_candidateId}`, { job_id: _jobId });
```

**Purpose:** Assigns a "floater" candidate (a candidate not tied to any job pipeline) to an open job position.

- **Method & Path:** `PATCH /candidates/:id`
- **Request Body:** `{ "job_id": "uuid" }`
- **Expected Response:** `200 OK`

---

## 2. Reject Unassigned Candidate

**Component:** `candidate-profile-page.tsx`
**Current Frontend Implementation:**

```typescript
await api.post(`/candidates/${_candidateId}/reject`, {});
```

**Purpose:** Immediately rejects a candidate who is not assigned to any job pipeline, marking them as irrelevant.

- **Method & Path:** `POST /candidates/:id/reject`
- **Request Body:** `{}` (empty)
- **Expected Response:** `200 OK`

---

## 3. Edit Candidate Profile Information

**Component:** `editable-profile-section.tsx`
**Current Frontend Implementation:** Contains a `handleSave()` function with a `// TODO: Save to API` comment for profile updates.
**Purpose:** Allows a user/recruiter to manually edit standard candidate fields (Name, Email, Phone, Role, Location, Experience).

- **Suggested Method & Path:** `PUT /candidates/:id` or `PATCH /candidates/:id` _(Note: If you implement a generic `PATCH /candidates/:id`, it can be used for both this feature and Feature #1)._
- **Expected Request Body:**
  ```json
  {
    "full_name": "string",
    "email": "string",
    "phone": "string",
    "current_role": "string",
    "location": "string",
    "years_experience": "string | number"
  }
  ```
- **Expected Response:** `200 OK` (ideally returning the updated candidate object)

---

## 4. Save Phase Summary

**Component:** `phase-summary-modal.tsx`
**Current Frontend Implementation:** Contains `// await savePhaseSummary(_phaseId, summary)`
**Purpose:** Documents the interviewer's textual assessment or free-text notes for a specific hiring stage (phase) the candidate has gone through.

- **Suggested Method & Path:** `POST /candidates/:id/stages/:stage_id/summary` (or similar logical path)
- **Expected Payload:** Needs to capture the `summary` (string) for a specific `stage_id`.
- **Expected Response:** `200 OK`

---

## 5. Move to Next Stage with Summary

**Component:** `phase-summary-modal.tsx`
**Current Frontend Implementation:** Contains `// await moveToNextStage(_phaseId, summary)`
**Purpose:** A composite action that saves the summary for the _current_ stage AND simultaneously advances the candidate to the _next_ logical hiring stage.

- **Backend Implications:** You can either create a dedicated composite endpoint (e.g., `POST /candidates/:id/stages/:stage_id/advance` with a `{ "summary": "..." }` payload) _or_ instruct the frontend developer to chain two existing API calls (`savePhaseSummary` followed by the already supported `PATCH /candidates/:id/stage`).
