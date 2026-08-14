# Brief 11 — Plugin auto-discovery via `import.meta.glob` (drop the hand-maintained registry)

Small, behavior-preserving refactor of how the plugin list is assembled. Today
`frontend/src/plugins/registry.ts` hand-lists `PLUGINS = [stagingsPlugin,
adminPlugin]` and `frontend/src/plugins/catalog.ts` hand-lists `PLUGIN_SPECS =
[stagingsPluginSpec, adminPluginSpec]`. Adding a plugin therefore means editing
central files in two places. Make the **manifest file the single source of
truth** and let the build discover every `plugins/*/manifest.tsx` automatically
via Vite's `import.meta.glob`. After this brief, dropping a new folder under
`frontend/src/plugins/<id>/` with a valid `manifest.tsx` is enough — no central
list to touch.

This stays **fully static** (build-time discovery, one bundle). It is NOT
runtime/remote loading — `import.meta.glob` is resolved by Vite at build time and
compiled in exactly like the current explicit imports. Do NOT introduce module
federation, dynamic remote bundles, or filesystem scanning at runtime. See
`discuss/05` §4 (this is "Variant 1"); the per-user / local-folder model
(Variants 2–3) is explicitly out of scope and belongs to a later companion-app
brief.

Read FIRST (current source of truth you are restructuring):
- `frontend/src/plugins/registry.ts` — the hand-listed `PLUGINS` + `viewRegistry`.
- `frontend/src/plugins/catalog.ts` — `PLUGIN_SPECS`, the `*PluginSpec` consts,
  and every derived selector (`pluginById`, `pluginByRoute`, `visiblePlugins`,
  `visibleTabs`, `tabDefinitions`, `tabCatalog`, `defaultTabIdByPlugin`,
  `OPTIONAL_PLUGIN_IDS`, `SYSTEM_PLUGIN_IDS`, `PLUGIN_IDS`, …).
- `frontend/src/plugins/stagings/manifest.tsx`,
  `frontend/src/plugins/admin/manifest.tsx` — spread a spec imported from
  `catalog.ts` and add `element`s.
- `frontend/src/core/plugins/types.ts` — `PluginSpec` / `PluginManifest` /
  `PluginTab` contract.
- `frontend/src/constants.ts` — `PluginId` / `TabId` / `ViewKey` / `TabTitle`
  enums (these STAY; manifests keep referencing them — no inline literals).
- Consumers to leave importing from the SAME public modules (`@/plugins/registry`
  and `@/plugins/catalog`), so their import lines don't churn:
  `Sidebar.tsx`, `TabBar.tsx`, `Workspace.tsx`, `AppLayout.tsx`, `routes.tsx`,
  `WorkspaceContent.tsx`, `PluginsPage.tsx`, `store/uiStore.ts`.
- `CONVENTIONS.md` and brief 09 (enumerated constants; no inline literals) and
  brief 10 (the plugin host this builds on).

## Hard scope rules
- **In scope:** frontend only — make `plugins/<id>/manifest.tsx` self-contained,
  discover manifests with `import.meta.glob`, derive everything from the
  discovered set, add validation + a discovery test, update the READMEs.
- **No behavior change:** with the same two plugins and an admin user, sidebar,
  order, routes, tabs, persistence, and workspace render byte-for-byte as today.
- **OUT of scope (do NOT do):** any `backend/` or `agent/` change (the backend
  keeps its own `PluginId` / `OPTIONAL_PLUGIN_IDS` / `SYSTEM_PLUGIN_IDS` — "each
  layer carries its own enum"); runtime/remote/dynamic plugin loading; scanning
  real disk folders; per-user local plugin sets; new plugins beyond the two that
  exist; touching the `PluginId` / `TabId` / `ViewKey` / `TabTitle` enum values.
- English-only UI, dark theme, Mantine; enumerated constants per `CONVENTIONS.md`.

---

## Part A — Make each manifest self-contained (single source of truth)

Today the spec lives in `catalog.ts` and the manifest spreads it. Flip it: the
**manifest is the whole thing**. Each `plugins/<id>/manifest.tsx` exports a
complete `PluginManifest` (id, label, icon, route, kind, `adminOnly?`,
`requiresAgent?`, and `tabs` WITH their `element`s), referencing the existing
`PluginId` / `TabId` / `ViewKey` / `TabTitle` enums (no inline literals).

- Remove `stagingsPluginSpec` / `adminPluginSpec` / `PLUGIN_SPECS` from
  `catalog.ts`. The `STAGINGS_PLUGIN_ROUTE` / `ADMIN_PLUGIN_ROUTE` route
  constants move INTO their manifest files (still `as const`).
- `manifest.tsx` must import only from `@/constants`, `@/core/plugins/types`, and
  its own components — **never from `@/plugins/catalog` or `@/plugins/registry`**
  (that would create an import cycle with discovery). Enforce this ordering.
- **Discovery ordering is explicit, not glob order.** `import.meta.glob` key
  order is not a stable contract. Add `order: number` to `PluginManifest` (and
  `PluginSpec`) in `core/plugins/types.ts`; set `stagings` before `admin` to
  match today's sidebar order. Discovery sorts by `order` (ties broken by `id`
  for determinism).
- **Export convention:** each `manifest.tsx` `export default` its
  `PluginManifest`. Document this as THE contract a new plugin must satisfy.

## Part B — Discovery module

