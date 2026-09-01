Targeted fix to brief 52 §2 (the plugin SDK example). Small, focused — do not touch anything else.

## The bug (found via a live browser test)

The example plugin `sdk/examples/hello-plugin` builds to a single-file ESM with React bundled
in, and the agent serves it correctly, but importing it in a real browser throws
`ReferenceError: process is not defined`. Cause: the Vite lib build leaves `process.env.NODE_ENV`
references in the bundled React code, and `process` does not exist in the browser. (Verified: the
loader fetches the bundle 200 OK as text/javascript, 747557 bytes, then `import(blobUrl)` fails
with "process is not defined".)

## Fix

In `sdk/examples/hello-plugin/vite.config.ts`, define the Node globals that bundled React needs
so no `process` reference survives into the output:

```ts
define: {
  "process.env.NODE_ENV": JSON.stringify("production"),
  "process.env": "{}",
},
```

(Keep the existing single-file ESM setup: `build.lib` es format, `rollupOptions.output.inlineDynamicImports = true`, React NOT externalized.) Rebuild `dist/index.js` and confirm:
- it is still a single file, and
- `grep -c "process.env.NODE_ENV" dist/index.js` is 0 (no unresolved `process.env.NODE_ENV` left)
  and there is no bare `process.` reference that would throw at module-eval time.

## Also document it (so Notebook/Requests don't repeat it)

Add a short note to `sdk/README.md` (and/or the hello-plugin README): any local plugin that
bundles React MUST define `process.env.NODE_ENV` in its build, or it will throw
`process is not defined` when the portal imports it. This is part of the "single self-contained
ESM" contract.

## Gates

- `cd sdk/examples/hello-plugin && npm run build` succeeds and produces one `dist/index.js`.
- Frontend unchanged; no need to run its full suite, but do not break `tsc`.

When done, print the changed files and the `grep -c "process.env.NODE_ENV" dist/index.js` result (must be 0).
