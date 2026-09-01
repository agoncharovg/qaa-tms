Targeted fix to Phase 1c of `discuss/.codex-brief-52-local-plugins.md`. Small, focused change — do not touch anything else, do not start Phase 2/3.

## The bug

`frontend/src/plugins/localPlugins.ts` loads each plugin bundle with a bare dynamic
`import(new URL(plugin.entryUrl, agentBaseUrl).href)` (see `defaultImportModule` /
`loadLocalPlugin`). A browser module `import()` does NOT send the companion Authorization
header, but the agent asset route `GET /plugins/{id}/assets/{path}` is `require_auth`
(`agent/app/api/routes.py:get_local_plugin_asset`, dep `_: AuthDep`). So in a real browser
every bundle import returns 401 and every local plugin is silently skipped. The unit tests
pass only because `importModule` is mocked.

## The fix (keep the asset route auth'd — do NOT make it public)

In the loader's default module-loading path, fetch the bundle WITH auth, then import it via
a same-origin blob URL (a `blob:` import needs no bearer header and no CORS):

1. Fetch the entry with `createAgentHeaders(token)` (same auth the `/plugins` metadata call
   already uses) via `fetch(new URL(plugin.entryUrl, agentBaseUrl).href, { headers, signal })`.
   Non-2xx → throw (so the existing warn-and-skip in `loadLocalPluginsFromAgent` handles it).
2. `const source = await response.text()`.
3. `const blobUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }))`.
4. `const module = await import(/* @vite-ignore */ blobUrl)` inside try/finally, and
   `URL.revokeObjectURL(blobUrl)` in the `finally`.
5. Thread `token` (and the abort `signal`) down to wherever the import happens — today
   `importModule` takes only a URL. Change the injected dep so the default implementation
   receives what it needs to do the authed fetch (e.g. make the default loader a function of
   `(plugin, agentBaseUrl, token, signal)`, and keep an injectable seam for tests that still
   lets a test stub the produced module without hitting the network).

Constraint this documents: local plugin bundles must be a single self-contained ESM file
(no relative sub-imports, no bare specifiers) — that is already the brief's model
(dist/index.js, React bundled in, host access via `MountContext`, not imports). Add a short
comment in the loader noting this.

## Tests

- Update/extend `frontend/src/plugins/localPlugins.test.ts`: assert the bundle is fetched
  with the Authorization header (mock `fetch`, check `createAgentHeaders(token)` was sent to
  the entry URL) and that a module produced from that fetch is used to build the manifest.
  Keep the existing fault-isolation tests (import throws / unsupported contractVersion →
  skipped) working against the new seam.
- A 401/non-ok bundle fetch → that plugin is skipped, siblings still load.

## Gates

Frontend `eslint`, `tsc --noEmit`, `vitest` must all pass. Do not weaken types (no `any`).
When done, print the changed files and confirm all three gates pass.
