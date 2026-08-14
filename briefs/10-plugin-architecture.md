# Brief 10 — Plugin architecture (menu items = plugins, per-user enable)

You turn the app shell into a **plugin host**. Every menu section becomes a
self-contained **plugin** living under its own folder in `frontend/src/plugins/`,
described by a **manifest**; the shell (sidebar, routes, tabs, workspace) is
derived entirely from a plugin **registry** instead of today's hand-maintained
enums. Users enable/disable **optional** plugins for themselves; the choice is
persisted server-side. `Administration` becomes a **system** plugin — same
manifest contract as the rest, but always present and not user-toggleable.

Read `CONVENTIONS.md` and these files FIRST (they are the current source of truth
and every hardcoded section wiring you must replace):
- `frontend/src/constants.ts` — `SectionKey`/`SectionLabel`/`SectionRoute`,
  `RoutePath`, `ViewKey`, `TabId`, `TabTitle`, `QueryKey`, `BackendPath`.
- `frontend/src/app/layout/Sidebar.tsx` — hand-built `sections` array + `is_admin`
  filter.
- `frontend/src/app/routes.tsx` — hand-built routes per section.
- `frontend/src/app/layout/AppLayout.tsx` — `getSectionFromPath` string check.
- `frontend/src/components/WorkspaceContent.tsx` — `reactViewRegistry` (`ViewKey →
  JSX`).
- `frontend/src/store/uiStore.ts` — `TAB_DEFINITIONS`, `SECTION_TAB_CATALOG`,
  `createDefaultTabsBySection`, `sanitizeSectionTabs`, persistence helpers.
- `frontend/src/app/layout/TabBar.tsx`, `frontend/src/app/layout/Workspace.tsx`.
- `frontend/src/features/stagings/*` and `frontend/src/features/admin/*` — the two
  bodies of feature code that move into `plugins/`.
- `frontend/src/store/authStore.ts`, `frontend/src/api/backendClient.ts`,
  `frontend/src/api/types.ts`, `frontend/src/app/guards.tsx`.
- Backend: `backend/app/models/user.py`, `backend/app/schemas/user.py`,
  `backend/app/api/v1/users.py`, `backend/app/api/deps.py`,
  `backend/app/core/constants.py`, `backend/alembic/` (migration setup).

## The two-class plugin model (the heart of this slice)

Every plugin declares a `kind`:

- **`system`** — always available to eligible users; **not** shown in the Plugins
  toggle list and **cannot** be disabled. `Administration` is the only system
  plugin now. This exists to prevent the bootstrap/self-lockout problem: the
  Plugins management surface lives inside `Administration`, so it must never be
  removable.
- **`optional`** — appears in `Administration → Plugins`; each user enables it for
  themselves. `Stagings` is the only optional plugin now.

**Visibility (single source of truth for every layer):**
```
pluginVisible(p, user, enabledOptionalIds):
  if p.adminOnly and not user.is_admin:  return false
  if p.kind === "system":                return true
  return enabledOptionalIds.has(p.id)          // optional
```
**Tab-level gating (within a visible plugin):**
```
tabVisible(tab, user): return !tab.adminOnly || user.is_admin
```
`Administration` is a system plugin that is **NOT** `adminOnly` (visible to every
authenticated user). Its `Plugins` tab is visible to everyone; its `Users` tab is
`adminOnly` (admins only). Result: a non-admin sees `Administration → Plugins`
(and can self-manage), an admin additionally sees `Administration → Users`.

Enablement is **whole-plugin on/off** — there is no per-tab enable in this slice
(tab-level `adminOnly` is a fixed visibility rule, not a user toggle).

Static registry only — all plugin code is compiled into the one bundle; enabling a
plugin is a **visibility filter**, NOT runtime/remote module loading. Do NOT add
module federation, dynamic import of plugin bundles, or any remote-code mechanism.

