# Brief 18 — User account menu + Profile page (settings consolidation)

Add a **Profile** area reached from a new **account menu** at the bottom of the
sidebar (where the user name is today), and consolidate the operational config
scattered across the various `.env` files into **one editing surface** —
`Profile → Settings` — split by nature (per-user account data, this-machine
companion config, admin-only server config, this-browser app config).

Concretely the shipped behavior is:

1. The bottom-of-sidebar user block becomes a **menu like the other sidebar
   menus**, still pinned to the bottom. Its items are exactly **Profile** and
   **Log out**.
2. **Log out** asks for confirmation first (modal), then logs out.
3. **Profile** opens a Profile workspace with three tabs: **Account**,
   **Plugins**, **Settings**.
4. **Plugins moves out of Administration into Profile** (it is a per-user
   setting available to every authenticated user). Administration keeps only
   **Users** and becomes admin-only.
5. **Account** lets the signed-in user change their own **Display name**,
   **Password**, and **Auto-login**.
6. **Settings** is the single consolidated config editor (operational settings
   only — see scope), grouped by ownership.

Read `CONVENTIONS.md` and brief 09 first: **no inline string/number literals**,
model constants as `StrEnum` (Python) / `as const` union objects (TS) in the
dedicated constants modules; English-only UI; type-checked and linted clean
(`ruff` + `mypy`; `eslint` + `tsc --noEmit`). Follow brief 12's plugin contract.

## Design decision (locked with the user)

The user asked for "one `.env` file editable in the profile." The config today
lives on three physically separate surfaces that cannot become one file:

- **Backend** (shared server, has the DB) — infra + qaa-generator upstream.
- **Local agent** (companion app, runs on each user's own machine; the SPA
  talks to it directly on `127.0.0.1`) — Jenkins creds, kube/staging paths.
- **Frontend** (SPA) — `VITE_*` values baked in at build time.

Locked answers:

- **Scope = operational settings only.** `DATABASE_URL` and `JWT_SECRET` stay as
  untouched **server bootstrap** and are NOT exposed or editable in the UI. Same
  for the agent's bootstrap (`AGENT_HOST`/`AGENT_PORT`/`AGENT_CORS_ORIGINS`/
  `AGENT_BACKEND_URL`). The root `.env` (dev tooling `ANTHROPIC_API_KEY` /
  `OPENAI_API_KEY`) is out of scope entirely.
