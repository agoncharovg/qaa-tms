# Brief 08 — User administration (admin CRUD over users)

You implement the FIFTH functional slice: real **user administration** — the
admin-only surface to list, create, edit, and delete TMS users. This closes the
founding requirement from `discuss/02` (answers) and `discuss/03 §7`: *"Сразу
закладываем меню с администрированием пользователей … пользователь имеет флаг,
позволяющий дать доступ к странице(ам) администрирования."* Slice 02 laid in the
**menu + admin gating** and a placeholder page; this slice makes it work.

This is **full-stack** (backend + frontend). NOTE: unlike slices 04–07 (all
"no backend change"), this slice **does change `backend/`** — that is expected
and in scope. Read `CONVENTIONS.md`, `discuss/02` (answers block), `discuss/03 §7`,
and the files named below (source of truth) FIRST.

## Ground truth (READ THIS — it drives the design)
The data model already supports everything; **no DB schema change and no new
Alembic migration are needed**:
- `backend/app/models/user.py` — `User` has `id`, `username` (unique),
  `password_hash` (nullable — empty password allowed), `display_name`,
  `is_admin`, `auto_login`, `created_at`, `updated_at`, and an `operations`
  relationship.
- `Operation.user_id` is a **non-nullable** FK to `users.id`
  (`backend/app/models/operation.py`). Deleting a user who owns operations would
  break the audit trail / violate the FK — the delete rule below handles this.
- Auth/attribution: the JWT `sub` claim is the **username**
  (`backend/app/core/security.py`, `deps.py`). Treat `username` as **immutable**
  in this slice — renaming it would invalidate that user's live tokens and is out
  of scope.
- Password hashing: reuse `app/core/security.py::hash_password` /
  `verify_password`. Empty password is a valid dev credential (mirrors the seeded
  `test` user) — allow it.
- Existing patterns to mirror: `backend/app/api/v1/operations.py` (router,
  `CurrentUser`, admin-vs-owner gating, pagination, `HTTPException` detail style),
  `backend/app/api/deps.py` (`get_current_user` / `CurrentUser`),
  `backend/app/schemas/user.py` (`UserRead`), `backend/app/db/seed.py`.

## Hard scope rules
- Admin-only surface. Every new endpoint requires an **admin** caller; a
  non-admin authenticated user gets **403** (not the 404-hiding trick operations
  use — this is an explicit admin area). `/me` stays available to everyone and
  is UNCHANGED.
- `username` is immutable (see above). Do NOT add rename.
- Do NOT touch `agent/`. Do NOT add real OIDC / SSO — the auth stub stays.
- `UserRead` must never expose `password_hash` (it already doesn't — keep it that
  way; the create/update request carries a plaintext `password`, the response
  never returns any hash).

## Part A — Backend (`backend/`)
Extend the existing users router (`backend/app/api/v1/users.py`) with an
admin CRUD group under `/api/v1/users`. Keep `GET /me` where it is.

**Admin dependency (`app/api/deps.py`):** add a `get_current_admin` dependency
(built on `get_current_user`) that raises `403` when `not current_user.is_admin`,
and an `AdminUser = Annotated[User, Depends(get_current_admin)]` alias mirroring
`CurrentUser`.

**Endpoints** (all Bearer-guarded; all require `AdminUser` except `/me`):
- `GET /api/v1/users` → `UserListResponse { items: UserRead[], total: int }`.
  Simple list (the user base is ~10–15 per project constraints), ordered by `id`.
  Pagination is OPTIONAL — if you add `limit`/`offset`, mirror the operations
  query conventions; otherwise return all. Keep it consistent with the codebase.
- `POST /api/v1/users` → `UserRead` (201). Body `UserCreateRequest
  { username, password, display_name, is_admin?=False, auto_login?=False }`.
  Hash the password (empty allowed → store the empty-password hash form consistent
  with `verify_password`; match how `seed.py` handles the `test` user). Duplicate
  `username` → **409**.
- `GET /api/v1/users/{id}` → `UserRead`. Unknown id → **404**.
- `PATCH /api/v1/users/{id}` → `UserRead`. Body `UserUpdateRequest` with ALL
  fields optional: `display_name?`, `is_admin?`, `auto_login?`, `password?`
  (a non-null `password` resets it; hash it; empty string is a valid reset to
  empty password). Unknown id → 404.
- `DELETE /api/v1/users/{id}` → 204. Unknown id → 404.

**Guardrails (MUST enforce server-side — these prevent lockout & broken audit):**
1. **No self-demote / self-delete:** the acting admin cannot delete their own
   account nor set their own `is_admin=false` → **409** with a clear message.
2. **No last-admin removal:** deleting an admin, or demoting an admin via PATCH,
   is rejected when they are the **only** remaining admin → **409**. (Count
   admins; block if it would reach zero.)
