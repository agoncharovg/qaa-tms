# Brief 28 — Security RBAC: matrix administration UI

Follow `CONVENTIONS.md` exactly (StrEnum / TS union-literal constants,
English-only UI text, 12-factor config, no committed secrets, API under
`/api/v1`, backend `ruff` + `mypy`, frontend `eslint` + `tsc --noEmit` clean).

**New branch from `master`.** The current `feat/security-management-rbac` branch
was exploratory and is discarded. Do **not** merge or cherry-pick it wholesale —
port only the specific items listed in § Source material below.

---

## Goal

Introduce a clear, self-explanatory role-based access control system for
QAA-TMS. The design criterion: an administrator looking at the security UI for
the first time must understand what every user can do, why, and how to change
it — without reading any documentation.

The reference UX is the Jenkins Global Security matrix: one table, one row per
user, checkboxes for each permission. Jenkins shows groups and users as separate
rows (requiring mental OR); this implementation shows each user as a single row
of **effective** permissions, decomposed into inherited (role + group) and
individual additions.

---

## Authorization model — Model A (additive overrides only)

### Core rule

```
effective_permissions(user) =
    role.permissions          -- from user.role_id
    ∪ group.permissions       -- from user.group_id
    ∪ user_extra_permissions  -- individual additions only
```

- Inherited permissions (from role or group) are **read-only** per user.
  They cannot be removed at the individual level.
- Individual additions are **additive only**: they extend the inherited set,
  never restrict it.
- To remove a permission from a user, change their role, change their group,
  or edit the role/group permission set itself.

### Propagation

- Changing a role's permission set immediately affects every user who holds
  that role.
- Changing a group's permission set immediately affects every member of that
  group.
- These changes are computed at query time, not cached in a denormalized column.

### One role, one group per user

A user has at most one role and at most one group (nullable FKs on `users`).
Multiple-binding complexity is out of scope for this scale (10–15 users).

---

## Part A — Data model

### A1. Changes to `users` table

Add two nullable foreign key columns:

```
users.role_id   INTEGER REFERENCES security_roles(id) ON DELETE SET NULL
users.group_id  INTEGER REFERENCES security_groups(id) ON DELETE SET NULL
```

Keep all existing columns unchanged (`is_admin`, `session_version`,
`enabled_plugins`, etc.).

### A2. New table: `user_extra_permissions`

```sql
CREATE TABLE user_extra_permissions (
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission_id INTEGER NOT NULL REFERENCES security_permissions(id) ON DELETE CASCADE,
    granted_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, permission_id)
);
```

No `scope_kind` / `scope_value` — individual additions are always global.

### A3. Keep from current branch (port verbatim)

Port these tables and their Alembic migrations with no structural changes:

- `security_permissions` — permission catalog
- `security_roles` — role definitions
- `security_role_permissions` — role ↔ permission junction
- `security_groups` — group definitions
- `security_group_memberships` — group ↔ user junction (keep many-to-many at
  DB level but the UI will only show the user's **primary** group via
  `users.group_id`; memberships can stay as the backing store for group_id)
- `security_events` — audit trail
- `auth_login_events` — login telemetry

### A4. Drop (do not port)

- `security_bindings` — do not create this table in the new branch.
  The concept is eliminated.

### A5. Migration order

Write a single Alembic migration file per logical step:

1. Auth hardening (`session_version`, `auth_login_events`) — port from old
   branch migration `20260822_0010`.
2. Core RBAC tables (`security_permissions`, `security_roles`,
   `security_role_permissions`, `security_groups`, `security_group_memberships`,
   `security_events`) — port structure from old branch migration `20260822_0011`,
   omitting `security_bindings`.
3. User role/group assignment: add `role_id`, `group_id` to `users`.
4. Individual additions: create `user_extra_permissions`.

Each migration must be independently reversible.

---

## Part B — Permission and role catalog

### B1. Permission keys

Port `PermissionKey` StrEnum from the old branch unchanged:

```
security.read, security.roles.read, security.roles.manage,
security.groups.read, security.groups.manage,
security.audit.read,
users.read, users.manage,
profile.self.read, profile.self.manage,
server_settings.read, server_settings.manage,
operations.read_own, operations.read_all,
jenkins.read, jenkins.freeze, jenkins.resume,
statistics.read,
stagings.read, stagings.deploy, stagings.destroy, stagings.sync,
stagings.e2e_run, stagings.credentials.read,
kuber.read, kuber.use_context, kuber.delete_pod,
qaa.read, qaa.run, qaa.admin,
leonid.read, leonid.write
```

