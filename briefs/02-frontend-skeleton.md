# Brief 02 — Frontend skeleton (React + Mantine layout, auth, Stagings preflight)

You implement the SECOND slice of QAA-TMS: the frontend skeleton. Read
`CONVENTIONS.md`, `discuss/02`, and `discuss/04` first — they are the source of
truth. The backend from slice 01 already exists under `backend/` (FastAPI,
`/api/v1/auth/login`, `/api/v1/me`, `/api/v1/operations…`, `/health`, `/ready`)
— build the client against it, do NOT modify the backend. The companion-app
agent does NOT exist yet (that is slice 03); build the agent client against the
CONTRACT in `discuss/04 §5` and degrade gracefully when no agent is detected.

## Stack (fixed — do not substitute)
- Vite + React 18 + TypeScript (strict).
- Mantine v7 (AppShell, Tabs, Navbar, dark theme by default).
- React Router v6.
- TanStack Query v5 for SERVER state (backend + agent calls).
- Zustand for CLIENT/session state (auth session, sidebar collapsed, per-section
  tabs), with the pieces that must survive reload persisted to `localStorage`.
- Lint/type: ESLint + `tsc --noEmit`, both clean.
- Tests: Vitest + React Testing Library (a handful of meaningful tests).

## Repository layout (create under `frontend/`)
Follow `discuss/02 §3`:
```
frontend/
  index.html
  package.json
  tsconfig.json
  vite.config.ts
  .env.example                 # VITE_API_BASE_URL, VITE_AGENT_PORTS
  Dockerfile
  src/
    main.tsx
    App.tsx                    # providers (Query, Mantine, Router) + routes
    constants.ts               # ALL enumerated strings (see CONVENTIONS.md)
    app/
      layout/
        AppLayout.tsx          # 3-zone shell: Sidebar + TabBar + Workspace
        Sidebar.tsx
        TabBar.tsx
        Workspace.tsx
      routes.tsx               # route table
      guards.tsx               # RequireAuth / RequireAdmin
    store/
      authStore.ts             # session token, current user, remember/auto-login
      uiStore.ts               # sidebar collapsed, tabs per section
    api/
      backendClient.ts         # thin typed client to /api/v1 (adds Bearer)
      agentClient.ts           # thin client to the local agent (discovery + calls)
      types.ts
    features/
      auth/
        LoginPage.tsx
      stagings/
        StagingsSection.tsx
        PreflightPanel.tsx
      admin/
        UsersPage.tsx          # admin-only
    components/                # reusable UI (e.g. content-type renderer)
      WorkspaceContent.tsx     # renders by content type (react-view|iframe|html)
```

## Constants — `src/constants.ts` (per CONVENTIONS.md)
TS has no StrEnum; use `as const` objects + string-literal union types (NO stray
literals for these elsewhere):
- `SectionKey`: `stagings`, `admin`.
- `ContentType`: `react-view`, `iframe`, `html` (Workspace renders by this;
  forward-looking hook from `discuss/02 §2`).
- `RoutePath`: `/login`, `/`, section paths.
- `StorageKey`: keys for token, remember-me, auto-login, sidebar-collapsed, tabs.
- `BackendPath`: `/api/v1/auth/login`, `/api/v1/me`, `/api/v1/operations`, etc.
- `AgentPath`: `/ping`, `/preflight`, `/deploy`, `/jobs/{id}/stream`, … (per
  `discuss/04 §5`).
- `PreflightKey`: the checklist keys from `discuss/04 §6` (tools,
  clusterReachable, vpn, kubeconfig, dockerHarbor, dockerStaging, harborPull,
  submodules, venv, repoInstalled).
- Config: `AGENT_HOST = "127.0.0.1"`, default agent port range `47600..47605`.

## Layout — the three zones (`discuss/02 §2`)
1. **Sidebar** (left): icon + label items; collapses to icons only; collapsed
   state persisted in `localStorage`. Switches the ACTIVE SECTION. Profile +
   Logout live at the BOTTOM (per `discuss/02` answers). "Administration"
   section item is visible ONLY when `user.is_admin`.