## Plugin identifiers (keep them equal to today's `SectionKey` values → minimal churn)
`stagings`, `admin`. Existing `SectionKey.STAGINGS = "stagings"` and
`SectionKey.ADMIN = "admin"` already equal these ids, and `TabId` values
(`tab-stagings-deploy`, `tab-admin-users`, …) can stay — so persisted localStorage
and tab identities remain compatible.

## Hard scope rules
- **In scope:** frontend plugin host + registry + manifests; move
  `features/stagings` → `plugins/stagings`, `features/admin` → `plugins/admin`;
  per-user optional-plugin enablement (backend column + API + `Administration →
  Plugins` page + tab-level gating in the admin plugin).
- **No behavior change in Part A** (the host refactor): with both plugins enabled
  and an admin user, the app must render, route, tab, and persist **exactly** as
  today. Only Parts B/C add the new enable/disable behavior.
- **OUT of scope (do NOT do):** physically reorganizing `backend/`/`agent/` code
  into `plugins/` folders (a later brief); any `agent/` change at all; runtime/
  remote plugin loading; an org-wide "plugin availability catalog" (every optional
  plugin is available to every user); per-tab user toggles; new plugins beyond the
  two that exist; real OIDC/SSO.
- English-only UI, dark theme, Mantine — match the existing screens. No inline
  string/number literals — model them as `as const` / `StrEnum` per
  `CONVENTIONS.md` and brief 09.

---

## Part A — Frontend plugin host (pure refactor, no behavior change)

Introduce the contract and make the shell registry-driven. After Part A the app
behaves identically to today; commit-worthy on its own with all gates green.

**A1. Manifest contract** — new `frontend/src/core/plugins/types.ts` (or
`src/plugins/types.ts`; keep it out of individual plugin folders):
```ts
interface PluginTab {
  id: TabId;              // e.g. "tab-stagings-deploy" (reuse existing TabId values)
  title: string;
  element: ReactNode;     // what WorkspaceContent renders for this tab
  viewKey: ViewKey;       // reuse existing ViewKey values (persistence/registry key)
  adminOnly?: boolean;    // tab-level gating (default false)
}
interface PluginManifest {
  id: string;             // "stagings" | "admin"
  label: string;          // sidebar label ("Stagings" | "Administration")
  icon: TablerIcon;       // IconRocket | IconSettings (from today's Sidebar)
  route: string;          // "/stagings" | "/admin"
  kind: "system" | "optional";
  adminOnly?: boolean;    // whole-plugin gating (admin plugin: false)
  tabs: PluginTab[];      // in display order; tabs[0] is the default
  requiresAgent?: boolean;// stagings: true (informational for now; no behavior)
}
```

**A2. Manifests** — one per plugin, co-located with its code:
- `frontend/src/plugins/stagings/manifest.ts` — `id: "stagings"`, `kind:
  "optional"`, `route: "/stagings"`, `icon: IconRocket`, `requiresAgent: true`,
  tabs = Preflight, Deploy, History, Namespaces, Sync, E2E (reuse the existing
  `TabId`/`ViewKey`/`TabTitle` values and the existing panel components as
  `element`s). Order identical to today's `SECTION_TAB_CATALOG[STAGINGS]`.
- `frontend/src/plugins/admin/manifest.ts` — `id: "admin"`, `kind: "system"`,
  `adminOnly: false`, `route: "/admin"`, `icon: IconSettings`, tabs = **Plugins**
  (new, `adminOnly: false`, added in Part C) then **Users** (`adminOnly: true`,
  the existing `UsersPage`). Default tab = Plugins.

**A3. Registry** — `frontend/src/plugins/registry.ts` exports
`export const PLUGINS: PluginManifest[] = [stagingsPlugin, adminPlugin];` plus
derived selectors the shell consumes, e.g.:
- `pluginById(id)`, `pluginByRoute(pathname)` (replaces `getSectionFromPath`),
- `visiblePlugins(user, enabledOptionalIds)` (implements `pluginVisible`),
- `visibleTabs(plugin, user)` (implements `tabVisible`),
- flattened `viewRegistry` (`viewKey → element`) replacing
  `WorkspaceContent`'s `reactViewRegistry`,
