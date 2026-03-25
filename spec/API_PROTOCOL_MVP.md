# Talent OS - API Protocol (MVP)

**Single source of truth for client-server alignment. Jobs & Config endpoints only.**

---

## General Configuration

- **Base URL**: `http://localhost:3000/api` (configured via `VITE_API_URL`)
- **Required Header (all requests)**: `x-tenant-id: phase1-default-tenant`
- **Content-Type**: `application/json`

---

## Data Types

### Job Status
- `draft` — Not published
- `open` — Actively recruiting
- `closed` — No longer recruiting

### Job Type
- `full_time`
- `part_time`
- `contract`

### Screening Question Type
- `yes_no` — Binary yes/no answer
- `text` — Free-form text

### Pipeline Stage (built-in values for `/config`)
- `new`, `screening`, `interview`, `offer`, `hired`, `rejected`

### Organization Type
- `startup`
- `scale_up`
- `enterprise`
- `nonprofit`
- `government`

---

## Endpoints

### GET /config

Bootstrap endpoint returning static lookup tables for the client.

**Response: 200 OK**

```json
{
  "departments": [
    "Engineering",
    "Product",
    "Design",
    "Marketing",
    "HR"
  ],
  "hiring_managers": [
    {
      "id": "uuid",
      "name": "Jane Smith"
    }
  ],
  "job_types": [
    {
      "id": "full_time",
      "label": "Full Time"
    },
    {
      "id": "part_time",
      "label": "Part Time"
    },
    {
      "id": "contract",
      "label": "Contract"
    }
  ],
  "organization_types": [
    {
      "id": "startup",
      "label": "Startup"
    },
    {
      "id": "scale_up",
      "label": "Scale-up"
    },
    {
      "id": "enterprise",
      "label": "Enterprise"
    },
    {
      "id": "nonprofit",
      "label": "Nonprofit"
    },
    {
      "id": "government",
      "label": "Government"
    }
  ],
  "screening_question_types": [
    {
      "id": "yes_no",
      "label": "Yes / No"
    },
    {
      "id": "text",
      "label": "Free Text"
    }
  ],
  "hiring_stages_template": [
    {
      "name": "Application review",
      "is_enabled": true,
      "color": "bg-zinc-400",
      "is_custom": false,
      "order": 1
    },
    {
      "name": "Screening",
      "is_enabled": true,
      "color": "bg-blue-500",
      "is_custom": false,
      "order": 2
    },
    {
      "name": "Interview",
      "is_enabled": true,
      "color": "bg-indigo-400",
      "is_custom": false,
      "order": 3
    },
    {
      "name": "Offer",
      "is_enabled": true,
      "color": "bg-emerald-500",
      "is_custom": false,
      "order": 4
    }
  ]
}
```

**Notes:**
- All lists are static for MVP (no database lookups)
- `hiring_stages_template` provides default stages when creating a new job
- Endpoint can be cached on client (rarely changes)

---

### GET /jobs

Fetch all jobs with nested details (hiring stages & screening questions).

**Response: 200 OK**

```json
{
  "jobs": [
    {
      "id": "uuid",
      "title": "Senior Frontend Developer",
      "department": "Engineering",
      "location": "Tel Aviv",
      "job_type": "full_time",
      "status": "open",
      "hiring_manager": "Jane Smith",
      "candidate_count": 12,
      "created_at": "2025-03-01T10:00:00Z",
      "updated_at": "2025-03-10T15:30:00Z",
      "description": "Role summary text...",
      "responsibilities": "Key responsibilities...",
      "what_we_offer": "Benefits and culture...",
      "salary_range": "120k - 150k USD",
      "must_have_skills": [
        "React",
        "TypeScript"
      ],
      "nice_to_have_skills": [
        "Tailwind CSS",
        "Next.js"
      ],
      "min_experience": 3,
      "max_experience": 8,
      "selected_org_types": [
        "startup",
        "scale_up"
      ],
      "screening_questions": [
        {
          "id": "uuid",
          "text": "Do you have experience with React?",
          "type": "yes_no",
          "expected_answer": "yes"
        },
        {
          "id": "uuid",
          "text": "Tell us about your largest React project",
          "type": "text",
          "expected_answer": null
        }
      ],
      "hiring_flow": [
        {
          "id": "uuid",
          "name": "Application review",
          "is_enabled": true,
          "interviewer": null,
          "color": "bg-zinc-400",
          "is_custom": false,
          "order": 1
        },
        {
          "id": "uuid",
          "name": "Screening",
          "is_enabled": true,
          "interviewer": "Admin Cohen",
          "color": "bg-blue-500",
          "is_custom": false,
          "order": 2
        }
      ]
    }
  ],
  "total": 1
}
```