2. **TabBar** (top): Chrome-style tabs — open / close / switch. Tabs are
   PER-SECTION and independent (switching sections restores that section's own
   tab set). Each tab = one open screen inside the section.
3. **Workspace** (center): renders the active tab's content via
   `WorkspaceContent`, dispatching on `ContentType` (`react-view` primary;
   `iframe` and `html` supported as simple renderers now — no security
   hardening yet).

Two independent levels: Sidebar = section navigation; TabBar = tabs within the
section. Do NOT collapse "menu item = tab".

## Auth (`discuss/02` answers + `discuss/04 §4`)
- `LoginPage`: username + password. Calls `POST /api/v1/auth/login`, stores the
  bearer token + current user in `authStore`.
- "Remember login/password" checkbox — persist to `localStorage` so the user is
  not re-prompted (dev-stub requirement; add a `// dev-stub` note that storing a
  password client-side is temporary until real SSO).
- "Log in automatically" flag — on app load, if set and credentials remembered,
  auto-login. (Backend `User.auto_login` exists; treat the client flag as the
  source of truth for the skeleton.)
- Logout (sidebar bottom) clears session → back to `/login`.
- `RequireAuth` guards the app; `RequireAdmin` guards `admin` routes.
- Backend base URL from `VITE_API_BASE_URL` (default `http://localhost:8000`).

## Sections for this slice
- **Stagings** (default landing after login): renders `PreflightPanel`.
  - `agentClient` discovers the agent by probing `GET http://127.0.0.1:<port>/ping`
    over the configured port range; on match, calls `GET /preflight` (Bearer =
    TMS token) and renders the checklist from `discuss/04 §6` (each item:
    ok/not-ok + hint).
  - If NO agent is detected: show a clear "Companion app is not running" state
    with a Retry action (per `discuss/04 §3`). Do NOT crash. (The agent doesn't
    exist yet — this empty/absent state is the expected result for now.)
  - Include a placeholder tab for "Namespaces" that shows a "requires companion
    app" empty state. No real deploy/destroy forms yet.
- **Administration → Users** (admin only): list users. There is no backend list
  endpoint yet, so render the CURRENT user as a single-row table plus a clear
  "full user management coming in a later slice" note. Do NOT invent a backend
  endpoint or modify the backend.

## docker-compose
Uncomment/replace the `frontend` placeholder in the root `docker-compose.yml`:
- `frontend` service builds from `frontend/Dockerfile`, runs the Vite dev server
  on port **3000** (backend already allows `http://localhost:3000` +
  `http://127.0.0.1:3000` in CORS), env `VITE_API_BASE_URL=http://localhost:8000`.
- Keep `db` and `backend` as-is.

## Acceptance criteria (must all hold)
1. `npm install` then `npm run dev` serves the SPA on `http://localhost:3000`.
2. Login with `admin`/`admin` → main window; the "Administration" section item
   is visible; `test` with empty password → main window WITHOUT the admin item.
3. Sidebar collapses/expands and the state survives a reload (localStorage).
4. Tabs: open, close, and switch within a section; switching sections preserves
   each section's own tabs.
5. Stagings shows the preflight screen; with no agent running it shows the
   "companion app not running" state (not an error/crash).
6. Logout returns to `/login`; with "auto-login" + remembered credentials the
   app logs in automatically on reload.
7. `eslint` and `tsc --noEmit` pass clean; `vitest` passes and includes at
   least: auth store login/logout, admin-gating of the Administration item,
   sidebar-collapse persistence, and tab open/close/switch reducer logic.
8. All user-facing strings are English; enumerated strings live in
   `src/constants.ts` (no stray literals). Dark theme by default.
9. `frontend/README.md` documents local run (npm + docker-compose) and the env vars.

## Out of scope (do NOT do)
- Any backend change. Real staging operations, deploy/destroy/e2e wizards.
- Real OIDC. Iframe security hardening. A real users-list backend endpoint.
- Implementing the agent itself (slice 03) — only its client + graceful absence.

When done, ensure `npm install`, `npm run build`, `tsc --noEmit`, `eslint`, and
`vitest` all succeed, then stop. Do not commit — the reviewer inspects
`git diff` and commits.