3. **No delete of a user with operations:** if the target owns ≥1 `Operation`,
   refuse the delete → **409** ("user has recorded operations; audit history must
   be preserved"). This respects the non-null FK and the audit intent of
   `discuss/04 §9`. (Editing such a user is still fine.)

**Schemas (`backend/app/schemas/user.py`):** add `UserCreateRequest`,
`UserUpdateRequest` (all-optional), and `UserListResponse`. `UserRead` is reused
as-is. Follow the existing `ConfigDict`/typing style; `is_admin`/`auto_login`
default sensibly. No `password_hash` on any response.

**Constants (`backend/app/core/constants.py`):** add `RoutePath.USERS = "/users"`
(and a `USER_BY_ID` segment/builder if you introduce one). `ApiTag.USERS` already
exists — reuse it. Free-text `HTTPException` detail strings stay inline in English
as the existing routes do (they are not enumerated values).

**Backend tests** (`backend/tests/`, mirroring `test_operations.py` +
`conftest.py`): 
- non-admin (`test` user) → **403** on every `/users` admin endpoint; admin →
  200/201.
- create: happy path returns `UserRead` (no hash leaked); duplicate username →
  409; a user created with a password can then `POST /auth/login` successfully
  (round-trip through `verify_password`).
- patch: promote a user to admin and demote back; a `password` reset lets the
  user log in with the new password and rejects the old one; `username` cannot be
  changed (field absent from the update schema).
- guardrails: self-delete → 409; self-demote → 409; demoting/deleting the last
  admin → 409; deleting a user that owns an operation → 409; deleting a
  no-operations user → 204 and it disappears from the list.

## Part B — Frontend (`frontend/`)
Replace the `UsersPage` stub (`frontend/src/features/admin/UsersPage.tsx`) with a
real management screen. The route is already admin-gated (`RequireAdmin` in
`app/guards.tsx`) and the sidebar item already shows only for admins — do NOT
re-implement gating; build the CRUD UI.

- **`src/api/backendClient.ts`:** add `listUsers`, `createUser`, `updateUser`,
  `deleteUser`, `getUser` — thin methods over the existing `request<T>` helper
  (Bearer added automatically as today; match the existing method/body style).
- **`src/api/types.ts`:** reuse the existing `User` type for reads; add
  `UserCreateRequest`, `UserUpdateRequest`, `UserListResponse`. Wire fields to the
  backend schemas (snake_case on the wire, as the rest of the backend client does).
- **`src/constants.ts`:** add `BackendPath.USERS = "/api/v1/users"` and a
  `buildBackendUserPath(id)` builder next to `buildBackendOperationPath`; add
  `QueryKey.USERS`. No stray literals — string-literal unions / `as const`.
- **UI (`UsersPage`, Mantine, dark theme):**
  - TanStack Query `GET /api/v1/users` → a table: username, display name, admin,
    auto-login, created. Empty/loading/error states.
  - **Create** (button → modal/form): username, display name, password,
    is_admin, auto_login → `createUser` mutation → invalidate `QueryKey.USERS`.
  - **Edit** (per row → modal): display name, is_admin toggle, auto_login toggle,
    optional "reset password" field (blank = leave unchanged; note that submitting
    an explicit empty string is an intentional empty-password reset). username
    shown read-only. → `updateUser` → invalidate.
  - **Delete** (per row, destructive → explicit confirmation, like the destroy
    flow in brief 06) → `deleteUser` → invalidate.
  - Surface the backend guardrails as UX: disable/confirm self-delete &
    self-demote (compare against `authStore.currentUser`), and render the server's
    **409** messages (last-admin, has-operations) as a clear error notification
    rather than a crash. Backend remains the source of truth; the UI just mirrors
    it and shows the reason.
  - If the edited/deleted user is the current user (e.g. self display-name change),
    keep `authStore.currentUser` coherent — re-fetch `/me` or update the store
    after a successful self-edit. Do NOT let the admin lock themselves out.

**Frontend tests** (Vitest + RTL, mock `fetch`; no live backend):
- `backendClient.listUsers/createUser/updateUser/deleteUser` send the correct
  method, path, JSON body, and Bearer header; parse the wire shapes.
- `UsersPage` renders rows from a mocked list; opening Create and submitting calls
  `createUser` with the exact body and invalidates the list; Edit sends the exact
  `UserUpdateRequest`; Delete gates behind confirmation (no call until confirmed)
  and a mocked 409 renders its message instead of crashing.
- self-row delete/demote is disabled/guarded against `currentUser`.

## Acceptance criteria (must all hold)
1. Backend exposes admin-only `GET/POST /api/v1/users`, `GET/PATCH/DELETE
   /api/v1/users/{id}`; non-admin → 403; `/me` unchanged; no `password_hash` on
   any response. `username` is immutable. No new migration (schema already
   supports it).
2. Server-side guardrails enforced: no self-demote/self-delete, no last-admin
   removal, no delete of a user with operations — each → 409 with a clear message.
3. Frontend Administration → Users lists real users and supports create / edit
   (incl. admin & auto-login toggles and password reset) / delete (behind
   confirmation); 409 guardrail responses render as clear errors, not crashes; the
   acting admin cannot lock themselves out, and `currentUser` stays coherent after
   a self-edit.
4. Backend: `ruff`, `mypy`, `pytest` clean (with the tests above; existing tests
   still green). Frontend: `npm run build`, `tsc --noEmit`, `eslint`, `vitest`
   clean (with the tests above). English-only UI; dark theme; enumerated strings
   in `backend/app/core/constants.py` / `frontend/src/constants.ts`.
5. `backend/README.md` and `frontend/README.md` updated with the user-admin
   endpoints and screen; note there are no new env vars.

## Out of scope (do NOT do)
- Any `agent/` change. Real OIDC / SSO / password policies / email — the auth
  stub stays.
- `username` rename; per-user granular permissions beyond the existing `is_admin`
  flag; soft-delete / user deactivation (hard delete + the operations guardrail is
  the model for this slice).
- The companion-app shell / iframe browser (requirement #5), `grafana-creds`,
  `setup` — separate slices.

When done, ensure the backend (`ruff`/`mypy`/`pytest`) and the frontend
(`npm install`, `npm run build`, `tsc --noEmit`, `eslint`, `vitest`) all succeed,
then stop. Do not commit — the reviewer inspects `git diff` and commits.