### B2. Seeded roles

Port seeded role definitions from the old branch unchanged:

| Role | Key permissions |
|---|---|
| `superadmin` | all permissions, immutable |
| `administrator` | security + users + server_settings + operations.read_all + jenkins + qaa.admin |
| `engineer` | profile.self + operations.read_own + jenkins.read + statistics + stagings + kuber + qaa |
| `viewer` | jenkins.read + statistics.read |

### B3. Seed script

The seed script (`backend/app/db/seed.py`) must be idempotent: running it
twice produces no duplicate rows. On startup (`lifespan`), call seed before
the app begins serving.

Seed order:
1. Permissions
2. Roles + role-permission associations
3. Assign `superadmin` role to any `is_admin=True` user that has no `role_id`
   yet (one-time legacy bridge, not a permanent bridge).

---

## Part C — Authorization service

### C1. Implementation

File: `backend/app/services/authorization.py`

Replace the binding-based resolution with the simplified model:

```python
async def resolve_permissions(user: User, db: AsyncSession) -> frozenset[PermissionKey]:
    perms: set[PermissionKey] = set()

    if user.role_id:
        # load role permissions
        ...
    if user.group_id:
        # load group permissions
        ...
    # load user_extra_permissions
    ...
    return frozenset(perms)
```

Keep the public helpers:

```python
async def has_permission(
    user: User,
    permission: PermissionKey,
    db: AsyncSession,
) -> bool: ...

async def require_permission(
    user: User,
    permission: PermissionKey,
    db: AsyncSession,
) -> None:  # raises HTTP 403 if denied
```

### C2. Legacy admin bridge

Keep as a one-liner fallback **only** in `require_permission`:

```python
if user.is_admin:
    return  # legacy superadmin
```

This bridge is removable in one line once explicit role assignments are seeded.
Do **not** scatter `or user.is_admin` elsewhere.

### C3. No scope complexity in v1

Drop `scope_kind` / `scope_value` from permission resolution in this branch.
All permissions are evaluated globally. Scoped permissions are out of scope
for v1 and must not appear in the simplified authorization service.

### C4. `/api/v1/authz/check` endpoint

Keep the authz check endpoint for agent use (port from old branch). Simplify
the response to use the scope-free resolution above.

---

## Part D — Backend API

### D1. Users API

`PATCH /api/v1/users/{user_id}` — extend to accept:

```json
{
  "role_id": 2,
  "group_id": 1
}
```

Setting `role_id` or `group_id` to `null` clears the assignment.
Write a `security_events` record on each change.

### D2. Individual permission management

```
GET  /api/v1/users/{user_id}/permissions
     → { inherited: PermissionKey[], extra: PermissionKey[], effective: PermissionKey[] }

POST /api/v1/users/{user_id}/permissions
     Body: { permission_key: PermissionKey }
     → adds to user_extra_permissions (idempotent)

DELETE /api/v1/users/{user_id}/permissions/{permission_key}
     → removes from user_extra_permissions only
     → 409 if the permission is inherited (cannot restrict inherited)
```

Guard: `users.manage` for write operations, `users.read` for GET.

### D3. Security admin routes

Keep these from old branch (port verbatim, adjust imports):

```
GET    /api/v1/security/permissions
GET    /api/v1/security/roles
POST   /api/v1/security/roles
GET    /api/v1/security/roles/{role_id}
PATCH  /api/v1/security/roles/{role_id}
DELETE /api/v1/security/roles/{role_id}
GET    /api/v1/security/groups
POST   /api/v1/security/groups
GET    /api/v1/security/groups/{group_id}
PATCH  /api/v1/security/groups/{group_id}
DELETE /api/v1/security/groups/{group_id}
PUT    /api/v1/security/groups/{group_id}/members
GET    /api/v1/security/audit
```

**Drop** all binding routes (`/api/v1/security/bindings`). They do not exist
in this branch.

### D4. `/api/v1/me` response

Include in the bootstrap response:

```json
{
  "role": { "id": 2, "key": "engineer", "display_name": "Engineer" },
  "group": { "id": 1, "key": "qa-engineers", "display_name": "QA Engineers" },
  "effective_permissions": ["jenkins.read", "statistics.read", "..."]
}
```

Keep `available_plugins` and `security_summary` from the old branch.

### D5. Route protection

