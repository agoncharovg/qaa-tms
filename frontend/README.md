# QAA-TMS Frontend

The SPA shell is now a static plugin host. Sidebar items, plugin routes, tab catalogs,
and workspace views are derived from plugin metadata instead of hardcoded section enums.

## Local run

Install dependencies and start the Vite dev server:

```bash
npm install
npm run dev -- --host 0.0.0.0 --port 3000
```

The SPA serves on `http://localhost:3000` and expects the backend on
`http://localhost:8000` by default.

## Plugin model

Two plugin classes exist in this slice:

- `system`: always visible to authenticated users and never toggleable. `Administration` is the only system plugin.
- `optional`: visible only when the current user enables it for themselves. `Stagings` is the only optional plugin.

Static metadata lives in `src/plugins/catalog.ts`. React view wiring lives in
`src/plugins/*/manifest.tsx`, and `src/plugins/registry.ts` provides the
`viewRegistry` used by the workspace.

To add a plugin:

1. Extend `src/plugins/catalog.ts` with the plugin id, route, icon, kind, and tab specs.
2. Create `src/plugins/<plugin-id>/manifest.tsx` and supply the tab `element` nodes.
3. Place the actual screen code under `src/plugins/<plugin-id>/`.

The shell keeps `TabId` and `ViewKey` stable, so localStorage tab persistence stays
compatible while the plugin registry becomes the source of truth.

## Administration workflow

`Administration` is available to every authenticated user.

- `Plugins` tab: self-service enable/disable screen for optional plugins. Toggling calls
  `PUT /api/v1/me/plugins`, updates the Zustand auth state immediately, and the sidebar
  reacts without a reload.
- `Users` tab: admin-only user management surface backed by `/api/v1/users`.

Non-admin users see only the `Plugins` tab. Admin users can additionally open `Users`.

## Stagings workflow

The `Stagings` optional plugin exposes six tabs:

- `Preflight`: probe the local companion app and inspect the staging prerequisite checklist.
- `Deploy`: submit a deploy recipe to the local agent, stream the live job log over authenticated fetch-SSE, and cancel a running job.
- `History`: browse recorded backend operations, inspect the stored recipe and full log, and replay deploy operations by prefilling the Deploy tab.
- `Namespaces`: render cluster namespaces and local overlays as separate groups, inspect namespace status, load masked credentials on demand, tail live deployment logs, and start namespace-scoped `adopt` / `destroy` jobs from the detail drawer.
- `Sync`: submit the global `staging sync` flags form and watch the shared live job log panel used by deploy, destroy, adopt, and sync.
- `E2E`: choose a product, load its named suite registry from the agent, select suites, submit `{ ns, product, suites[], threads? }`, and watch the shared live job log panel for the `staging e2e-run` job.

The Deploy, Sync, Namespaces, and E2E workflows depend on the local companion app being
reachable on a probed localhost port, because authenticated agent requests reuse the same
Bearer token as the central backend.

## Docker Compose

From the repository root:

```bash
docker compose up --build frontend backend db
```

That starts Postgres, the FastAPI backend, and the Vite frontend together for local development.

## Environment variables

- `VITE_API_BASE_URL`: base URL for the FastAPI backend. Default: `http://localhost:8000`
- `VITE_AGENT_PORTS`: local companion-app probe range. Default: `47600-47605`