- **Ownership = split by nature, one page.** `Profile → Settings` is the single
  editing surface, with grouped sections that each write to the correct place:
  - **Account** (per-user, DB): display name, password, auto-login.
  - **Plugins** (per-user, DB): the existing per-user plugin toggles.
  - **Settings → Application** (this browser): API base URL, agent port range —
    stored as `localStorage` runtime overrides, applied on reload.
  - **Settings → Local companion** (this machine's agent): Jenkins + kube/staging
    fields, written to the agent's `.env` through a new agent endpoint.
  - **Settings → Server** (admin only): qaa-generator upstream + port-forward +
    actor, written to the backend `.env` through a new backend endpoint.

So "one file" becomes "**one place to edit**", while each value persists to the
surface that actually consumes it. State this rationale in any docstring/README
you touch so it is not mistaken for an incomplete implementation.

## Hard scope rules

- **In scope:** the account menu + logout confirm; the Profile plugin (Account /
  Plugins / Settings); moving the Plugins tab from `admin` to `profile`; making
  Administration admin-only; a self-service `PATCH /me`; backend server-settings
  endpoints; agent settings endpoints; small `.env` upsert helpers; frontend
  runtime-config overrides; API clients/types; constants; tests; example-env and
  README doc touch-ups.
- **Out of scope (do NOT do):** exposing/editing `DATABASE_URL`, `JWT_SECRET`,
  agent bootstrap (`AGENT_HOST/PORT/CORS/BACKEND_URL`), or the root `.env` keys;
  any new DB columns or Alembic migration (the `users` table already has
  `display_name`, `auto_login`, `password_hash`); rewiring the login/auto-login
  flow (see the Auto-login note); adding runtime/remote plugin loading; changing
  unrelated `PluginId`/`ViewKey`/`TabId` values; touching other plugins.
- English-only UI, Mantine, dark+light theme (use `usePalette`), enumerated
  constants only.

Read FIRST:

- `frontend/src/app/layout/Sidebar.tsx` — the bottom user block + Log out button
  you are replacing with the account menu.
- `frontend/src/plugins/admin/manifest.tsx`, `frontend/src/plugins/admin/PluginsPage.tsx`,
  `frontend/src/plugins/admin/UsersPage.tsx` — the plugin you split.
- `frontend/src/core/plugins/types.ts`, `frontend/src/plugins/discovery.ts`,
  `frontend/src/plugins/catalog.ts`, `frontend/src/plugins/registry.ts`,
  `frontend/src/app/routes.tsx`, `frontend/src/app/layout/AppLayout.tsx` — the
  plugin/tab/routing machinery (how `navSection` and the Profile plugin plug in).
- `frontend/src/constants.ts` — all frontend enums.
- `frontend/src/api/backendClient.ts`, `frontend/src/api/agentClient.ts`,
  `frontend/src/api/types.ts` — client/type patterns to extend.
- `frontend/src/store/authStore.ts` — `currentUser`, `setCurrentUser`, the
  client `autoLogin` preference (note below).
- `backend/app/api/v1/users.py`, `backend/app/schemas/user.py`,
  `backend/app/core/config.py`, `backend/app/core/constants.py`,
  `backend/app/api/deps.py` (`CurrentUser`, `AdminUser`), `backend/app/main.py`.
- `agent/app/api/routes.py`, `agent/app/api/deps.py` (`require_auth`,
  `app.state.settings`), `agent/app/core/config.py`, `agent/app/core/constants.py`,
  `agent/app/schemas.py`, `agent/app/main.py` (lifespan sets `app.state.settings`).

---

## Part A — Frontend constants & plugin contract (additive)

**A1. `core/plugins/types.ts`** — add an optional nav placement to `PluginSpec`:

- New const-union `NavSection` in `constants.ts` (Part A2): `PRIMARY = "primary"`,
  `ACCOUNT = "account"` (+ exported union type).
- Add `navSection?: NavSection` to `PluginSpec` (default treated as `PRIMARY`).
  It flows through to `PluginManifest` automatically.

**A2. `constants.ts`:**

- `PluginId.PROFILE = "profile"`.
- `IconName.USER = "user"`.
- `NavSection` const object + type (above).
- `ViewKey`: add `PROFILE_ACCOUNT = "profile-account"`,
  `PROFILE_PLUGINS = "profile-plugins"`, `PROFILE_SETTINGS = "profile-settings"`;
  **remove** `ADMIN_PLUGINS`.
- `TabId`: add `PROFILE_ACCOUNT = "tab-profile-account"`,
  `PROFILE_PLUGINS = "tab-profile-plugins"`,
  `PROFILE_SETTINGS = "tab-profile-settings"`; **remove** `ADMIN_PLUGINS`.
- `TabTitle`: add entries — `PROFILE_ACCOUNT → "Account"`,
  `PROFILE_PLUGINS → "Plugins"`, `PROFILE_SETTINGS → "Settings"`; remove the
  `ADMIN_PLUGINS` entry.
- `BackendPath`: add `SETTINGS = "/api/v1/settings"` (server operational
  settings). `ME` already exists and is reused for `PATCH /me`.
- `AgentPath`: add `SETTINGS = "/settings"`.
- `StorageKey`: add `APP_API_BASE_URL = "qaa-tms.api-base-url"` and
  `APP_AGENT_PORTS = "qaa-tms.agent-ports"`.
- `QueryKey`: add `ME = "me"`, `SERVER_SETTINGS = "server-settings"`,
  `AGENT_SETTINGS = "agent-settings"`.

**A3. `core/plugins/icons.ts`** — register `IconName.USER` → `IconUserCircle`
(from `@tabler/icons-react`) in `ICON_REGISTRY`.

**A4. `plugins/discovery.ts`:**

- In `isPluginManifest`, accept the optional field:
  `(value.navSection === undefined || value.navSection === NavSection.PRIMARY || value.navSection === NavSection.ACCOUNT)`.
- Relax the system-plugin default-tab rule so an **admin-only system plugin** may
  default to an admin-only tab (needed now that Administration is admin-only and
  its only tab is Users). Change the guard to:
  `if (plugin.kind === PluginKind.SYSTEM && !plugin.adminOnly && plugin.tabs[0]?.adminOnly)`.

**A5. `plugins/catalog.ts`** — add helpers so the sidebar/routes can split nav:

- `export function pluginNavSection(plugin): NavSection` returning
  `plugin.navSection ?? NavSection.PRIMARY`.
- `export function primaryVisiblePlugins(user, enabledOptionalIds)` = existing
  `visiblePlugins(...)` filtered to `pluginNavSection === PRIMARY`.
- `export function accountVisiblePlugins(user, enabledOptionalIds)` = filtered to
  `ACCOUNT`.
- Re-export both from `plugins/registry.ts`.

---

## Part B — Profile plugin (`frontend/src/plugins/profile/`)

**B1. Move the Plugins page.** Move `plugins/admin/PluginsPage.tsx` to
`plugins/profile/PluginsPanel.tsx` (rename the component to `PluginsPanel`;
behavior unchanged — it already edits per-user plugin toggles via
`backendClient.updateMyPlugins`). Move/adjust its test to
`plugins/profile/PluginsPanel.test.tsx`.

**B2. `plugins/profile/AccountPanel.tsx`** (`ViewKey.PROFILE_ACCOUNT`):

- Mantine form with: **Display name** (`TextInput`), **New password** +
  **Confirm password** (`PasswordInput`, optional — blank = unchanged; must
  match), **Auto-login** (`Switch`). Prefill from `authStore.currentUser`.
- Submit → `backendClient.updateMe(token, payload)` sending only changed fields
  (omit password when blank). On success, update the store via
  `setCurrentUser(updatedUser)` and show a success `Alert`/notification; on error
  show the backend detail. English copy only.

**B3. `plugins/profile/SettingsPanel.tsx`** (`ViewKey.PROFILE_SETTINGS`) — one
page, three (admin: three; non-admin: two) grouped cards:

- **Application (this browser).** Fields: **API base URL** (`TextInput`),
  **Agent port range** (`TextInput`, e.g. `47600-47605`). Load current values
  from the runtime-config resolver (Part E). Save writes the `localStorage`
  overrides and shows a "Reload to apply" notice (these are read at module load).
  A "Reset to build defaults" action clears the overrides.
- **Local companion (this machine).** Backed by the agent settings endpoint
  (Part D) via `agentClient.getSettings` / `updateSettings`. Reuse the existing
  agent-discovery pattern (as in `JenkinsSection`/`KuberSection`): if the agent
  is not detected, render the same "agent unavailable / ports" note instead of
  the form. Fields: Jenkins `url`, `username`, `token` (`PasswordInput`,
  write-only — see masking), `root path`, `root folders` (comma-separated),
  `request timeout`, `tree depth`, `stuck min idle hours`; staging `bin`,
  `stagings repo`, `staging kubeconfig`, `staging kubeconfig url`,
  `kubeconfig active path`, `staging kubeconfig max age hours`, `kubectl bin`,
  `kubeconfig`, `kubectl request timeout`. The token field shows a
  "•••• set" hint when `jenkins_token_set` is true and is only sent when the
  user types a new value.
- **Server (admin only).** Rendered only when `currentUser.is_admin`. Backed by
  `backendClient.getServerSettings` / `updateServerSettings` (Part C). Fields:
  qaa-generator `base_url`, `actor`, `service_token` (write-only), `superuser_token`
  (write-only), `port_forward_enabled` (`Switch`), `port_forward_namespace`,
  `port_forward_resource`, `port_forward_local_port`, `port_forward_remote_port`.
  Secret fields show a "set / not set" hint and are only sent when edited.

Keep each group's save independent (separate mutation + button per card) so a
missing agent or non-admin user does not block the others.

**B4. `plugins/profile/manifest.tsx`** — a **system** plugin surfaced in the
account menu:

```
id: PluginId.PROFILE
label: "Profile"
icon: IconName.USER
kind: PluginKind.SYSTEM
origin: PluginOrigin.BUILTIN
contractVersion: CONTRACT_VERSION
navSection: NavSection.ACCOUNT
order: 40            // after Administration (30); never the default landing
route: "/profile"
tabs:
  - Account  (TabId.PROFILE_ACCOUNT,  ViewKey.PROFILE_ACCOUNT,  <AccountPanel/>)   // first / default, not admin-only
  - Plugins  (TabId.PROFILE_PLUGINS,  ViewKey.PROFILE_PLUGINS,  <PluginsPanel/>)
  - Settings (TabId.PROFILE_SETTINGS, ViewKey.PROFILE_SETTINGS, <SettingsPanel/>)
```

It is discovered by the existing `import.meta.glob("./*/manifest.tsx")` — no
registry edits needed beyond the catalog helpers.

**B5. Administration manifest (`plugins/admin/manifest.tsx`)** — remove the
Plugins tab, keep only **Users**, and set `adminOnly: true` on the plugin so it
disappears for non-admins:

```
adminOnly: true
tabs: [ { adminOnly: true, id: TabId.ADMIN_USERS, ... , element: <UsersPage/> } ]
```

(The relaxed discovery rule in A4 permits this.)

---

## Part C — Backend: self-service `PATCH /me` + server settings

**C1. `schemas/user.py`** — add:

- `MeUpdateRequest(BaseModel, extra="forbid")`: `display_name: str | None = None`,
  `password: str | None = None`, `auto_login: bool | None = None`. (No
  `is_admin`, no `enabled_plugins` — plugins keep their own `PUT /me/plugins`.)

**C2. `api/v1/users.py`** — add `PATCH /me` (uses `CurrentUser`, no admin gate):
apply provided fields (`payload.model_fields_set`), hashing password via
`hash_password`; `commit`, `refresh`, return `to_user_read(current_user)`.

**C3. `.env` upsert helper — `backend/app/core/env_file.py`:**

- `upsert_env_values(path: Path, values: dict[str, str]) -> None`: read the file
  (create if absent), for each key replace an existing `KEY=...` line in place
  (preserving surrounding comments/order and blank lines) or append `KEY=value`
  at the end; write atomically. Pure, unit-tested (`tests/`). No new dependency —
  hand-roll the line rewrite; quote/escape values only if they contain
  whitespace or `#`.
- Resolve the target `.env` path once (module constant) as the same file
  `Settings` loads (`EnvFile.DOT_ENV`), relative to the backend package root —
  add a helper/constant rather than a bare literal.

**C4. Server settings schemas — `backend/app/schemas/settings.py`:**

- `ServerSettingsRead`: `qaa_generator_base_url: str`, `qaa_generator_actor: str`,
  `qaa_generator_service_token_set: bool`, `qaa_generator_superuser_token_set: bool`,
  `qaa_generator_port_forward_enabled: bool`,
  `qaa_generator_port_forward_namespace: str`,
  `qaa_generator_port_forward_resource: str`,
  `qaa_generator_port_forward_local_port: int`,
  `qaa_generator_port_forward_remote_port: int`. **Never** return the raw tokens.
- `ServerSettingsUpdateRequest(extra="forbid")`: every field optional; the two
  tokens are `str | None` (a provided non-empty string overwrites; an empty
  string clears; omitted leaves as-is). `to_server_settings_read(settings)` maps
  a `Settings` to the read model (tokens → `bool(value)`).

**C5. Router — `backend/app/api/v1/settings.py`:**

- `GET /settings` (`AdminUser`) → `to_server_settings_read(get_settings())`.
- `PUT /settings` (`AdminUser`, `ServerSettingsUpdateRequest`) → build a
  `dict[EnvKey, str]` from the provided fields (booleans/ints → their string
  form matching the existing `.env` style), `upsert_env_values(...)`,
  `get_settings.cache_clear()`, return the fresh read model.
- Mount in `main.py` under the v1 router (tag `ApiTag.SYSTEM` or a new
  `ApiTag.SETTINGS`). Add `RoutePath.SETTINGS = "/settings"` to backend
  constants.
- **Reload note:** confirm the qaa-generator service reads `get_settings()` per
  request (so `cache_clear()` takes effect). If it caches a transport/client at
  import, add a docstring line noting port-forward changes need a backend
  restart; do not silently pretend it hot-reloads.

---

## Part D — Agent: settings endpoints (per machine)

**D1. `.env` upsert helper — `agent/app/core/env_file.py`** — same contract as
C3 (the agent is a separate package; duplicate the small helper, with its own
test). Target the agent's `EnvFile.DOT_ENV`.

**D2. Schemas (`agent/app/schemas.py`):**

- `AgentSettingsRead`: all editable operational fields (jenkins_url,
  jenkins_username, `jenkins_token_set: bool`, jenkins_root_path,
  jenkins_root_folders, jenkins_request_timeout, jenkins_tree_depth,
  jenkins_stuck_min_idle_hours, staging_bin, stagings_repo, staging_kubeconfig,
  staging_kubeconfig_url, kubeconfig_active_path, staging_kubeconfig_max_age_hours,
  kubectl_bin, kubeconfig, kubectl_request_timeout). **Exclude** bootstrap
  (`host`, `port`, `cors_origins`, `backend_url`) and never return
  `jenkins_token`.
- `AgentSettingsUpdate(extra="forbid")`: every field optional; `jenkins_token:
  str | None` write-only (non-empty overwrites, empty clears, omitted leaves).

**D3. Routes (`agent/app/api/routes.py`), both `require_auth`:**

- `GET AgentPath.SETTINGS` → build `AgentSettingsRead` from `get_settings(request)`.
- `PUT AgentPath.SETTINGS` (`AgentSettingsUpdate`) → map provided fields to their
  `EnvKey`/`StagingEnvKey` names (lists like `jenkins_root_folders` serialized as
  CSV to match the existing parser), `upsert_env_values(...)`, then rebuild
  runtime settings: `get_settings.cache_clear()` **and**
  `request.app.state.settings = Settings()` so subsequent Jenkins/kube calls use
  the new values within the same process. Return the fresh `AgentSettingsRead`.
- Add `AgentPath.SETTINGS = "/settings"` to `agent/app/core/constants.py`.

---

## Part E — Frontend runtime config + API clients

**E1. `frontend/src/core/runtimeConfig.ts`:**

- `resolveApiBaseUrl(): string` — `localStorage[StorageKey.APP_API_BASE_URL]`
  (trimmed, non-empty) → `import.meta.env.VITE_API_BASE_URL` →
  `DEFAULT_API_BASE_URL`.
- `resolveAgentPortRange(): number[]` — parse
  `localStorage[StorageKey.APP_AGENT_PORTS]` → `import.meta.env.VITE_AGENT_PORTS`
  → `DEFAULT_AGENT_PORT_RANGE` (reuse the existing `parsePortRange` from
  `agentClient.ts`; export it or move it here).
- Setters/clearers for both overrides used by the Settings → Application card.
- SSR-safe (guard `window`/`localStorage`), same as `authStore`/`uiStore`.

**E2. Wire it in:** `backendClient.ts` computes `apiBaseUrl` from
`resolveApiBaseUrl()`; `agentClient.ts` uses `resolveAgentPortRange()` where it
reads `DEFAULT_AGENT_PORT_RANGE`; update the `import.meta.env.VITE_AGENT_PORTS`
copy references in `JenkinsSection.tsx`/`KuberSection.tsx` to the resolver. These
resolve at module load, so document "reload to apply" in the Application card.

**E3. `api/types.ts`** — add `MeUpdateRequest`, `ServerSettingsRead`,
`ServerSettingsUpdateRequest`, `AgentSettings` (read), `AgentSettingsUpdate`.

**E4. `api/backendClient.ts`** — add `updateMe(token, payload): Promise<User>`
(`PATCH BackendPath.ME`), `getServerSettings(token): Promise<ServerSettingsRead>`
(`GET BackendPath.SETTINGS`), `updateServerSettings(token, payload):
Promise<ServerSettingsRead>` (`PUT BackendPath.SETTINGS`).

**E5. `api/agentClient.ts`** — add `getSettings(port, token): Promise<AgentSettings>`
and `updateSettings(port, token, payload): Promise<AgentSettings>` using the
existing `readAgentJson` / `createJsonBody` helpers and `AgentPath.SETTINGS`.

---

## Part F — Sidebar account menu + logout confirm + routing

**F1. `app/layout/Sidebar.tsx`:**

- Top plugin list: iterate `primaryVisiblePlugins(currentUser, enabledOptionalIds)`
  instead of `visiblePlugins(...)` (Profile is placement `ACCOUNT`, so it drops
  out of the primary nav automatically).
- Bottom: replace the static user block **and** the Log out button with an
  **account menu** that reads like the other sidebar menus:
  - **Expanded sidebar:** a header button (avatar `IconUserCircle` + display name
    + `@username` + a chevron) that toggles a local `accountMenuOpen` state; when
    open, render two sub-items styled like the existing tab buttons
    (`buildTabButtonStyle`): **Profile** and **Log out**.
  - **Collapsed sidebar:** render the avatar as the target of a Mantine `Menu`
    (popover) with the same two items, since there is no inline room.
  - **Profile** → `activatePluginWorkspaceTab(PluginId.PROFILE)` then
    `navigate(profilePlugin.route)` (look the route up via `pluginById`, don't
    hardcode `/profile`).
  - **Log out** → open the confirm modal (F2), do not log out directly.

**F2. Logout confirmation.** Use a controlled Mantine `<Modal>` with
`useDisclosure` (self-contained; do not add `@mantine/modals`/`ModalsProvider`).
Title "Log out", body "You'll need to sign in again to continue.", a cancel
button and a red confirm button. Confirm → `logout()` +
`navigate(RoutePath.LOGIN, { replace: true })` (today's behavior).

**F3. `app/routes.tsx`** — `RootRedirect` picks the first **primary** visible
plugin: use `primaryVisiblePlugins(...)[0]` so Profile is never the default
landing. `PLUGINS.map(...)` already registers the `/profile/*` route.

**F4. `app/layout/AppLayout.tsx`** — `activePlugin`/`activePluginVisible` must
still treat Profile as a valid, visible plugin so navigating to `/profile`
renders (Profile is in `visiblePlugins`; only the sidebar's *primary* list
excludes it). Verify the redirect guard uses `visiblePlugins` (all placements),
not the primary-only helper — Profile must pass. Its three tabs render in the
`TabBar` like any plugin.

**Auto-login note (do not rewire):** the server field `user.auto_login` and the
client `authStore.autoLogin` (tied to remembered credentials in `localStorage`)
are two different mechanisms today. The Account tab edits the **server** field
via `PATCH /me` only. Leave the client login/auto-login flow unchanged; add a
one-line code comment pointing out the duplication for a future brief.

---

## Part G — Tests & docs

- **Backend:** `PATCH /me` (happy path, password change, partial update,
  `extra=forbid` rejection); `GET/PUT /settings` (admin-only 403 for non-admin,
  masking of tokens, empty-string clears, `cache_clear` reload); `env_file`
  helper (replace-in-place, append, create-if-absent, comment preservation).
- **Agent:** `GET/PUT /settings` (auth required, token masking, list CSV
  round-trip, `app.state.settings` refreshed); `env_file` helper.
- **Frontend:** update `Sidebar.test.tsx` (account menu shows Profile + Log out;
  Log out opens confirm; confirm logs out); update `AppLayout.test.tsx` and any
  test referencing removed `ViewKey.ADMIN_PLUGINS`/`TabId.ADMIN_PLUGINS`; move
  `PluginsPage.test.tsx` → `profile/PluginsPanel.test.tsx`; update
  `admin/manifest`/`contract.test.tsx` for the admin-only Administration and the
  relaxed discovery rule; add `AccountPanel.test.tsx` and `SettingsPanel.test.tsx`
  (renders groups; hides Server group for non-admins; agent-unavailable branch;
  save calls the right client). Add a `runtimeConfig` unit test (override →
  fallback → default).
- **Docs/examples:** update `backend/.env.example` and `agent/.env.example`
  comments to note these operational keys are now editable at `Profile →
  Settings`, while `DATABASE_URL`/`JWT_SECRET` (and agent host/port/backend URL)
  remain bootstrap-only. No change to `frontend/.env.example` values (still the
  build-time defaults, now overridable at runtime).

## Acceptance

- Bottom-of-sidebar user entry is a menu (Profile / Log out), pinned at the
  bottom, working collapsed and expanded. Log out confirms before signing out.
- `Profile → Account` changes the signed-in user's display name / password /
  auto-login and reflects immediately in the store.
- `Plugins` now lives under Profile for every user; Administration shows only
  Users and is invisible to non-admins.
- `Profile → Settings` edits companion (agent), server (admin-only), and app
  (browser) config from one page; secrets are never returned to the client and
  are only sent when re-entered.
- `ruff` + `mypy` (backend & agent) and `eslint` + `tsc --noEmit` (frontend) are
  clean; all new/updated tests pass.
