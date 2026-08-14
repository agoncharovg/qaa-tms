# Brief 19 — qaa-generator Admin: split Users / Services into sub-tabs, make Services a real table

## Goal

Rework the qaa-generator **Admin** panel so that **Users** and **Services** are two
separate **sub-tabs** on the same page (not two stacked sections), and **Services
becomes a proper table** just like Users — with per-row actions and a Create
modal — instead of the current free-text "register by name / revoke by token id"
form. Leave the sub-tab structure easy to extend (we will likely add more tabs).

This is **frontend-first**; it depends on a small upstream capability that is
**already deployed** (see below). One tiny backend-proxy passthrough is required.

## Why (what's wrong today)

`frontend/src/plugins/qaa-generator/AdminPanel.tsx` renders, inside one `<Stack>`:
a clean Mantine **Users** table (lines ~523–591) followed by a bare **Services**
block (lines ~604–636) = two `TextInput`+`Button` rows ("Service name → Register",
"Token id → Revoke service token"). That Services UI is unusable and inconsistent:
the token id needed for revoke was previously **not obtainable** anywhere, and it
looks nothing like the Users table.

## Data model you MUST understand first (grounds everything)

In qaa-generator a **"service" is not a separate entity** — it is the same
`gen_users` subject row as a user, distinguished only by the **kind of its active
(non-revoked) token** (`token_kind` = `user` | `service` | `superuser`).
`POST /service-tokens` = create a subject by `name` + issue a **service**-kind token.

Upstream `GET /users` was extended (qaa-generator **1.2.2**, already live in prod
clusters `qaa-ed-prod` and `qaa-frn-prod`, verified) with an optional filter:

- `GET /users?kind=user` → only subjects whose active token kind is `user`.
- `GET /users?kind=service` → only subjects whose active token kind is `service`.
- Each returned item then **also carries** `kind` and **`token_id`** (the id of that
  active token). `kind=bogus` → `400 validation_error`. **No `kind`** → previous
  unfiltered list (unchanged, backward compatible).

Consequences for this brief:
- The **Users tab** must query `kind=user` (so services stop leaking into it).
- The **Services tab** must query `kind=service`; each row's **`token_id`** is what
  makes **Revoke** finally work via the existing
  `POST /qaa/admin/service-tokens/{token_id}/revoke`.
- **Revoke uses the row's `token_id`, never the subject `id`.**
- After a successful revoke the subject has no active service token, so it drops
  out of `kind=service` — the row disappears on refetch. That is correct.
- Creating a service still returns the **plaintext token once** (same copy-once
  modal as users) — never persist it.

## Read FIRST

- `briefs/14-qaa-generator-admin.md` — the Admin tab this modifies (trust/token model,
  copy-once rules, `AdminUser` double-gate). Everything there still holds.
- `frontend/src/plugins/qaa-generator/AdminPanel.tsx` — the component to rework.
- `frontend/src/plugins/admin/UsersPage.tsx` and the Users table already in
  `AdminPanel.tsx` — the table + modal pattern to mirror for Services.
- `backend/app/api/v1/qaa_generator_admin.py` — proxy `list_qaa_users` (add `kind`).
- `CONVENTIONS.md` + brief 09 — enumerate literals (no bare strings for params,
  query keys, copy, tab values).

Do **not** change the qaa-generator manifest/plugin-level tabs
(`manifest.tsx`: Generate/Live/Runs/Admin). The Users/Services split is an
**internal** sub-tab inside `AdminPanel`, done with Mantine `<Tabs>`.

---

## 1. Backend proxy — pass `kind` through (one file)

`backend/app/api/v1/qaa_generator_admin.py`:

1. `class QaaAdminListQueryParam(StrEnum)` (lines ~41–45): add `KIND = "kind"`.
2. `build_list_params(...)` (lines ~62–78): add a `kind: str | None` keyword and
   `if kind: params.append((QaaAdminListQueryParam.KIND.value, kind))`.
3. `list_qaa_users(...)` (lines ~89–112): add
   `kind: str | None = Query(default=None)` and forward it via `build_list_params`.

Do **not** validate `kind` values in the proxy — upstream returns
`400 validation_error` for bad values and the proxy already passes non-5xx status
through (`map_upstream_status` / `PASSTHROUGH` behavior). Keep the proxy a thin
forwarder.

## 2. Frontend API layer

`frontend/src/api/types.ts`:
- Extend `QaaUser` (lines ~308–317) with the two new optional fields the filtered
  list returns:
  ```ts
  kind?: string | null;        // "user" | "service"
  token_id?: string | null;    // active token id; present on kind-filtered items
  ```
  (The interface already has an index signature, but add these explicitly so the
  Services table is typed and `token_id` is discoverable.)