New `frontend/src/plugins/discovery.ts`:
- `const modules = import.meta.glob("./*/manifest.tsx", { eager: true })` →
  collect each module's `default` export.
- Sort by (`order`, then `id`).
- **Validate at module load (fail fast in dev/build), throwing a clear error:**
  - duplicate plugin `id`; duplicate `route`; duplicate `TabId`; duplicate
    `ViewKey` across all discovered plugins;
  - a plugin with zero tabs; a `system` plugin's default tab (`tabs[0]`) being
    `adminOnly` (would strand non-admins — cf. brief 10's bootstrap rule);
  - a module whose `default` export is missing/!isn't a `PluginManifest` shape.
- Export `export const PLUGINS: PluginManifest[]` (the sorted, validated list).

Keep the glob pattern anchored to `./*/manifest.tsx` so unrelated files under a
plugin folder are never picked up.

## Part C — Re-derive everything from `PLUGINS`; keep public surface stable

- `catalog.ts` now `import { PLUGINS } from "@/plugins/discovery"` and derives
  ALL selectors/collections from it (identical semantics to today):
  `PLUGIN_IDS`, `OPTIONAL_PLUGIN_IDS`, `SYSTEM_PLUGIN_IDS`, `pluginById`,
  `pluginByRoute`, `resolveEnabledOptionalPluginIds`,
  `enabledOptionalPluginIdSet`, `pluginVisible`, `tabVisible`, `visiblePlugins`,
  `visibleTabs`, `tabById`, `tabDefinitions`, `tabCatalog`,
  `defaultTabIdByPlugin`. (Note: these derive from the FULL `PluginManifest`
  list now; that's fine — element-carrying tabs are a superset of the old
  `PluginSpec` tabs.)
- `registry.ts` stays the **public barrel**: re-export the catalog selectors it
  re-exports today, plus `export { PLUGINS } from "@/plugins/discovery"` and keep
  `viewRegistry` (built from `PLUGINS`). No consumer import path changes.
- Delete the now-dead `PLUGIN_SPECS` references. `uiStore.ts` keeps importing the
  same names from `@/plugins/catalog`.
- Import-cycle guard: `manifest.tsx → constants/types/components`;
  `discovery.ts → (glob) manifests`; `catalog.ts → discovery`;
  `registry.ts → catalog + discovery`. One direction only.

## Part D — Tests

- `discovery.test.ts`: `PLUGINS` contains exactly `stagings` then `admin` in that
  order; ids/routes/viewKeys are unique; `stagings.requiresAgent === true`;
  `admin.kind === "system"`.
- A validation unit test: feed a hand-built array with a duplicate `id` / a
  duplicate `TabId` / a `system` plugin whose `tabs[0].adminOnly` is true through
  the validation helper (export it) and assert it throws. Do NOT try to make the
  real glob emit a bad module — test the pure validator directly.
- Existing `Sidebar.test.tsx` / `PluginsPage.test.tsx` / `uiStore` tests must
  still pass unchanged (proves no behavior change).

## Part E — Docs

`frontend/README.md`: update the "how to add a plugin" section — a new plugin is
now just a folder `plugins/<id>/` with a `manifest.tsx` that `export default`s a
`PluginManifest` (set `order`, reuse the enums); no central registry edit. Note
that discovery is build-time/static (Vite `import.meta.glob`), not runtime, and
that the backend still needs its own `PluginId` entry for an optional plugin.

---

## Gates (all must pass before done)
- Frontend: `cd frontend && npm run lint && npx tsc --noEmit && npm run test && npm run build`
- Backend (must stay green, unchanged): `cd backend && ruff check . && ruff format --check . && mypy app && pytest`
- Agent (must stay green, unchanged): `cd agent && ruff check . && ruff format --check . && mypy app && pytest`
- `npm run build` must confirm both manifests are bundled (glob resolved at build
  time; no dynamic/remote chunk introduced).

## Acceptance criteria (must all hold)
1. `PLUGINS` is produced by `import.meta.glob` discovery of
   `plugins/*/manifest.tsx`; no hand-maintained `PLUGINS` / `PLUGIN_SPECS` array
   and no per-plugin `*PluginSpec` const remain.
2. Each `plugins/<id>/manifest.tsx` is self-contained (`export default` a full
   `PluginManifest`, referencing the enums), importing nothing from
   `catalog.ts` / `registry.ts`.
3. Order is deterministic via manifest `order` (stagings before admin);
   validation throws on duplicate id/route/TabId/ViewKey, empty tabs, or a
   system plugin defaulting to an `adminOnly` tab.
4. Public import surface unchanged: consumers still import the same names from
   `@/plugins/registry` and `@/plugins/catalog`; no import cycles.
5. Zero behavior change: with `stagings` + `admin` and an admin user, the app is
   byte-for-byte identical to before (sidebar, order, routes, tabs, persistence).
6. Still fully static — no module federation, dynamic remote import, or runtime
   filesystem scan. No `backend/` or `agent/` changes; backend keeps its own
   `PluginId` / optional / system sets.
7. All three gate suites green; `frontend/README.md` "add a plugin" section
   updated.

## Out of scope (do NOT do)
- Runtime/remote/dynamically-loaded plugins; per-user or local-folder plugin sets
  (`discuss/05` Variants 2–3 — future companion-app brief).
- Any backend/agent change; new plugins; changing enum values; org-wide plugin
  availability catalog.

When done, ensure all three gate suites pass, then stop. Do not commit — the
reviewer inspects `git diff` and commits.
