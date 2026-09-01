Implement **Phase 1c ONLY** from `discuss/.codex-brief-52-local-plugins.md`. Do not start Phase 2/3 — stop after Phase 1c is complete and green.

Read the full brief first. §0, §1, §4 (the LocalPluginModule contract), and the "PHASE 1c" section are binding. Prior phases already landed:
- Phase 1a: the plugin registry is a runtime store (`frontend/src/plugins/pluginRegistryStore.ts`) with `setLocalPlugins()`; `WorkspaceContent.tsx` already switches on `plugin.origin` and has a `PluginOrigin.LOCAL` **placeholder** case to replace.
- Phase 1b: the agent serves `GET /plugins` (metadata + `entryUrl` per plugin + warnings) and `GET /plugins/{id}/assets/{path}` (require_auth only). Frontend `AgentPingResponse`/settings already know the agent.

Phase 1c scope (frontend: load, render, RBAC-exempt):

1. **Loader** `frontend/src/plugins/localPlugins.ts`:
   - After auth + agent detection (reuse the existing companion/agent-base-url plumbing — `useCompanionStatus`, `MountContext.agentBaseUrl`, agent-port resolution in `frontend/src/core/runtimeConfig.ts` / `agentClient`), fetch `GET {agentBaseUrl}/plugins`.
   - For each returned plugin, dynamic-`import(/* @vite-ignore */ new URL(entryUrl, agentBaseUrl).href)` to load its ESM module. The module default export is a `LocalPluginModule` (§4): `{ contractVersion: number; mount(viewKey: string, ctx: MountContext): Unmount }`.
   - Build a `PluginManifest` per plugin with `origin: PluginOrigin.LOCAL`, `kind: PluginKind.OPTIONAL`, and **mount-based tabs**: each tab's `mount(ctx)` delegates to `module.mount(tab.viewKey, ctx)`.
   - Validate each with `definePlugin` / `validatePluginManifests` and `isSupportedContractVersion` BEFORE registering. On any failure (bad fetch, import throw, invalid manifest, unsupported contractVersion) → `console.warn` + skip that plugin; one bad plugin must never blank the portal.
   - Call `setLocalPlugins(loaded)`. Re-run when the agent base URL changes; clear local plugins on logout / agent loss.
   - Wire the loader into the app lifecycle (a hook/effect mounted once the user is authenticated and the companion is available). Do not block initial render on it.

2. **Render `mount()` tabs for LOCAL plugins**: replace the placeholder `PluginOrigin.LOCAL` case in `frontend/src/components/WorkspaceContent.tsx` with a real mounted view — reuse/generalize the existing `MountedBuiltinPluginTab` pattern (create a container div, build a `MountContext` from `useBuiltinHostApi()` + the agent base URL + viewKey, call `tab.mount(ctx)` on mount, run the returned `Unmount` on unmount/viewKey change).

3. **RBAC exemption**: in `frontend/src/plugins/catalog.ts` `pluginVisible`, if `plugin.origin === PluginOrigin.LOCAL` → visible for any logged-in user (skip `enabledOptionalIds` membership and `pluginPermitted`). Confirm Profile → Plugins toggles and Admin → Security iterate only builtin / `OPTIONAL_PLUGIN_IDS` (not the merged store) so local plugins never appear there — adjust if needed.

Do NOT: extract the standalone SDK package (§2), or touch Notebook/Requests (Phases 2/3). Keep local plugins loading against the inline `LocalPluginModule` type defined here.

Verification gates (all must pass, do not weaken types): frontend `eslint`, `tsc --noEmit`, `vitest`. Add tests: loader builds LOCAL manifests from a mocked `/plugins` response and skips a plugin whose import throws / whose contractVersion is unsupported (fault isolation); `pluginVisible` returns true for a LOCAL plugin even for a user with no permissions and empty `enabled_plugins`; a mount tab renders via `mount()` and cleans up. Verify cross-origin dynamic `import()` of the agent asset works with the agent's CORS (note any assumption).

When done, print a short summary: files changed, the loader's lifecycle wiring, how mount tabs render, the RBAC-exemption point, and confirmation all three gates pass.