`frontend/src/api/backendClient.ts`:
- `QAA_USERS_QUERY_PARAM` (lines ~64–69): add `KIND: "kind"`.
- `interface QaaUsersListParams` (lines ~81–86): add `kind?: "user" | "service"`.
  Prefer a small enumerated union constant per conventions, e.g.
  `export const QAA_SUBJECT_KIND = { USER: "user", SERVICE: "service" } as const;`
  and type `kind?: (typeof QAA_SUBJECT_KIND)[keyof typeof QAA_SUBJECT_KIND];`
- `buildQaaUsersListPath(...)` (lines ~265–285): if `params.kind` set,
  `searchParams.set(QAA_USERS_QUERY_PARAM.KIND, params.kind);`
- `listQaaUsers` needs no signature change (it already forwards `params`).

## 3. Frontend UI — `AdminPanel.tsx` rework

Keep the page header (title + subtitle). Below it, render a Mantine `<Tabs>` with
two panels, built so adding a third later is trivial (drive tabs from a small
array of `{ value, label }` if practical).

**Tab values** — enumerate, don't inline: add to `frontend/src/constants.ts` a
small const, e.g.
`export const QaaAdminSubTab = { USERS: "users", SERVICES: "services" } as const;`
(or colocate in the component if that matches house style for view-local enums —
match how other components enumerate local tab values).

### Users tab
- Reuse the existing users table + its Create/Edit/Delete/Regenerate modals
  **unchanged in behavior**.
- **Change the query** to filter users only: `usersQuery` → `listQaaUsers` with
  `{ kind: "user", limit, offset }`. Put `kind` into the query key so the two tabs
  cache independently, e.g. `queryKey: [QueryKey.QAA_USERS, token, "user"]`.
- Move the **"Create user"** button from the page header into this tab's panel
  (top-right of the Users table area).

### Services tab (the real work)
Replace the old `serviceForm`/`serviceNotice` free-text block **entirely** with:

- A **services table** mirroring the Users table markup
  (`Table.ScrollContainer` → `Table highlightOnHover striped withTableBorder`,
  `Thead/Tbody/Tr/Th/Td`, `size="xs" variant="light"` row action buttons).
  Columns: **Name**, **Created**, **Token id** (show it — it's operationally useful
  and confirms revoke target), **Actions**.
- Backing query `servicesQuery` = `listQaaUsers` with `{ kind: "service", limit, offset }`,
  key `[QueryKey.QAA_USERS, token, "service"]`. Same loading/error/empty states as
  Users (Loader / red Alert with Retry / empty Alert).
- Row action **Revoke** (red, `IconTrash`, `variant="light"`): calls
  `revokeQaaServiceToken(token, row.token_id)` guarded by a confirm modal like the
  user delete modal (type-to-confirm the service name is nice-to-have; a simple
  confirm is acceptable). On success invalidate `[QueryKey.QAA_USERS]`. **Disable
  Revoke when `row.token_id` is absent** (defensive).
- A **"Create service"** button (top-right of the Services table) opening a
  **Create service modal** with a single **Service name** `TextInput` (reuse the
  existing service-name copy). Submit → `createQaaServiceToken(token, { name })`;
  on success show the **existing copy-once token modal** (`tokenModal`) with the
  plaintext token, close the create modal, and invalidate `[QueryKey.QAA_USERS]`
  so the new service appears (with its `token_id`).
- Delete the now-unused `serviceForm` state, `SERVICE_FORM_INITIAL_STATE`,
  `serviceNotice`, `submitRegisterService`, `submitRevokeService`, and the
  revoke-by-token-id `TextInput`. Keep the shared `tokenModal` copy-once modal.

### Copy constants (`QaaAdminPanelCopy`)
Update/extend as needed: add `CREATE_SERVICE_ACTION` ("Create service"),
`CREATE_SERVICE_MODAL_TITLE`, `SERVICES_TAB` / `USERS_TAB` labels, `TABLE_TOKEN_ID`,
`REVOKE_SERVICE_CONFIRM_*`. Remove copy that only served the deleted free-text form
(`REGISTER_SERVICE_ACTION` unless reused as the modal submit label,
`SERVICE_REGISTER_SUBTITLE`, `SERVICE_REGISTERED`, `SERVICE_REVOKED`,
`TOKEN_ID_LABEL` if orphaned). Keep it enumerated per brief 09.

## 4. Tests

- `frontend/src/plugins/qaa-generator/AdminPanel.test.tsx`: rework for the tabbed
  layout. Cover: Users tab requests `kind=user`; Services tab requests
  `kind=service` and renders a table row with the service **Name** and **Token id**;
  Create-service flow shows the copy-once token modal; **Revoke** calls
  `revokeQaaServiceToken` with the row's **`token_id`** (not the subject id) and
  refetches. Mock `backendClient` as the existing test does.