**Field Reference:**

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | uuid | No | Unique job ID |
| `title` | string | No | Job title |
| `department` | string | Yes | From `/config` departments |
| `location` | string | Yes | Geographic location |
| `job_type` | enum | No | full_time \| part_time \| contract |
| `status` | enum | No | open \| draft \| closed |
| `hiring_manager` | string | Yes | Manager name or email |
| `candidate_count` | number | No | Count of applications (read-only, computed) |
| `created_at` | ISO8601 | No | Creation timestamp |
| `updated_at` | ISO8601 | No | Last update timestamp |
| `description` | string | Yes | Role summary |
| `responsibilities` | string | Yes | Key responsibilities |
| `what_we_offer` | string | Yes | Benefits & culture |
| `salary_range` | string | Yes | e.g., "120k - 150k USD" |
| `must_have_skills` | string[] | No | Required skills (empty array OK) |
| `nice_to_have_skills` | string[] | No | Preferred skills |
| `min_experience` | number | Yes | Min years experience |
| `max_experience` | number | Yes | Max years experience |
| `selected_org_types` | enum[] | No | Organization types candidate should have |
| `screening_questions` | object[] | No | Questions array (empty OK) |
| `hiring_flow` | object[] | No | Stages array (at least 1 required) |

**Screening Question Object:**

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | uuid | No | Question ID |
| `text` | string | No | Question text |
| `type` | enum | No | yes_no \| text |
| `expected_answer` | string | Yes | For yes_no: "yes" or "no"; null for text |

**Hiring Stage Object:**

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | uuid | No | Stage ID |
| `name` | string | No | Stage name |
| `is_enabled` | boolean | No | Whether stage is active |
| `interviewer` | string | Yes | Interviewer name/email or null |
| `color` | string | No | Tailwind class (e.g., "bg-blue-500") |
| `is_custom` | boolean | No | User-created vs built-in |
| `order` | number | No | Display order (ascending) |

---

### POST /jobs

Create a new job.

**Request:**

```json
{
  "title": "Senior Frontend Developer",
  "department": "Engineering",
  "location": "Tel Aviv",
  "job_type": "full_time",
  "status": "draft",
  "hiring_manager": "Jane Smith",
  "description": "Role summary...",
  "responsibilities": "Key responsibilities...",
  "what_we_offer": "Benefits...",
  "salary_range": "120k - 150k USD",
  "must_have_skills": ["React", "TypeScript"],
  "nice_to_have_skills": ["Tailwind CSS"],
  "min_experience": 3,
  "max_experience": 8,
  "selected_org_types": ["startup"],
  "screening_questions": [
    {
      "id": "temp-uuid-1",
      "text": "React experience?",
      "type": "yes_no",
      "expected_answer": "yes"
    }
  ],
  "hiring_flow": [
    {
      "id": "temp-uuid-1",
      "name": "Screening",
      "is_enabled": true,
      "interviewer": "Admin Cohen",
      "color": "bg-blue-500",
      "is_custom": false,
      "order": 1
    }
  ]
}
```

**Validation Rules:**

| Field | Rule |
|-------|------|
| `title` | Required, non-empty |
| `job_type` | Required, one of: full_time, part_time, contract |
| `status` | Required, one of: draft, open, closed |
| `hiring_flow` | Required, array with at least 1 element; at least one must have `is_enabled: true` |
| `screening_questions` | Optional, array (can be empty) |
| `hiring_flow[].id` | Can be temporary client-generated UUID (backend assigns real IDs) |
| `screening_questions[].id` | Can be temporary client-generated UUID (backend assigns real IDs) |
| All other fields | Optional |

**Response: 201 Created**

Returns the created job (same schema as `GET /jobs` response).

---

### PUT /jobs/:id

Update an existing job.

**Request:**

Same structure as `POST /jobs`. All fields are optional and can be updated independently.

**Response: 200 OK**

Returns the updated job object.

**Special Behavior:**

- To remove a screening question: omit it from `screening_questions` array
- To remove a hiring stage: omit it from `hiring_flow` array
- To reorder stages: update `order` field values (backend preserves as provided)
- To rename a stage: update `name` field
- To toggle stage: update `is_enabled` field

**Validation:**

Same as POST, plus:
- Job must exist for the tenant
- At least one hiring stage must remain enabled

---

### DELETE /jobs/:id

Delete a job (soft delete or hard delete — backend choice).

**Response: 204 No Content**

---

## GET /candidates

Fetch all candidates in the talent pool.

