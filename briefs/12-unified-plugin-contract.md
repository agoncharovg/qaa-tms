# Brief 12 — Unified plugin contract (builtin only; no runtime loading yet)

Lock the plugin contract from `discuss/06` in code by putting the two existing
**builtin** plugins onto it, as a **behavior-preserving refactor**. This
introduces `definePlugin` / `HostApi` / `MountContext`, turns `icon` into a
string key resolved by a host icon registry, and adds `origin` /
`contractVersion` to the manifest — so that the future "local plugin" slice is
purely additive (a second discovery source + a second render transport) and does
NOT require touching the shell or the shipping plugins again.

This brief does **not** add any runtime/remote loading, iframe, postMessage
transport, agent `/plugins` index, or local-plugin discovery. Those are the
NEXT (larger) slice. Here everything stays in-process and compiled in.

Builds on brief 10 (plugin host) and brief 11 (glob autodiscovery). If brief 11
is not yet landed, this brief still applies — just keep whatever assembles
`PLUGINS` and add the contract on top.

Read FIRST:
- `frontend/src/core/plugins/types.ts` — `PluginKind` / `PluginSpec` /
  `PluginManifest` / `PluginTab` (the contract you are extending).
- `frontend/src/plugins/stagings/manifest.tsx`,
  `frontend/src/plugins/admin/manifest.tsx` — the two builtin manifests.
- `frontend/src/plugins/catalog.ts`, `frontend/src/plugins/registry.ts` (and
  `discovery.ts` if brief 11 landed) — assembly + selectors.
- `frontend/src/app/layout/Sidebar.tsx`, `frontend/src/plugins/admin/PluginsPage.tsx`
  — the two `plugin.icon` render sites.
- `frontend/src/components/WorkspaceContent.tsx` — `viewRegistry[tab.viewKey]`
  render site (becomes the single render adapter).
- `frontend/src/constants.ts` — enums; you add `IconName`, `PluginOrigin`,
  `CONTRACT_VERSION` here (or under `core/plugins/`), enumerated per brief 09.
- `discuss/06` §3 (the three-layer contract), §4 (builtin superset), §5 (render
  adapter), §8 (exactly this migration).
- `CONVENTIONS.md` + brief 09 — no inline string/number literals.

## Hard scope rules
- **In scope:** frontend only. Introduce the contract types + `definePlugin` +
  in-process `HostApi`; icon-string registry; `origin` + `contractVersion` on the
  manifest; a single origin-keyed render adapter; migrate the two builtin
  manifests; tests; docs.
- **No behavior change:** with `stagings` + `admin` and an admin user, sidebar,
  icons, order, routes, tabs, persistence, and workspace render byte-for-byte as
  today. This is a refactor, not a feature.