- `tabDefinitions` / `tabCatalog` derived from `PLUGINS[].tabs`, replacing the
  hand-written `TAB_DEFINITIONS` / `SECTION_TAB_CATALOG`.

**A4. Move feature code:**
- `frontend/src/features/stagings/**` → `frontend/src/plugins/stagings/**`
  (keep the panel/test filenames; update the `@/features/stagings/...` imports to
  `@/plugins/stagings/...`). `StagingsSection.tsx` stays as the panel switch.
- `frontend/src/features/admin/**` → `frontend/src/plugins/admin/**` (UsersPage +
  its test). Update imports. Delete the now-empty `features/` dirs.

**A5. Rewire the shell to read the registry (no hardcoded sections left):**
- `Sidebar.tsx` — render `visiblePlugins(currentUser, enabledOptionalIds)` (in
  Part A, `enabledOptionalIds` = "all optional"; wired to real state in Part C).
  Keep the exact styling/behavior. Drop the local `sections` array and the inline
  `is_admin` branch (now expressed by manifest `adminOnly`).
- `routes.tsx` — generate one `AppLayout` route per plugin `route` under
  `RequireAuth`; keep `/login`, root redirect, and `*` fallback. Root redirect
  target = first visible plugin's route (today: `/stagings`). Admin-only tabs are
  gated inside the workspace (A6), not by a separate route; you MAY keep an
  `/admin` → default-tab redirect equivalent to today.
- `AppLayout.tsx` — replace `getSectionFromPath` with `pluginByRoute`.
- `WorkspaceContent.tsx` — render `viewRegistry[tab.viewKey]`; additionally, if the
  active tab is `adminOnly` and the user is not admin, render nothing/redirect
  (defense in depth — the tab should never have been openable).
- `uiStore.ts` — `tabsBySection` becomes keyed by plugin id (values unchanged for
  `stagings`/`admin`). `TAB_DEFINITIONS`/`SECTION_TAB_CATALOG`/
  `createDefaultTabsBySection` derive from the registry. `sanitizeSectionTabs`
  must additionally **drop tab ids that belong to a non-visible plugin or an
  `adminOnly` tab the user can't see** — so a disabled plugin's persisted tabs
  fall away gracefully. Keep the localStorage key `StorageKey.TABS` and format
  compatible.
- `constants.ts` — remove `SectionKey`/`SectionLabel`/`SectionRoute` (now derived
  from manifests). Keep `RoutePath` login/root; per-plugin routes live in
  manifests. Keep `ViewKey`/`TabId`/`TabTitle` values, but they are now referenced
  BY the manifests (the manifest is the source that pairs them with elements).
  Update all importers.

**A6. Part A acceptance:** with an admin user and both plugins enabled, the
sidebar, tabs, routing, tab open/close/switch, and persistence are
byte-for-byte the same experience as before the refactor. Frontend gates green.

---

## Part B — Backend: per-user optional-plugin enablement

**B1. Constants (`backend/app/core/constants.py`):**
- `PluginId(StrEnum)`: `STAGINGS="stagings"`, `ADMIN="admin"`.
- A catalog marking kind, e.g. `OPTIONAL_PLUGIN_IDS = frozenset({PluginId.STAGINGS})`
  and `SYSTEM_PLUGIN_IDS = frozenset({PluginId.ADMIN})`. The backend only needs the
  ids + kinds (its copy of the registry, per the "each layer carries its own enum"
  convention in brief 09) — it does NOT know labels/icons/tabs.
- `RoutePath.ME_PLUGINS = "/me/plugins"`.

