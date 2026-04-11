---
status: testing
phase: 19-auth-api-endpoints
source: [19-01-SUMMARY.md, 19-02-SUMMARY.md, 19-03-SUMMARY.md, 19-04-SUMMARY.md]
started: 2026-04-11T00:00:00Z
updated: 2026-04-11T00:00:00Z
---

## Current Test

<!-- OVERWRITE each test - shows where we are -->

number: null
name: All tests done
expected: |
All tests passed successfully.
awaiting: none

## Tests

### 1. Cold Start Smoke Test

expected: Kill any running server/service. Clear ephemeral state. Start the application from scratch (npm run docker:up:build). Server boots without errors, migrations run (including onboarding_completed_at column), and a basic API call (GET /health) returns a live response.
result: pass
note: health endpoint is at /api/health (not /health)

### 2. Google OAuth Sign-In (new user)

expected: POST /auth/google/verify with a dev stub token (base64 JSON like eyJlbWFpbCI6InRlc3RAZXhhbXBsZS5jb20iLCJuYW1lIjoiVGVzdCBVc2VyIn0=) creates a new Organization + User in the DB, sets a talent_os_session HTTP-only cookie in the response, and returns a MeResponse JSON with user email, role, and has_completed_onboarding: false.
result: pass

### 3. GET /auth/me — authenticated user info

expected: GET /auth/me with the talent_os_session cookie from test 2 returns 200 with MeResponse JSON (user email, name, org name, role, has_completed_onboarding). Without the cookie (or with an invalid one), returns 401 Unauthorized.
result: pass

### 4. POST /auth/logout — clears session

expected: POST /auth/logout clears the talent_os_session cookie (Set-Cookie header with empty value / Max-Age 0) and returns { "success": true }. Subsequent GET /auth/me without a new cookie returns 401.
result: pass

### 5. POST /auth/magic-link — request magic link

expected: POST /auth/magic-link with { "email": "any@email.com" } always returns 200 with { "success": true } — even for emails that don't exist (no enumeration leak). For a real registered email, an email is sent (or logged to console in dev mode).
result: pass

### 6. GET /auth/magic-link/verify — verify token

expected: GET /auth/magic-link/verify?token=<valid-redis-token> sets a talent_os_session cookie and redirects to /. Using an invalid or already-used token returns a 401 or error response (token is one-time use — a second request with the same token fails).
result: pass

### 7. GET /auth/invite/:token — view invitation details

expected: GET /auth/invite/<valid-invite-token> returns 200 with { org_name, role, email }. An expired or already-used token returns 404 (not found), 409 (already used), or 410 (expired) accordingly.
result: pass

### 8. POST /auth/invite/:token/accept — accept invitation

expected: POST /auth/invite/<valid-token>/accept creates a new User record in the DB linked to the invitation's organization, marks the invitation as accepted, sets a talent_os_session cookie, and returns a MeResponse. Trying to accept the same token again returns an error (INVITE_USED).
result: pass

### 9. POST /auth/onboarding — complete onboarding

expected: POST /auth/onboarding (with valid session cookie) with { orgName: "Acme Corp" } (and optionally a logo file) updates the organization name and sets onboarding_completed_at. Returns { success: true }. Calling it a second time returns 409 ONBOARDING_COMPLETE. Without a session cookie returns 401.
result: pass

### 10. GET /auth/team/members — list members

expected: GET /auth/team/members (with valid session cookie) returns 200 with { members: [...] } listing all active users in the organization with id, name, email, role, joined_at, auth_provider. Without a session cookie returns 401.
result: pass

### 11. GET /auth/team/invitations — list invitations

expected: GET /auth/team/invitations (with valid session cookie) returns 200 with { invitations: [...] } listing pending, non-expired invitations with id, email, role, expires_at. Without a session cookie returns 401.
result: pass

### 12. POST /auth/team/invitations — create invitation with duplicate guard

expected: POST /auth/team/invitations with { email, role } creates an invitation (7-day expiry, 256-bit token) and sends an email. Returns 201 with { id, email, role, expires_at }. Inviting an existing member returns 409 ALREADY_MEMBER. Inviting an email with a pending invite returns 409 PENDING_INVITATION.
result: pass

### 13. DELETE /auth/team/invitations/:id — cancel invitation

expected: DELETE /auth/team/invitations/<id> (owner session) removes the pending invitation and returns 204 No Content. Trying to cancel a non-existent or other org's invitation returns 404.
result: pass

### 14. PATCH /auth/team/members/:id/role — change member role (owner only)

expected: PATCH /auth/team/members/<userId>/role with { role: "member" } (owner session) updates the user's role and returns { success: true }. A non-owner session returns 403. Trying to change an owner's role returns 403 (owners cannot be demoted via this endpoint).
result: pass

### 15. DELETE /auth/team/members/:id — remove member (owner only, soft delete)

expected: DELETE /auth/team/members/<userId> (owner session) sets the user's isActive to false (soft delete) — they no longer appear in GET /auth/team/members and their subsequent requests return 401. A non-owner session returns 403. Trying to remove yourself or another owner returns 403.
result: pass

## Summary

total: 15
passed: 15
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

[none yet]