Port route-level `require_permission(...)` guards from the old branch for:
- `/api/v1/users*`
- `/api/v1/settings*`
- `/api/v1/jenkins/freezes`
- `/api/v1/jenkins/resume-runs`
- `/api/v1/operations`
- `/api/v1/security/*`
- `/api/v1/qaa*` (admin routes)

---

## Part E — Agent integration

Port agent permission checks from the old branch unchanged:

- `jenkins.freeze` checked before freeze route
- `jenkins.resume` checked before resume route
- `kuber.*` checked before kube mutate routes
- `stagings.*` checked before staging action routes
- Check method: `POST /api/v1/authz/check` against backend (option 1 from
  brief 27, no change)

---

## Part F — Frontend

### F1. Layout

Administration plugin gains a `Security` tab (or rename existing tabs).
The tab structure:

```
Administration
  └─ Security
       ├─ Users      (default view)
       ├─ Roles
       ├─ Groups
       └─ Audit
```

Remove separate `BindingsPage.tsx`. Remove `GroupsPage.tsx` as a standalone
page — it is now a tab within Security. The existing `UsersPage.tsx` is
rewritten (not extended).

### F2. Users tab — matrix table

The primary view. Each row is one user. Columns:

```
Username | Display name | Group (dropdown) | Role (dropdown) | [permission columns...]
```

Permission columns are grouped by domain:

| Domain | Permissions shown |
|---|---|
| Security | security.read, security.roles.manage, security.groups.manage, security.audit.read |
| Users | users.read, users.manage |
| Jenkins | jenkins.read, jenkins.freeze, jenkins.resume |
| Stagings | stagings.read, stagings.deploy, stagings.destroy, stagings.sync, stagings.e2e_run |
| Kuber | kuber.read, kuber.use_context, kuber.delete_pod |
| QAA | qaa.read, qaa.run, qaa.admin |
| Other | statistics.read, leonid.read, leonid.write |

Column headers are rotated 45° (same pattern as Jenkins screenshot) to fit
many columns in limited horizontal space.

**Cell rendering rules:**

| State | Visual |
|---|---|
| Inherited from role | Checkbox checked, disabled, tooltip "From role: engineer" |
| Inherited from group | Checkbox checked, disabled, tooltip "From group: qa-engineers" |
| Individual addition | Checkbox checked, enabled (click → DELETE /permissions/key) |
| Not granted | Checkbox unchecked, enabled (click → POST /permissions) |

A cell that is inherited shows a distinct color (e.g. muted blue) vs individual
addition (solid blue), so the admin can distinguish inherited from explicit.

**Inline editing:**

- Group and Role columns are `<select>` dropdowns, not separate pages.
  Changing the value immediately calls `PATCH /users/{id}` and refreshes the
  row. No save button for those fields.
- Permission checkbox toggle is immediate (no confirmation for additions;
  individual removals are instant too).
- Inherited checkboxes are `disabled` — no pointer interaction.

### F3. Roles tab

List of roles. Each role row expands (accordion or click → side panel) to show:

- Display name, system/custom badge
- Editable permission checkboxes (for custom roles only; system roles are
  read-only)
- Count of users currently holding this role

### F4. Groups tab

List of groups. Each group row expands to show:

- Display name
- Editable permission checkboxes
- Member list: add / remove users

### F5. Audit tab

Paginated table of `security_events`:
- Timestamp, actor, event type, target, payload summary
- No filtering required in v1

### F6. Permissions the frontend must check

Show the Security tab only when the current user has `security.read`.
Show edit controls only when the user has `users.manage` (matrix) or
`security.roles.manage` / `security.groups.manage` (respective tabs).

Use `effective_permissions` from `/me` response for frontend gating — do not
call a separate authz endpoint from the browser.

---

## Part G — Auth hardening (port from old branch)

Port these items unchanged from `feat/security-management-rbac`:

- Password hashing: `argon2` replacing `sha256$`, with backward-compatible
  upgrade on successful login.
- `session_version` column on `users`; embedded as `sv` in JWTs; rejected on
  mismatch.
- `auth_login_events` written on success and failure.
- Login rate limiting on `POST /api/v1/auth/login`.
- Production guard: reject empty `SECRET_KEY` outside dev; warn on empty
  passwords outside dev mode.

---

## Part H — Source material from old branch

