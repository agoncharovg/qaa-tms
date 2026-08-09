# QAA-TMS Frontend

## Local run

Install dependencies and start the Vite dev server:

```bash
npm install
npm run dev -- --host 0.0.0.0 --port 3000
```

The SPA serves on `http://localhost:3000` and expects the backend on
`http://localhost:8000` by default.

## Stagings workflow

The Stagings section now includes five tabs:

- `Preflight`: probe the local companion app and inspect the staging prerequisite checklist.
- `Deploy`: submit a deploy recipe to the local agent, stream the live job log over authenticated fetch-SSE, and cancel a running job.
- `History`: browse recorded backend operations, inspect the stored recipe and full log, and replay only deploy operations by prefilling the Deploy tab.
- `Namespaces`: render cluster namespaces and local overlays as separate groups, inspect namespace status, load masked credentials on demand, tail live deployment logs, and start namespace-scoped `adopt` / `destroy` jobs from the detail drawer.
- `Sync`: submit the global `staging sync` flags form and watch the shared live job log panel used by deploy, destroy, adopt, and sync.

The Deploy and Sync tabs require the local companion app to be running on a
probed localhost port, because authenticated agent requests use the same Bearer
token as the central backend.

The Namespaces tab keeps the raw `staging list` output visible as the source of
truth while also showing the structured split between live cluster namespaces
and local-only overlays. Credentials stay local to the browser session: they
are fetched directly from the localhost agent, shown masked until revealed, and
are never persisted to localStorage or sent to the backend.

Every completed deploy, destroy, adopt, or sync job invalidates the History
query so the recorded backend operations refresh automatically.

## Docker Compose

From the repository root:

```bash
docker compose up --build frontend backend db
```

That starts Postgres, the FastAPI backend, and the Vite frontend together for
local development.

## Environment variables

- `VITE_API_BASE_URL`: base URL for the FastAPI backend. Default:
  `http://localhost:8000`
- `VITE_AGENT_PORTS`: local companion-app probe range. Default:
  `47600-47605`

No new frontend environment variables were added for the destroy/adopt/sync slice.
