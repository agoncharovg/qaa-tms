Implement **Phase 1a ONLY** from `discuss/.codex-brief-52-local-plugins.md`. Do not start any later phase (1b, 1c, 2, 3) — stop after Phase 1a is complete and green.

Read the full brief first (§0, §1, and the "PHASE 1a" section are the binding spec). Phase 1a is a **pure refactor with zero behavior change**: make the frontend plugin registry runtime-mutable by replacing the module-level constant plugin set and its derived maps with a runtime store, while builtin plugins keep working exactly as today.

Hard requirements:
- No behavior change with no local plugins: `plugins === BUILTIN_PLUGINS` and every derived map (`viewRegistry`, `tabDefinitions`, `tabById`, `tabCatalog`, `defaultTabIdByPlugin`, `PLUGIN_IDS`, `OPTIONAL_PLUGIN_IDS`, `SYSTEM_PLUGIN_IDS`) byte-identical to the current constants. Add a test asserting this.
- Add `setLocalPlugins()` that merges + sorts (by `order` then `id`) + dedupes with **builtin winning on collision** (drop the colliding local with a `console.warn`). Add a test for the merge/sort/dedupe.
- Keep `validatePluginManifests` / `definePlugin` validation and the uniqueness checks (id/route/tabId/viewKey) across the merged set.
- Update every importer of the old constants to the store/hook equivalents. The footprint is wide but mechanical (host.ts, Workspace.tsx, Sidebar.tsx, AppLayout.tsx, routes.tsx, admin/security, provider.tsx, etc.).

Do NOT: add the agent `/plugins` routes, the Profile setting, the runtime loader, `mount` rendering, RBAC-bypass, the SDK, or touch Notebook/Requests. Those are later phases.

Verification gates (all must pass, do not weaken types): in `frontend/` run eslint, `tsc --noEmit`, and vitest. Match the surrounding code's style and idioms. Keep the diff self-contained and reviewable.

When done, print a short summary of: files changed, the new store module's API, and confirmation that all three frontend gates pass.