- **OUT of scope (do NOT do):** any runtime/remote/dynamic loading, iframe,
  postMessage, sandbox, agent `/plugins` index, local-plugin discovery,
  client-side local enablement (all → next slice, `discuss/06` §6–7); any
  `backend/` or `agent/` change (they don't know icons/contract); new plugins;
  changing `PluginId` / `TabId` / `ViewKey` / `TabTitle` values.
- English-only UI, dark theme, Mantine, enumerated constants.

---

## Part A — Contract types + `definePlugin` (`core/plugins/`)

**A1. Extend the manifest** in `core/plugins/types.ts`:
- `PluginOrigin` const object: `BUILTIN = "builtin"`, `LOCAL = "local"` (+ union
  type). Add `origin: PluginOrigin` to `PluginSpec`/`PluginManifest`.
- Add `contractVersion: number` to the manifest.
- Change `icon` from `TablerIcon` to `IconName` (a string key — see Part B).
- Keep tabs' builtin `element?: ReactNode` fast-path. Additionally allow a
  future `mount` (see A3) — a tab/plugin renders via EITHER a supplied `element`
  OR a `mount` function, never both.

**A2. `HostApi` / `MountContext` / `Unmount`** (new `core/plugins/host.ts`):
```ts
type Unmount = () => void;
interface ThemeTokens {           // flat, serialisable (ready to cross an iframe later)
  colorScheme: string;            // "dark"
  primaryColor: string;
  background: string; surface: string; text: string; dimmed: string; border: string;
  radius: string; spacing: string; fontFamily: string;
}
interface HostApi {
  contractVersion: number;
  theme: { getTokens(): ThemeTokens; subscribe(cb: (t: ThemeTokens) => void): Unmount };
  view: { setTitle(title: string): void; setBusy(busy: boolean): void; requestResize(px: number): void };
  nav: { openTab?(tabId: TabId): void };
  // DELIBERATELY absent: auth token, backend client, credentials (discuss/06 §1 rule П1).
}
interface MountContext { container: HTMLElement; viewKey: ViewKey; host: HostApi; agentBaseUrl?: string }
```
`ThemeTokens` MUST be a plain, JSON-serialisable object (no React/Mantine
objects) so the same shape survives a postMessage boundary in the next slice.

**A3. `definePlugin`** (new `core/plugins/definePlugin.ts`):
- `definePlugin(input): PluginManifest` — an identity + validation helper that
  every manifest passes through. Accepts the manifest data and per-tab either an
  `element` (builtin fast-path) or a `mount(ctx: MountContext) => Unmount`.
- Validate at call time (throw a clear error): `contractVersion` present and in
  the host-supported range; each tab has exactly one of `element` / `mount`;
  ids/viewKeys within the plugin are unique. (Cross-plugin uniqueness stays in
  discovery — brief 11.)
- Export `CONTRACT_VERSION` (current host version) and a supported-range check.

## Part B — Icon registry (string key, not a component)

**B1.** `IconName` enum (`StrEnum`-style `as const`) in `constants.ts` with the
names actually used today: `ROCKET`, `SETTINGS` (map to `IconRocket`,
`IconSettings`). No inline strings.

**B2.** `core/plugins/icons.ts` — `ICON_REGISTRY: Record<IconName, TablerIcon>`
plus `resolveIcon(name): TablerIcon` returning a documented fallback icon for an
unknown name (never throw at render — a bad local manifest later must degrade,
not crash the shell).

**B3.** Rewire the two render sites: `Sidebar.tsx` and `PluginsPage.tsx` render
`const Icon = resolveIcon(plugin.icon)` → `<Icon size={18} />` instead of
`<plugin.icon .../>`. No visual change (same icons).

## Part C — Migrate the two builtin manifests

- `stagings/manifest.tsx` and `admin/manifest.tsx` are authored via
  `definePlugin({...})`, with `origin: PluginOrigin.BUILTIN`,
  `contractVersion: CONTRACT_VERSION`, `icon: IconName.ROCKET` / `IconName.SETTINGS`.
- Tabs keep their existing `element: <StagingsSection .../>` / `<PluginsPage/>` /
  `<UsersPage/>` (builtin fast-path) — identical to today.
- Keep `order` (brief 11), `kind`, `adminOnly`, `requiresAgent` unchanged.

## Part D — Single origin-keyed render adapter

Centralise tab rendering so the local transport slots in later without touching
callers. In `WorkspaceContent.tsx` (or a small `PluginTabView` it delegates to):
```
switch (plugin.origin) {
  case BUILTIN: render the tab's element (today's viewRegistry[viewKey] path);
  case LOCAL:   throw / render a clear "local plugins not yet supported" notice
                — unreachable today (no local plugins exist). Leave a TODO
                referencing discuss/06 §5–6. Do NOT implement an iframe here.
}
```
Behavior for the two builtin plugins is byte-for-byte today's `viewRegistry`
lookup. Keep `viewRegistry` as the builtin element source.

## Part E — In-process `HostApi` implementation + tests

**E1.** Provide the builtin/in-process `HostApi` (`core/plugins/host.ts` or a
small provider): `theme.getTokens()` maps the app's Mantine dark theme to
`ThemeTokens`; `subscribe` fires on theme change (dark-only today → may be a
register-and-hold, but must be wired, not a lie); `view.setTitle/setBusy` and
`nav.openTab` back onto existing shell state where one exists, else safe no-ops.
The two shipping plugins use the `element` path and do NOT depend on `HostApi`,
so shell behavior is unchanged.

**E2. Tests (Vitest + RTL):**
- Contract works in-process end-to-end WITHOUT changing the shipped app: build a
  trivial throwaway plugin via `definePlugin` with a `mount(ctx)` tab that draws
  into `ctx.container` and reads `ctx.host.theme.getTokens()`; assert it mounts,
  renders, reads tokens, and its returned `Unmount` cleans up. (Constructed in
  the test only — NOT registered in `PLUGINS`.)
- `definePlugin` validation throws on: missing `contractVersion` / out-of-range;
  a tab with both `element` and `mount`; a tab with neither.
- `resolveIcon(IconName.ROCKET)` → `IconRocket`; unknown name → the fallback
  (no throw).
- Existing `Sidebar.test.tsx` / `PluginsPage.test.tsx` / `uiStore` tests pass
  unchanged (proof of no behavior change).

## Part F — Docs

`frontend/README.md`: document the contract a plugin implements — `definePlugin`,
manifest fields (`origin`, `contractVersion`, `icon` name), the builtin `element`
fast-path vs the `mount(ctx)` + `HostApi` path, and that `HostApi` intentionally
exposes only chrome/theme (no app token/backend — `discuss/06` §1). State clearly
that only `origin: "builtin"` is wired today; `"local"` is reserved for the next
slice.

---

## Gates (all must pass before done)
- Frontend: `cd frontend && npm run lint && npx tsc --noEmit && npm run test && npm run build`
- Backend (unchanged, must stay green): `cd backend && ruff check . && ruff format --check . && mypy app && pytest`
- Agent (unchanged, must stay green): `cd agent && ruff check . && ruff format --check . && mypy app && pytest`

## Acceptance criteria (must all hold)
1. Contract exists in code: `definePlugin`, `HostApi`, `MountContext`, `Unmount`,
   `ThemeTokens` (JSON-serialisable), `CONTRACT_VERSION`; both builtin manifests
   are authored through `definePlugin` with `origin: "builtin"` and
   `contractVersion: CONTRACT_VERSION`.
2. `icon` is a string `IconName` resolved via a host icon registry with a
   safe fallback; `Sidebar` / `PluginsPage` render identical icons to today.
3. Tab rendering goes through one origin-keyed adapter; `"builtin"` behaves
   exactly as today's `viewRegistry`; `"local"` is guarded/unreachable (no
   iframe, no runtime loading present).
4. The contract is provably exercisable in-process: a test mounts a
   `definePlugin` `mount(ctx)` plugin, reads `host.theme.getTokens()`, and
   unmounts — without the two shipping plugins depending on `HostApi`.
5. Zero behavior change for `stagings` + `admin` (sidebar, icons, order, routes,
   tabs, persistence, workspace identical). No `backend/` or `agent/` change. No
   runtime/remote/iframe/postMessage code.
6. All three gate suites green; `frontend/README.md` documents the contract and
   that `"local"` is reserved for the next slice.

## Out of scope (do NOT do)
- Runtime/remote/local plugin loading; iframe/sandbox/postMessage; agent
  `/plugins` index; client-side local enablement (`discuss/06` §6–7 — next slice).
- Any backend/agent change; new plugins; changing enum values.

When done, ensure all three gate suites pass, then stop. Do not commit — the
reviewer inspects `git diff` and commits.
