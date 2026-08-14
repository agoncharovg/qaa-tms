# Brief 14 — qaa-generator Admin tab (users & tokens, admin-only)

Add a fourth tab **Admin** to the `qaa-generator` plugin (from brief 13) that
lets an **app administrator** manage qaa-generator's own **users and API/service
tokens**. These map to qaa-generator's **superuser-only** endpoints
(`/api/v1/users`, `/api/v1/service-tokens`). The tab is hidden from non-admins
and its backend routes require an app admin.

This brief is **purely additive** on top of brief 13: it reuses the same plugin
folder, the same backend httpx client and settings, and the same proxy module.
Do **not** start it until brief 13 has landed.

Read FIRST:
- `briefs/13-qaa-generator-runs.md` — the plugin + backend proxy this extends.
- qaa-generator admin API: `POST/GET /api/v1/users`, `GET /users/{id}`,
  `POST /users/{id}/tokens/regenerate`, `POST /service-tokens`,
  `POST /service-tokens/{id}/revoke` — all require a **superuser** bearer token;
  `403` otherwise. Create/regenerate return the **plaintext token exactly once**.
- App admin gating template: `frontend/src/plugins/admin/UsersPage.tsx`,
  `backend/app/api/v1/users.py` (uses `_: AdminUser` dependency),
  `backend/app/api/deps.py` (`AdminUser`).
- `discuss/06` §1 (trust) — the superuser token stays server-side.
- `CONVENTIONS.md` + brief 09 — enumerate literals.

---

## Trust & token model (read before coding)

- qaa-generator admin endpoints need a **superuser** token, which is stronger
  than the run-level service token from brief 13. Add a distinct setting
  `QAA_GENERATOR_SUPERUSER_TOKEN` (`EnvKey`) so admin calls use it explicitly; if
  empty, **admin routes return a clear 501/"not configured"** rather than
  silently using the run token. Never expose either token to the browser.
- Double gate: the app requires `AdminUser` (our `is_admin`) on every admin
  route, AND qaa-generator requires the superuser token — a non-admin app user
  can never reach these routes, and even a mis-call fails outward auth.
- **Plaintext tokens are shown once.** The backend returns the qaa-generator
  plaintext token in the create/regenerate response; the SPA displays it in a
  copy-once panel with a warning and NEVER persists it (no store, no query
  cache retention beyond the modal). Treat as sensitive per project norms.

---

## Hard scope rules
- **In scope:** admin-only backend routes proxying qaa-generator user/token
  management; a new `AdminPanel.tsx` tab in the existing `qaa-generator` plugin;
  constants; tests; docs.