**B2. Model + migration (`backend/app/models/user.py`, `backend/alembic/`):**
add `enabled_plugins: Mapped[list[str] | None]` stored as JSON (nullable). **NULL
means "not yet configured" → resolves to all optional ids** (backward compatible:
existing users keep seeing Stagings). Add a real Alembic migration for the new
column (this slice DOES add a migration — unlike brief 08). Resolution helper:
`resolve_enabled(user) = user.enabled_plugins if not None else list(OPTIONAL_PLUGIN_IDS)`,
intersected with the current `OPTIONAL_PLUGIN_IDS` (drop stale/removed ids).

**B3. Schemas (`backend/app/schemas/user.py`):**
- Add `enabled_plugins: list[str]` to `UserRead` — always the **resolved** set
  (never null on the wire), so `/me` bootstraps the frontend without a waterfall.
- `MePluginsUpdateRequest { enabled_plugins: list[str] }`.
- `MePluginsResponse { enabled_plugins: list[str] }` (resolved).

**B4. Endpoints (`backend/app/api/v1/users.py`, Bearer-guarded, `CurrentUser`):**
- `GET /api/v1/me/plugins` → `MePluginsResponse` (resolved set for the caller).
- `PUT /api/v1/me/plugins` → `MePluginsResponse`. Body ids MUST be a subset of
  `OPTIONAL_PLUGIN_IDS`; reject unknown ids **and** any system id (e.g. `"admin"`)
  with **422** (system plugins are not user-toggleable). Persist the explicit list
  (deduped, order-normalized) on the caller's own row; return the resolved set.
- `/me` (`GET`) now returns `enabled_plugins` via `UserRead`. No other `/me` or
  `/users` behavior changes. This is a **self-service** surface — NOT admin-gated;
  every authenticated user manages their own row only.

**B5. Backend tests** (mirror `test_users.py` / `conftest.py`):
- `/me` returns `enabled_plugins` = all optional ids for a freshly seeded user
  (NULL column → resolved default).
- `PUT /me/plugins {[]}` → `{enabled_plugins: []}`, then `/me` reflects empty;
  `PUT {["stagings"]}` restores it.
- `PUT` with an unknown id → 422; `PUT` with `"admin"` (a system id) → 422; the
  row is unchanged on rejection.
- Non-admin can call both endpoints for themselves (no 403 — this is self-service).

---

## Part C — Administration → Plugins page + wire enablement into the shell

**C1. Frontend API + types:**
- `backendClient.ts`: `getMyPlugins()` (`GET /api/v1/me/plugins`),
  `updateMyPlugins(ids)` (`PUT`). `constants.ts`:
  `BackendPath.ME_PLUGINS = "/api/v1/me/plugins"`, `QueryKey.ME_PLUGINS`.
- `types.ts`: add `enabled_plugins` to the `User` type; `MePluginsResponse`.

**C2. Enablement store:** hold the caller's enabled optional-plugin id set and feed
it to `visiblePlugins`. Simplest: read `enabled_plugins` from the `/me` payload the
`authStore` already loads on login/bootstrap, store it there (or a small
`pluginsStore`), and update it after a successful `updateMyPlugins`. The sidebar
and route/tab derivation must react to this set (Zustand selector) so toggling is
immediate — no reload.

**C3. `PluginsPage`** — `frontend/src/plugins/admin/PluginsPage.tsx`, wired as the
admin plugin's **Plugins** tab (`adminOnly: false`, so every user sees it):
- List the **optional** plugins from the registry (label + icon + a Mantine
  `Switch` reflecting the enabled set). Toggling → `updateMyPlugins(nextIds)`
  mutation → update the store → sidebar updates live.
- Show **system** plugins (Administration) as an always-on, disabled row labeled
  as system/always-available, for transparency. They are never toggleable.
- If the user disables the plugin whose route is currently active, navigate to a
  still-visible plugin (e.g. the first `visiblePlugins` entry) so they are never
  stranded on a dead route. `Administration` is always visible, so the user can
  always get back to this page to re-enable.
