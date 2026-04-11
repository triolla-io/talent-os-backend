# Auth & Roles — User Stories

## Epic: AUTH-000 — Authentication & User Management

---

### AUTH-001 — Google Sign-Up (Owner)

> **As a** recruiter setting up Triolla for my organization,
> **I want to** sign up using my Google account,
> **So that** I'm automatically set as the account Owner without needing to create a password.

**Acceptance Criteria:**

- [ ] `/signup` displays a "Continue with Google" button.
- [ ] After Google consent, a new **Tenant** is created with the email domain as the default name.
- [ ] User is saved to the DB with `role = 'owner'` and `auth_provider = 'google'`.
- [ ] User is redirected to `/onboarding` after successful registration.
- [ ] If the email already exists — user is redirected to `/login` with a clear error message.

**Notes:**

- The Owner is always the first person who created the tenant. This role cannot be changed from the UI.

---

### AUTH-002 — Onboarding After Sign-Up

> **As a** new Owner,
> **I want to** set up my organization name and logo after signing up,
> **So that** the workspace reflects my company before I invite anyone.

**Acceptance Criteria:**

- [ ] `/onboarding` is shown automatically after initial sign-up only.
- [ ] **Fields:** organization name (required), logo (optional).
- [ ] After saving — redirect to `/dashboard`.
- [ ] If a user navigates to `/onboarding` after completing it — redirect to `/dashboard`.

---

### AUTH-003 — Invite a Team Member

> **As an** Owner or Admin,
> **I want to** invite a team member by email and assign them a role,
> **So that** they can access the system with the right permissions.

**Acceptance Criteria:**

- [ ] **Settings → Team** includes an invite form with an Email field and a role dropdown (Admin / Member / Viewer).
- [ ] On submit, an `invitations` record is created with a one-time token valid for 7 days.
- [ ] An email is sent containing a Magic Link: `https://talentos.triolla.io/invite?token={token}`.
- [ ] If the email is already a member of the tenant — error: _"This user already exists in the organization"_.
- [ ] If a pending invitation exists for that email — error: _"A pending invitation has already been sent"_.
- [ ] **Settings → Team** displays a list of pending invitations with a **Cancel** option.

**Notes:**

- Member and Viewer roles cannot invite users.

---

### AUTH-004 — Accept Invitation (Magic Link)

> **As an** invited user,
> **I want to** click the link in my invitation email and join the workspace,
> **So that** I can access Triolla without creating a password.

**Acceptance Criteria:**

- [ ] Clicking the link shows a confirmation page with the organization name and assigned role.
- [ ] Clicking "Join" creates the user in the DB with the role defined in the invitation.
- [ ] `invitations.status` is updated to `accepted`.
- [ ] User is redirected to `/dashboard` after joining.
- [ ] An already-used link displays: _"This link has already been used"_.
- [ ] An expired link displays: _"This link has expired"_ + a "Request a new invitation" button.
- [ ] An invalid link displays: _"This link is not valid"_.

---

### AUTH-005 — Returning User Login

> **As a** returning user,
> **I want to** log in to Triolla,
> **So that** I can access my workspace.

**Acceptance Criteria:**

- [ ] Owners and Admins who signed up with Google → "Continue with Google" button.
- [ ] Users who joined via Magic Link → Magic Link login (not Google).
- [ ] A user without access to the specific tenant sees a clear error message.
- [ ] A user with an active session is redirected directly to `/dashboard` (login page is not shown).

---

### AUTH-006 — Authorization Guards

> **As a** system,
> **I want to** enforce role-based access on every route and action,
> **So that** users can only perform actions permitted by their role.

**Acceptance Criteria:**

- [ ] **Viewer:** read-only access — Pipeline, Talent Pool, Reports (no edit controls shown).
- [ ] **Member:** everything Viewer has + create/edit Job Openings + move candidates between stages.
- [ ] **Admin:** everything Member has + invite users + organization settings + manage AI Agents.
- [ ] **Owner:** full access + change/remove users.
- [ ] Unauthorized access attempts return `403 Forbidden`.
- [ ] UI hides or disables elements not permitted for the current role (buttons, menus).

---

## Story Summary

| Story        | Description                    | Requesting Role | Priority |
| :----------- | :----------------------------- | :-------------- | :------- |
| **AUTH-001** | Google Sign-Up                 | Owner           | **P0**   |
| **AUTH-002** | Onboarding after Sign-Up       | Owner           | **P0**   |
| **AUTH-003** | Invite a team member           | Owner / Admin   | **P0**   |
| **AUTH-004** | Accept invitation (Magic Link) | Invited User    | **P0**   |
| **AUTH-005** | Returning user login           | All             | **P0**   |
| **AUTH-006** | Authorization Guards           | System          | **P0**   |

### AUTH-007 — User Management (Owner)

**Epic:** AUTH-000 — Authentication & User Management
**Priority:** P1

> **As an** Owner,
> **I want to** view, edit, and remove team members,
> **So that** I can keep access control up to date as the team changes.

**Acceptance Criteria:**

#### Team List

- [ ] **Settings → Team** displays a table of all active users: name, email, role, date joined.
- [ ] Pending invitations are listed separately with their status and expiry date.

#### Edit Role

- [ ] Owner can change the role of any user (except other Owners).
- [ ] Role change takes effect immediately — the user's next request reflects the updated permissions.
- [ ] Changing a role does not invalidate the user's current session.

#### Remove User

- [ ] Owner can remove any user (except themselves).
- [ ] Removed user loses access immediately on their next request.
- [ ] A confirmation dialog is shown before removal: _"Are you sure you want to remove [name]?"_.
- [ ] Removed user receives an email notifying them their access has been revoked.

**Constraints:**

- The Owner role cannot be changed or removed from the UI.
- A user cannot remove themselves.
- Member and Viewer roles do not have access to **Settings → Team**.

**Out of Scope:**

- Transferring ownership to another user (requires manual DB change).
- Audit log of role changes (Phase 3).