- **OUT of scope:** changing the run tabs from brief 13; app-side user admin
  (that's the existing Administration plugin); MCP/A2A; deleting qaa-generator
  users (API has no delete — do not invent one); storing generator tokens in our
  DB.
- English-only UI, dark theme, Mantine, enumerated constants, admin-only.

---

## Part A — Backend

**A1.** `backend/app/core/constants.py`: `EnvKey` add
`QAA_GENERATOR_SUPERUSER_TOKEN`. `RoutePath` add
`QAA_ADMIN_USERS = "/qaa/admin/users"`,
`QAA_ADMIN_SERVICE_TOKENS = "/qaa/admin/service-tokens"` and the id/sub-path
suffixes (`REGENERATE = "/tokens/regenerate"`, `REVOKE = "/revoke"`).
`backend/app/core/config.py`: add `qaa_generator_superuser_token: str = ""`;
add to `.env.example`.

**A2.** New routes (either in `qaa_generator.py` or a sibling
`qaa_generator_admin.py`), all requiring `_: AdminUser` (403 for non-admin app
users). Build outward headers with the **superuser** token (extend the Part B
helper from brief 13 to accept which token to use; if superuser token empty →
`HTTPException(501, "qaa-generator superuser token not configured")`).
- `GET  <QAA_ADMIN_USERS>` → list/lookup users (`?email=` / `?slack_user_id=` /
  paged). Pass through.
- `POST <QAA_ADMIN_USERS>` → create user (body `{email?, slack_user_id?, name?,
  description?}`); return the `{user, token}` (plaintext token) verbatim.
- `GET  <QAA_ADMIN_USERS>/{user_id}` → user record.
- `POST <QAA_ADMIN_USERS>/{user_id}/tokens/regenerate` → `{token}`.
- `POST <QAA_ADMIN_SERVICE_TOKENS>` → create service token `{name}` → `{user,
  token}`.
- `POST <QAA_ADMIN_SERVICE_TOKENS>/{token_id}/revoke` → `{revoked: true}`.
Map qaa-generator `403` → `502`/`403` with a clear message ("superuser token
rejected by qaa-generator"); pass `404` through.

**A3.** Schemas (`backend/app/schemas/qaa_generator.py`): `QaaUserCreateRequest`
(≥1 identifier — validate), `QaaServiceTokenCreateRequest {name}`; responses may
be pass-through dicts. Do NOT log plaintext tokens in the `operations` audit or
anywhere; you MAY audit the *action* (user created / token regenerated) without
the secret.

## Part B — Frontend

**B1.** `frontend/src/constants.ts`: add `ViewKey.QAA_ADMIN`,
`TabId.QAA_ADMIN = "tab-qaa-admin"`, `TabTitle` entry `"Admin"`; `BackendPath`
`QAA_ADMIN_USERS: "/api/v1/qaa/admin/users"`,
`QAA_ADMIN_SERVICE_TOKENS: "/api/v1/qaa/admin/service-tokens"` + builders
(`buildBackendQaaUserPath`, `buildBackendQaaUserRegeneratePath`,
`buildBackendQaaServiceTokenRevokePath`); `QueryKey.QAA_USERS`.

**B2.** `frontend/src/api/backendClient.ts` + `types.ts`: `listQaaUsers`,
`createQaaUser`, `getQaaUser`, `regenerateQaaUserToken`, `createQaaServiceToken`,
`revokeQaaServiceToken` (token passed as the app JWT, as usual).

**B3.** Manifest: add a 4th tab to `frontend/src/plugins/qaa-generator/
manifest.tsx` with `adminOnly: true`, `viewKey: ViewKey.QAA_ADMIN`,
`element: <QaaGeneratorSection mode={ViewKey.QAA_ADMIN}/>`. Keep it **last** so
the plugin's first tab stays non-admin (contract validation).

**B4.** `QaaGeneratorSection.tsx`: dispatch `ViewKey.QAA_ADMIN → <AdminPanel/>`.
`AdminPanel.tsx` (template: `plugins/admin/UsersPage.tsx`): a users table with
lookup (email / slack id), a "Create user" form, "Regenerate token" action, and
a service-tokens section (create/revoke). Every create/regenerate opens a
**copy-once modal** showing the plaintext token with a warning that it will not
be shown again; nothing persists it.

**B5.** Visibility: the tab must be hidden for non-admins. Verify the shell
already filters `adminOnly` tabs by `currentUser.is_admin` (the Administration
plugin's `Plugins`/`Users` tabs prove the mechanism). If tab-level `adminOnly`
is not yet enforced in the tab bar/workspace, enforce it (and test it) — a
non-admin must neither see the Admin tab nor be able to route to its viewKey.

## Part C — Tests
- Backend `test_qaa_generator_admin.py`: non-admin app user → 403 on every admin
  route; admin user → outward call carries the **superuser** token; empty
  superuser token → 501; create/regenerate relay the plaintext token; nothing
  secret written to `operations`.
- Frontend `AdminPanel.test.tsx`: admin sees the tab and can create a user /
  see the copy-once token; a non-admin (`is_admin:false` in `useAuthStore`) does
  NOT see the Admin tab and cannot render the panel.

## Part D — Docs
Document `QAA_GENERATOR_SUPERUSER_TOKEN`, the admin-only tab, and the
"plaintext token shown once, never persisted" rule in `backend/.env.example`
comments + `frontend/README.md`.

---

## Gates (all must pass)
- Frontend: `cd frontend && npm run lint && npx tsc --noEmit && npm run test && npm run build`
- Backend: `cd backend && ruff check . && ruff format --check . && mypy app && pytest`
- Agent (unchanged): `cd agent && ruff check . && ruff format --check . && mypy app && pytest`

## Acceptance criteria
1. `qaa-generator` plugin gains an **Admin** tab, last in order, `adminOnly:true`;
   hidden for non-admins (tab not shown, viewKey unroutable).
2. Admin can list/lookup/create qaa-generator users, regenerate user tokens, and
   create/revoke service tokens — all via admin-gated backend routes using the
   superuser token, which never reaches the browser.
3. Plaintext tokens appear only in a copy-once modal and are never persisted or
   audited as secrets.
4. Missing superuser token → clear 501; qaa-generator 403 → clear surfaced error.
5. Stagings/Admin plugins and brief-13 run tabs unchanged; all three gate suites
   green; docs updated.

## Out of scope
- App-side user admin (existing Administration plugin). User deletion (no API).
  Storing generator tokens in our DB. MCP/A2A.

When done, ensure all three gate suites pass, then stop. Do not commit — the
reviewer inspects `git diff` and commits.