> ⚠️ **UNSTABLE** — This endpoint will change soon. Schema is preliminary.

**Query Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `q` | string | Optional search query (name, email, role) |
| `filter` | enum | Optional: `all` \| `high-score` \| `available` \| `referred` \| `duplicates` |

**Response: 200 OK**

```json
{
  "candidates": [
    {
      "id": "uuid",
      "full_name": "John Doe",
      "email": "john@example.com",
      "phone": "+1 555-0100",
      "current_role": "Software Engineer",
      "location": "Tel Aviv",
      "cv_file_url": "https://...",
      "source": "linkedin",
      "created_at": "2025-03-01T10:00:00Z",
      "ai_score": 85,
      "is_duplicate": false,
      "skills": ["React", "TypeScript"]
    }
  ],
  "total": 1
}
```

**Field Reference:**

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | uuid | No | Unique candidate ID |
| `full_name` | string | No | Candidate name |
| `email` | string | Yes | Email address |
| `phone` | string | Yes | Phone number |
| `current_role` | string | Yes | Current job title |
| `location` | string | Yes | Geographic location |
| `cv_file_url` | string | Yes | URL to CV/resume file |
| `source` | string | No | How candidate was sourced (linkedin, website, agency, referral, direct) |
| `created_at` | ISO8601 | No | When candidate was added |
| `ai_score` | number | Yes | AI matching score (0-100) |
| `is_duplicate` | boolean | No | Whether flagged as duplicate |
| `skills` | string[] | No | Extracted skills |

**Notes:**
- Schema may change as AI scoring and duplicate detection features evolve
- `ai_score` computation not finalized for MVP
- Filter values are placeholder — may be renamed or restructured

---

## Error Handling

All error responses follow this format:

**Error Response (4xx / 5xx):**

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": {
      "field_name": ["Error detail 1", "Error detail 2"]
    }
  }
}
```

**Common Codes & Status:**

| Code | Status | Example |
|------|--------|---------|
| `VALIDATION_ERROR` | 400 | Missing required field |
| `NOT_FOUND` | 404 | Job doesn't exist |
| `CONFLICT` | 409 | Invalid state (e.g., all stages disabled) |
| `UNAUTHORIZED` | 401 | Missing/invalid x-tenant-id header |
| `INTERNAL_ERROR` | 500 | Server error |

**Example Error:**

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": {
      "title": ["Title is required"],
      "hiring_flow": ["At least one stage must be enabled"]
    }
  }
}
```

---

## Implementation Checklist

### Backend

**Phase 1: Schema Updates**
- [ ] Add `is_enabled`, `color` to JobStage
- [ ] Rename `responsibleUserId` → `interviewer` (string, not UUID)
- [ ] Add `expected_answer` to ScreeningQuestion
- [ ] Remove `required`, `knockout` from ScreeningQuestion (MVP simplification)

**Phase 2: Endpoints**
- [ ] GET /config (hardcoded response)
- [ ] GET /jobs (include all nested fields + computed candidate_count)
- [ ] POST /jobs (validation + nested creation)
- [ ] PUT /jobs/:id (full update with cascade)
- [ ] DELETE /jobs/:id (soft delete job + stages + questions)
- [ ] GET /candidates (with optional search & filter params)

**Phase 3: Testing**
- [ ] All endpoints return correct schema
- [ ] Tenant isolation works
- [ ] Nested arrays persist in correct order
- [ ] Error responses match format
- [ ] Candidates search/filter params work (or default to no filtering for MVP)

### Frontend

**Phase 1: Type System**
- [ ] Update `src/types/database.ts` with correct JobDB schema
- [ ] Update `src/types/index.ts` with Job UI type
- [ ] Update `src/lib/api/mappers.ts` to convert between camelCase/snake_case

**Phase 2: API Layer**
- [ ] Fetch /config on app load, store in state/context
- [ ] Implement GET /jobs with SWR
- [ ] Implement POST /jobs
- [ ] Implement PUT /jobs/:id
- [ ] Handle error responses

**Phase 3: UI Integration**
- [ ] JobForm uses /config dropdowns
- [ ] JobsTable displays correct fields
- [ ] Create/edit dialogs work with nested arrays
- [ ] Order preservation for stages

---

## Notes

**MVP Scope:**
- Jobs management (CRUD) only
- No pagination (return all jobs)
- No advanced filtering
- Config is static/hardcoded
- Single tenant (phase1-default-tenant)

**Future Phases:**
- Pagination & filtering
- Candidates endpoint
- Applications/pipeline endpoint
- Dynamic config from database
- Multi-tenant user management

