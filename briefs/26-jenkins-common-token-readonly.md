# Brief 26 — Jenkins common read-only token: agent-free views for non-QAA users

Binding: follow `CONVENTIONS.md` exactly (no inline string literals — model as
`StrEnum` / TS literal unions; global constants in the dedicated modules; UI text
in English; ruff+mypy clean for Python, eslint+`tsc --noEmit` clean for TS; API
under `/api/v1`; 12-factor config, no secrets committed).

Design and accepted decisions live in `discuss/13`. Read it first. Prerequisite
already verified: the backend pod in `qaa-preprod` can reach `jenkins.p.gc.onl`
(egress returns HTTP 403 = reachable). This brief is a follow-up to brief 25 and
adjusts the companion gating that brief 25 introduced.

## Goal

Let the backend serve read-only Jenkins views (tree / builds / folder / scope)
using a shared read-only token, so users without the companion agent — including
non-QAA users — can view the Jenkins explorer and Smoke statistics out of the
box. All mutating operations (Freeze/Resume) and every personal-scoped plugin
stay agent-only under the engineer's personal token. The common token must never
touch a write path.

## Current architecture (ground truth, 2026-08-20)

- Read Jenkins already flows through a read-through cache in the backend:
  `backend/app/api/v1/jenkins.py` (GET/PUT tree/builds/folder),
  `backend/app/services/jenkins_cache.py`. Reading the cache does NOT need an
  agent.
- But the cache is filled by the AGENT under the personal token: the frontend
  `useCachedJenkinsResource.ts` calls `fetchLive()` via the agent on
  `stale + refreshLease` and PUTs the result back. `scope`/`signature` also come
  from the agent (`getJenkinsScope`).
- The whole Jenkins section is hard-gated on the agent (brief 25 wraps it in
  `CompanionGate`; before that `discoverAgent()`).
- The backend never calls Jenkins itself today (no httpx to Jenkins).
- The Jenkins fetch/parse logic (tree build, color→status, scope signature)
  lives in `agent/app/services/jenkins.py`.
- Freeze/Resume: the backend stores state/campaigns
  (`backend/app/api/v1/jenkins_freeze.py`, `jenkins_resume_run.py`,
  models/schemas), but the actual Jenkins mutation is performed by the AGENT
  under the personal token (`agent/app/services/jenkins.py`
  freeze_folder/resume_folder/run_resume_campaign). Keep this unchanged.

## Hard boundary (non-negotiable)

- Common token: READ ONLY — tree, builds, folder, scope. Never freeze, resume,
  enable/disable, build-trigger, or any POST/PUT to Jenkins.
- Personal token (via agent): everything mutating + all personal plugins
  (Kuber / Stagings / QAA).
- The common token and personal token code paths must be separate and obvious.
  Do not thread the common token anywhere near freeze/resume.

---

## Part A — Backend: Jenkins client + common-token read-through

### A1. Config / secrets
Add backend settings (env, 12-factor; `EnvKey` + `Settings` + defaults):
- `JENKINS_COMMON_URL` (default `https://jenkins.p.gc.onl`).
- `JENKINS_COMMON_USERNAME`, `JENKINS_COMMON_TOKEN` (basic-auth pair; empty by
  default → feature disabled, backend does not fetch).
- Backend-side default scope (shared/global, since it must work without any
  agent): `JENKINS_ROOT_GROUPS`, `JENKINS_ROOT_FOLDERS`, `JENKINS_TREE_DEPTH`,
  `JENKINS_HISTORY_LIMIT`, plus a request timeout. Mirror the agent defaults
  (`agent/app/core/constants.py`: BE=job/.QAA/job/E2E, FE=job/.QAA/job/UI_E2E;
  PREPROD,PROD; depth 5; history 8).
- Vault → k8s secret → env wiring for the token pair (see Part C).
- A computed `jenkins_common_configured` property (url+username+token set).

### A2. Port fetch/parse into the backend
Port the read-only Jenkins fetch + parse from `agent/app/services/jenkins.py`
into the backend (e.g. `backend/app/services/jenkins_client.py` +
`jenkins_tree.py`): tree building, `color→status` mapping, builds parsing,
folder fetch, and the scope-signature computation. Reuse the existing backend
Jenkins StrEnums where present (`JenkinsNodeKind`, `JenkinsStatus`, colors) and
add any missing ones as constants — do NOT import agent code (separate package).
Only the READ paths are needed; do not port freeze/resume.