- `backend/tests/test_qaa_generator_admin.py`: add a case asserting
  `GET /qaa/admin/users?kind=service` forwards `kind=service` to the upstream
  `GET /users` call (assert on the outbound params), and that an unknown `kind`'s
  upstream `400` is passed through.

## Out of scope / known issue (do NOT fix here, just don't regress)

Upstream qaa-generator has **no `DELETE /users/{id}` route**, yet the proxy
`delete_qaa_user` and `backendClient.deleteQaaUser` call it — the Users **Delete**
action likely fails upstream (405/404). This is **pre-existing** and unrelated to
this brief. Leave the Users Delete button as-is; note it for a separate follow-up.

## Acceptance criteria

- Admin panel shows two sub-tabs **Users** and **Services**; adding a third later
  is a one-line/array change.
- Users tab lists only `kind=user` subjects; Services tab lists only `kind=service`.
- Services is a table matching the Users table's look, with **Create service**
  (copy-once token modal) and per-row **Revoke** that uses the row's `token_id`.
- No free-text "token id" input anywhere; no plaintext token persisted.
- `kind` flows browser → proxy → upstream; bad `kind` surfaces upstream's 400.
- Frontend `tsc`/lint/tests and backend `pytest`/ruff/mypy all green.

## Verify against live prod (optional, superuser token required)

`GET /users?kind=service` on qaa-generator returns items with keys including
`kind` and `token_id`; `kind=bogus` → 400. (Confirmed live on 1.2.2 in both
`qaa-ed-prod` and `qaa-frn-prod`.)

---

## Addendum — Services "Regenerate token" row action (upstream LIVE in 1.2.3)

Give each Services row a **Regenerate token** action mirroring the Users table's
regenerate. Upstream endpoint is **live and verified** on qaa-generator 1.2.3
(both clusters): `POST /service-tokens/{token_id}/regenerate` — revokes the
subject's active tokens and issues a fresh **service**-kind token, returning the
plaintext **once** (`{"token": "..."}`); `404` unknown token id, `409` if the
token is not a service token.

**Path nuance (do not get this wrong):** the service regenerate suffix is
**`/regenerate`** appended after `{token_id}`, NOT `/tokens/regenerate`. The
existing `RoutePath.REGENERATE` / `BackendPath.REGENERATE` (`/tokens/regenerate`)
is the *user* path (`/users/{id}/tokens/regenerate`) — do **not** reuse it for
services. Add a distinct suffix (e.g. `QAA_ADMIN_SERVICE_TOKEN_REGENERATE` /
`SERVICE_TOKEN_REGENERATE = "/regenerate"`).

1. **Backend proxy** (`backend/app/api/v1/qaa_generator_admin.py`): add
   `POST {QAA_ADMIN_SERVICE_TOKENS}{QAA_ADMIN_SERVICE_TOKEN_BY_ID}/regenerate`
   forwarding to the upstream `/service-tokens/{token_id}/regenerate`. Add the
   route-path suffix constant in `backend/app/core/constants.py` and a builder
   in `backend/app/services/qaa_generator.py` (e.g.
   `build_qaa_service_token_regenerate_path`, mirroring
   `build_qaa_service_token_revoke_path`). Superuser token mode, `AdminUser` gate,
   like the revoke route.
2. **Frontend API** (`frontend/src/constants.ts`, `frontend/src/api/backendClient.ts`):
   add `BackendPath.SERVICE_TOKEN_REGENERATE = "/regenerate"` (distinct from
   `REGENERATE`), `buildBackendQaaServiceTokenRegeneratePath(tokenId)`, and
   `regenerateQaaServiceToken(token, tokenId): Promise<QaaUserTokenRegenerateResponse>`
   (POST; reuse the `{ token }` response type).
3. **Services table** (`AdminPanel.tsx`): add a **Regenerate token** button per
   row next to Revoke, styled like the Users regenerate (yellow, `IconKey`,
   per-row `loading`), `disabled={!token_id}`. On success show the shared
   copy-once `tokenModal` with the new plaintext token and invalidate
   `[QueryKey.QAA_USERS]`. A confirm step is nice-to-have but not required.
4. **Tests**: extend `AdminPanel.test.tsx` (Services row Regenerate calls
   `regenerateQaaServiceToken` with the row's `token_id` and opens the copy-once
   modal) and `test_qaa_generator_admin.py` (regenerate route forwards to the
   upstream `/service-tokens/{token_id}/regenerate` path).