| Item | Action |
|---|---|
| `backend/app/core/constants.py` PermissionKey StrEnum | Port verbatim |
| `backend/app/core/security.py` argon2 hashing | Port verbatim |
| `backend/app/api/v1/auth.py` rate limiting + login events | Port verbatim |
| `backend/app/services/authorization.py` PERMISSION_SEEDS, ROLE_SEEDS | Port seed data; rewrite resolution logic |
| `backend/app/services/security_audit.py` | Port verbatim |
| `backend/app/api/v1/security.py` routes (minus binding routes) | Port, adjust for new model |
| `backend/app/api/v1/jenkins.py` permission guards | Port verbatim |
| `backend/app/api/v1/jenkins_freeze.py` permission guards | Port verbatim |
| `backend/app/api/v1/jenkins_resume_run.py` permission guards | Port verbatim |
| `backend/app/api/v1/settings.py` permission guards | Port verbatim |
| `backend/app/api/v1/operations.py` permission guards | Port verbatim |
| `agent/app/api/routes.py` authz checks | Port verbatim |
| `backend/tests/test_authorization.py` | Port, update for new resolution model |
| `backend/tests/test_security_admin.py` | Port, remove binding tests |
| alembic migrations `0010`, `0011` (minus bindings table) | Port structure, rewrite DDL |
| `frontend/src/plugins/admin/AuditPage.tsx` | Port verbatim |
| `frontend/src/plugins/admin/RolesPage.tsx` | Port with minor adjustments |
| `frontend/src/plugins/admin/UsersPage.tsx` | **Rewrite** (matrix UI) |
| `frontend/src/plugins/admin/GroupsPage.tsx` | **Rewrite** (tab inside Security) |
| `frontend/src/plugins/admin/BindingsPage.tsx` | **Delete** |

---

## Part I — Implementation order

Complete phases in order. Each phase must pass `ruff`, `mypy`, `pytest`,
`eslint`, `tsc --noEmit`, and `vitest` before starting the next.

### Phase 0 — Auth hardening

Port auth hardening items (§ G) with no RBAC changes. Existing tests must
pass unchanged.

### Phase 1 — Schema + seeds

- Port RBAC tables (§ A3), omitting `security_bindings`.
- Add `role_id`, `group_id` to `users` (§ A1).
- Add `user_extra_permissions` (§ A2).
- Write seed script (§ B3).
- Write authorization service (§ C).
- Write `GET /users/{id}/permissions` and permission management endpoints (§ D2).
- No UI yet.

Tests: permission resolution (direct role, direct group, individual addition,
effective union), legacy bridge, seed idempotency.

### Phase 2 — Backend route migration

- Apply `require_permission(...)` guards to all routes listed in § D5.
- Extend `PATCH /users/{id}` to accept `role_id` / `group_id`.
- Extend `/me` response (§ D4).
- Port security admin routes (§ D3).

Tests: allow/deny for each protected route family.

### Phase 3 — Agent enforcement

Port agent authz checks (§ E). Verify that denied permission blocks execution.

### Phase 4 — Frontend matrix

Implement the matrix UI (§ F). Start with the Users tab (matrix), then Roles,
Groups, Audit.

Tests: matrix renders inherited vs individual cells correctly; role/group
dropdown change fires correct PATCH; permission toggle fires correct
POST/DELETE; inherited checkboxes are disabled.

---

## Acceptance criteria

1. The Users tab shows every user in one table with their effective permissions
   visually decomposed into inherited and individual additions.
2. An admin can assign or change a user's role and group inline in the table
   without navigating to another page.
3. An admin can add an individual permission to a user by clicking an unchecked
   cell; clicking an individually-added permission removes it; inherited
   permissions cannot be unchecked.
4. Changing a role's or group's permission set immediately affects all users
   in the matrix on next load.
5. All high-risk backend routes (users, settings, Jenkins freeze/resume, qaa
   admin, security admin) reject requests without the required permission.
6. The agent validates permission before executing privileged local actions.
7. Every security administration change (role/group edit, individual permission
   add/remove, user role/group assignment) writes a `security_events` record.
8. `ruff`, `mypy`, `pytest`, `eslint`, `tsc --noEmit`, `vitest` all pass on
   the final branch.

## Out of scope

- Scoped permissions (jenkins_path, namespace) — global only in this branch.
- Multiple roles per user.
- Multiple groups per user (DB supports it; UI shows primary group via
  `users.group_id` only).
- Explicit deny rules.
- Real OIDC/SSO.
- Role cloning, bulk import.
- Removal of `is_admin` column (bridge stays for one more branch).