CRITICAL — signature parity: the cache is keyed by `signature`. The
backend-computed scope signature MUST match the shape the frontend uses so the
common-token fill and any agent PUT land on the same cache key. Compute the
signature from the backend scope config and expose it via a scope endpoint (A4).

### A3. Server-side read-through fill
Extend the cache read path (`jenkins_cache.py` / `jenkins.py`): on a GET cache
read that reports `stale`/empty AND hands back a refresh lease, if
`jenkins_common_configured`, the backend itself fetches Jenkins with the common
token and writes the cache — reusing the existing single-flight lease so we
don't stampede. Behavior:
- Prefer: return the current (possibly stale) snapshot immediately and fill
  asynchronously (background task) so the request stays fast; the frontend
  re-reads on its existing refetch interval. If simpler and still snappy, a
  bounded inline fill is acceptable — decide and document.
- Coexist with the agent PUT path: whichever fills first wins; the lease
  prevents duplicate work. If the common token is not configured, behavior is
  exactly as today (agent fills).
- Applies to tree, builds, and folder.

### A4. Scope endpoint without an agent
Add a backend read-only scope endpoint (e.g. `GET /api/v1/jenkins/scope`)
returning `{ signature, rootGroups, rootFolders, treeDepth, historyLimit }`
from the backend scope config, so the frontend can obtain the signature and
scope for reads WITHOUT discovering an agent. (Today the frontend gets scope
from the agent via `getJenkinsScope`.)

### A5. Auth
Read endpoints require the normal portal auth (`CurrentUser`) like the rest of
`/api/v1/jenkins/*` — they are SSO-gated but do NOT require the companion. No
new anonymous surface.

### A6. Tests
Backend tests: common-token fetch + parse (mock Jenkins HTTP), signature parity
with the expected key, server-side fill on stale read, no-op when token unset,
and a guard test asserting the common token is never used on any freeze/resume
path.

---

## Part B — Frontend: drop the agent gate on read-only Jenkins + Statistics

### B1. Reads become agent-free
- Jenkins-explorer (Tree/Board/Folder/Builds) and Statistics/Smoke must render
  from the shared backend cache + backend scope endpoint, with NO
  `CompanionGate` and NO `discoverAgent()` on the read path.
- `useCachedJenkinsResource` / `useJenkinsTree` / `useJenkinsBuilds` /
  `useSmokeFolder`: source scope+signature from the backend scope endpoint; rely
  on backend server-side fill. Keep the agent `fetchLive`+PUT only as an
  optional personal fast-path/fallback when an agent is present — reads MUST
  work when it is absent.

### B2. Mutations stay agent-gated (scoped, not section-wide)
- Freeze/Resume actions still require the agent (personal token). Instead of
  gating the whole section, gate only those actions: render the tree/board for
  everyone, and when the user invokes a mutating action without an agent, show a
  focused inline prompt ("Freeze/Resume needs the companion" → reuse the brief
  25 install/download affordance). Do not block viewing.
- This corrects brief 25: `CompanionGate` must not wrap read-only Jenkins /
  Statistics surfaces. Keep the gate for the genuinely agent-only plugins
  (Kuber / Stagings / QAA) and for the mutating Jenkins actions.

### B3. Tests
Update/extend the Jenkins and Statistics tests: reads render with no agent
discovered; Freeze/Resume prompt for the companion; existing behavior preserved
when an agent IS present.

---

## Part C — Deploy / secrets

- Vault: add `JENKINS_COMMON_USERNAME` / `JENKINS_COMMON_TOKEN` at the existing
  qaa-tms secret path (see the k8s deploy setup; single image, qaa-deploy
  preprod overlay). Map into the backend container env via the existing secret
  reference mechanism. No secrets committed to the repo.
- Backend scope config can ship as env with sane defaults (A1); document in the
  deploy overlay.

---

## Acceptance / verification

- Backend: `cd backend && ruff check app && mypy app && pytest`
- Frontend: `cd frontend && npm run lint && npx tsc --noEmit && npm test`
- Manual smoke (describe; no real cluster required): with the common token set
  and NO agent running, the Jenkins tree and Smoke stats render; Freeze/Resume
  shows the companion prompt; with the token unset, behavior falls back to the
  agent-fill path unchanged.
- Boundary check: grep/verify the common token is referenced only in read
  paths.

Keep the diff focused. Do not change the freeze/resume mutation flow. Follow the
existing module layout and naming.