- Loading/error/empty states consistent with `UsersPage`.

**C4. Tab-level gating in the admin plugin:** `Users` tab (`adminOnly: true`) must
not appear in the TabBar "Open tab" menu, the default open set, or be routable for
non-admins; `Plugins` tab is available to all. This is enforced by `visibleTabs` /
the sanitized catalog from Part A — verify it holds for both admin and non-admin.

**C5. Frontend tests** (Vitest + RTL, mock `fetch`):
- `backendClient.getMyPlugins/updateMyPlugins` hit the right path/method/body/Bearer
  and parse the shape.
- `PluginsPage` renders optional plugins with switches from a mocked enabled set;
  toggling `stagings` off calls `updateMyPlugins([])` and the Stagings sidebar item
  disappears; toggling on restores it. System (Administration) row is present and
  disabled.
- Non-admin: `Administration` is visible with only the `Plugins` tab (no `Users`
  tab in the bar or open-tab menu); admin additionally sees `Users`.
- Disabling the active plugin redirects to a visible plugin; the app never lands on
  an empty/dead route.
- `uiStore` persistence: a stored tab id for a now-disabled plugin (or an
  `adminOnly` tab for a non-admin) is dropped by `sanitizeSectionTabs` on load.

---

## Gates (all must pass before done)
- Frontend: `cd frontend && npm run lint && npx tsc --noEmit && npm run test && npm run build`
- Backend: `cd backend && ruff check . && ruff format --check . && mypy app && pytest`
- Agent (unchanged — must stay green): `cd agent && ruff check . && ruff format --check . && mypy app && pytest`
- The Alembic migration applies cleanly on a fresh DB and round-trips (upgrade/downgrade).

## Acceptance criteria (must all hold)
1. The shell renders sidebar, routes, tabs, and the workspace **entirely from the
   plugin registry** — no hardcoded section list, `getSectionFromPath` string
   check, `reactViewRegistry`, `TAB_DEFINITIONS`, or `SECTION_TAB_CATALOG` remain.
   `plugins/stagings/` and `plugins/admin/` each own their code + `manifest.ts`;
   `features/` is gone.
2. Two plugin classes work: `Administration` (system) is always present for every
   authenticated user and cannot be disabled; `Stagings` (optional) can be
   toggled per-user. Tab gating: `Plugins` tab visible to all, `Users` tab to
   admins only.
3. Enablement persists server-side (`GET/PUT /api/v1/me/plugins`, `enabled_plugins`
   on `/me`); NULL resolves to all optional plugins; `PUT` rejects unknown/system
   ids with 422; toggling updates the sidebar live with no reload; disabling the
   active plugin never strands the user (Administration is always reachable to
   re-enable).
4. Part A alone is a behavior-preserving refactor (admin + all enabled ⇒ identical
   to today). No `agent/` changes; no runtime/remote plugin loading; no org
   availability catalog; whole-plugin on/off only.
5. All gate suites green (frontend lint+tsc+vitest+build; backend
   ruff+format+mypy+pytest incl. the new tests and migration; agent suite
   unchanged & green). English-only UI, dark theme, enumerated constants.
6. `frontend/README.md` and `backend/README.md` updated: the plugin model (system
   vs optional, manifest + registry, how to add a plugin), the `Administration →
   Plugins` self-service page, and the `/me/plugins` endpoints + `enabled_plugins`
   column/migration.

## Out of scope (do NOT do)
- Reorganizing `backend/`/`agent/` code into per-plugin folders (future brief);
  any `agent/` change.
- Runtime/remote/dynamically-loaded plugin code (module federation, remote
  bundles) — the registry is static.
- Org-wide plugin availability catalog / admin-controlled allow-list; per-tab user
  toggles; new plugins beyond `stagings`/`admin`; real OIDC/SSO.

When done, ensure the three gate suites and the migration round-trip all succeed,
then stop. Do not commit — the reviewer inspects `git diff` and commits.
