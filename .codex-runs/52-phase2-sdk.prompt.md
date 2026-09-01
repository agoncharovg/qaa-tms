Implement **§2 (plugin SDK + example template)** from `discuss/.codex-brief-52-local-plugins.md`. Do not start Phase 2/3 (Notebook/Requests migration) — stop after §2 is complete and green.

Read the full brief first; §2 and §4 (LocalPluginModule contract) are binding. Prior phases 1a/1b/1c already landed (runtime registry store, agent `/plugins` scan+serve, frontend loader that fetches each bundle WITH the companion auth header and imports it via a same-origin `blob:` URL). The loader expects each plugin's `dist` entry to be a **single-file self-contained ESM** whose default export is a `LocalPluginModule`:

```ts
interface LocalPluginModule {
  contractVersion: number;
  mount(viewKey: string, ctx: MountContext): Unmount; // render into ctx.container, return cleanup
}
```

Goal of §2: let external plugin authors build a plugin in `~/Projects/qaa-tms-plugins/<name>/`
WITHOUT importing the host app's `@/...` internals — by consuming a small published SDK — and
ship a working example that also serves as the copy/symlink template. Keep everything INSIDE
the repo (reviewable via git diff); the user copies/symlinks the built example into their
`AGENT_LOCAL_PLUGINS_DIR`.

### Deliverables

1. **SDK package** at `sdk/` (name it e.g. `@qaa-tms/plugin-sdk`), no host React:
   - Contract TYPES mirroring the host: `HostApi`, `ThemeTokens`, `MountContext`, `Unmount`
     (currently in `frontend/src/core/plugins/host.ts`), the plugin-manifest metadata types
     and `PluginKind`/`PluginOrigin`/`NavSection` shapes (from `frontend/src/core/plugins/types.ts`
     + `frontend/src/constants.ts`), and the `LocalPluginModule` type (§4).
   - Runtime: `CONTRACT_VERSION` and `isSupportedContractVersion` (mirror
     `frontend/src/core/plugins/definePlugin.ts`), plus a thin typed **agent-fetch helper**
     built from `MountContext` (resolve `agentBaseUrl` + attach the auth the host already uses;
     the SDK helper only needs the base URL from ctx — the host injects auth at the bundle-fetch
     layer, so the plugin's own agent calls should send the token the same way — expose a helper
     that takes a token/headers the plugin obtained, do not invent a new auth path).
   - `package.json` + `tsconfig` + build to ESM with type declarations (tsup or vite lib mode —
     the repo already uses Vite, prefer that). Provide a README documenting the build recipe and
     the single-file-bundle requirement.
   - **Drift guard:** add a compile-time/type test (in the frontend, e.g. a `*.test-d.ts` or a
     small vitest type assertion) that the SDK's `HostApi`/`MountContext`/`LocalPluginModule` are
     structurally assignable to/from the host's own types, so the two never silently diverge.

2. **Example plugin** at `sdk/examples/hello-plugin/`:
   - `plugin.json` per §1 schema (id e.g. `hello`, one tab, route `/hello`, contractVersion =
     `CONTRACT_VERSION`, `entry: "dist/index.js"`), `src/` implementing a trivial `mount()` that
     renders a "Hello from a local plugin" view into `ctx.container` using ITS OWN bundled React
     and reading a theme token from `ctx.host.theme.getTokens()`.
   - Build config producing a **single self-contained `dist/index.js` ESM** (React bundled in,
     no code-splitting, no externals, no bare specifiers) — e.g. Vite lib mode with
     `build.rollupOptions.output.inlineDynamicImports = true`, format `es`, and React NOT
     externalized. Verify the output is one JS file.
   - A short README: `npm i && npm run build`, then `ln -s $(pwd) ~/Projects/qaa-tms-plugins/hello`
     (or copy), set the folder in Profile → Settings, reload the portal.

3. Do NOT change the host loader/agent from Phase 1c; the example must work against them as-is.
   If you discover a real incompatibility, note it precisely rather than silently changing 1a–1c.

### Gates

- SDK + example: `tsc`/build succeed; the example actually builds to a single `dist/index.js`
  (run the build and confirm the file exists and is one file).
- Frontend still green: `eslint`, `tsc --noEmit`, `vitest` (including the new drift-guard type test).
- Do not weaken types.

When done, print: the SDK's public surface, where the example lives + how to install it, the
drift-guard mechanism, confirmation the example builds to a single-file ESM, and that all gates pass.
