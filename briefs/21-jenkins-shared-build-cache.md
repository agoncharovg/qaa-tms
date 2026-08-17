# Brief 21 — Jenkins build history: fold builds into the tree + shared backend cache (kill the per-pipeline storm)

Follow `CONVENTIONS.md` (StrEnum/union-literal constants in the dedicated
modules, English UI text, ruff+mypy / eslint+tsc clean, API under `/api/v1`).

## Problem

Commit `787568f` ("Add Jenkins build history strip") made the per-pipeline
build query fire for **every** pipeline node, not just the expanded one
(`frontend/src/plugins/jenkins/TreePanel.tsx` line ~224:
`enabled: Boolean(token && node.kind === "pipeline")`). With ~200+ pipelines in
the `.QAA/E2E` scope this means each open of the Tree tab issues **1 tree
request + ~200 separate `GET /jenkins/builds` requests**, one per pipeline. The
browser throttles them to ~6 per host, so the history strips pop in one-by-one
in random order (the "unpredictable rendering"), and `agent/app/services/jenkins.py::_get_json`
opens a **new `httpx.AsyncClient` per call**, so each of the ~200 requests is a
fresh TCP+TLS handshake against the Jenkins master. With ~10 concurrent users
that is a ~2000-request / ~2000-TLS-handshake burst that competes with real CI.

The agent is **local per user** and holds the Jenkins credentials, so today the
load scales linearly with (users × pipelines). We want it flat: **~1 Jenkins
fetch per 15 min across all users**, deterministic strip rendering, and refresh
only for pipelines a user actually expands.

Design (agreed in `discuss`): keep the Jenkins fetch **on the local agent**
(VPN + personal token — the backend does NOT reach Jenkins and there is NO
shared service account), but make the **backend a shared read-through cache** of
the *result*. The frontend orchestrates: read from backend cache; on a miss the
lease-holder asks its local agent to fetch and writes the result back to the
backend for everyone.

Three parts. A is independently valuable (collapses N+1 → 1) and can land first.

---

## Part A — Agent: fold recent builds into the single tree call

Goal: the history strip data arrives **inside** the one recursive tree request,
so there are zero per-pipeline requests for the collapsed view.

`agent/app/services/jenkins.py`:

- Add a **separate** history limit for the folded strip, smaller than the
  expanded-list limit. In `agent/app/core/constants.py` add
  `DEFAULT_JENKINS_HISTORY_LIMIT = 8` (keep `DEFAULT_JENKINS_BUILDS_LIMIT = 15`
  for the expanded per-pipeline list). Add a config field
  `jenkins_history_limit: int` in `agent/app/core/config.py`
  (alias `AGENT_JENKINS_HISTORY_LIMIT`, add `EnvKey.JENKINS_HISTORY_LIMIT`),
  defaulting to `DEFAULT_JENKINS_HISTORY_LIMIT`; document it in
  `agent/.env.example`.
- Extend the tree field expression so each job also returns its recent builds.
  In `_build_tree_field_expression` / `TREE_FIELD_EXPRESSION`, append
  `builds[number,result,building,timestamp,duration,url]{0,N}` where
  `N = settings.jenkins_history_limit`. (The expression is built per-call, so
  thread the limit through `_build_tree_field_expression(levels, history_limit)`
  or read it where the expression is assembled in `fetch_tree`.)
- Factor the build-row mapping out of `fetch_builds` into a helper
  `_map_build(raw: Mapping[str, Any]) -> JenkinsBuild` and reuse it in both
  `fetch_builds` and `_map_node`.
- In `_map_node`, for **pipeline** nodes parse the folded `builds` list (newest
  Jenkins-first; do NOT reverse here — the frontend already reverses for the
  strip) into `list[JenkinsBuild]` and attach it. Folder nodes keep `builds=[]`.
- Add `builds: list[JenkinsBuild] = Field(default_factory=list)` to the
  `JenkinsNode` schema in `agent/app/schemas.py` (pipelines only populate it).

Keep `fetch_builds` and `GET /jenkins/builds` unchanged in purpose: they serve
the **expanded** full list (up to `DEFAULT_JENKINS_BUILDS_LIMIT`) for a single
pipeline on demand.

Add a cheap scope endpoint so the frontend can compute the cache key WITHOUT
hitting Jenkins:

- `GET /jenkins/scope` (new `AgentPath.JENKINS_SCOPE = "/jenkins/scope"`) →
  returns `{ signature, rootPath, rootFolders, treeDepth, historyLimit }`.
  `signature` is a deterministic hash of the scope that determines the tree
  shape: `sha256` over `f"{root_path}|{sorted(root_folders)}|{tree_depth}|{history_limit}"`,
  hex, truncated to 16 chars. Put the hashing in a small pure helper
  (e.g. `jenkins_scope_signature(settings) -> str`) so the same value is used
  everywhere. This endpoint does NOT call Jenkins (no `require_configured`
  network call) — it only reads settings, so it works even when Jenkins is
  briefly unreachable.
- Add a `signature` field to `JenkinsTreeResponse` (agent) too, set from the
  same helper, so a fresh agent fetch is self-describing.

Tests (`agent/tests/test_jenkins.py`): the folded tree returns pipeline nodes
with a populated `builds` list (assert count ≤ history limit and fields mapped);
folders have empty `builds`; `_map_build` regression for a single row; scope
signature is stable for the same config and changes when a scope field changes.

---

## Part B — Backend: shared read-through cache with single-flight

New in-memory cache (single backend instance assumption — 10–15 users; a
multi-instance shared store like Redis is explicitly out of scope, note it in a
module docstring). All endpoints require `CurrentUser` (reuse `app.api.deps`).

### Schemas — `backend/app/schemas/jenkins.py` (new)

Mirror the agent's shapes (camelCase aliases, `populate_by_name=True`):
`JenkinsBuild`, `JenkinsNode` (recursive, with `builds: list[JenkinsBuild]` and
`children: list[JenkinsNode]`), plus cache DTOs:

- `JenkinsTreeCacheRead { roots: list[JenkinsNode]; signature: str;
  fetchedAt: datetime | null; stale: bool; refreshLease: str | null }`
- `JenkinsTreeCachePut { signature: str; roots: list[JenkinsNode];
  refreshLease: str | null }`
- `JenkinsBuildsCacheRead { builds: list[JenkinsBuild]; signature: str;
  path: str; fetchedAt: datetime | null; stale: bool; refreshLease: str | null }`
- `JenkinsBuildsCachePut { signature: str; path: str;
  builds: list[JenkinsBuild]; refreshLease: str | null }`

Reuse `JenkinsNodeKind` / `JenkinsStatus` enums — add them to
`backend/app/core/constants.py` if not already present (they exist on the agent
and frontend; the backend needs its own copy for validation).

### Cache store — `backend/app/services/jenkins_cache.py` (new)

A class `JenkinsCache` holding, guarded by a single `asyncio.Lock`:

- `trees: dict[str, TreeEntry]` keyed by `signature`, where
  `TreeEntry { roots, fetched_at, refreshing_until, refresh_lease }`.
- `builds: dict[tuple[str, str], BuildsEntry]` keyed by `(signature, path)`.

TTL/lease constants in `constants.py`:
`JENKINS_TREE_CACHE_TTL_SECONDS = 900`,
`JENKINS_BUILDS_CACHE_TTL_SECONDS = 60`,
`JENKINS_REFRESH_LEASE_TTL_SECONDS = 30`.

Core read logic (identical shape for tree and builds), all timestamps UTC:

```
read(signature[, path]) -> (data, fetched_at, stale, refresh_lease):
  entry = store.get(key)
  fresh = entry and (now - entry.fetched_at) < TTL
  if fresh: return (entry.data, entry.fetched_at, stale=False, lease=None)
  # stale or missing -> single-flight
  lease_active = entry and entry.refreshing_until and now < entry.refreshing_until
  if lease_active:
      # someone else is already refreshing; serve stale, no lease
      return (entry.data if entry else EMPTY, entry.fetched_at if entry else None, stale=True, lease=None)
  # mint a lease for THIS caller
  lease = uuid4().hex
  set entry.refresh_lease = lease; entry.refreshing_until = now + LEASE_TTL
  return (entry.data if entry else EMPTY, entry.fetched_at if entry else None, stale=True, lease=lease)
```

Write logic:

```
write(signature[, path], data, lease):
  entry = store.get(key) or new
  # tolerant: accept if lease matches OR no active lease (a late/forced write still lands)
  entry.data = data; entry.fetched_at = now
  entry.refresh_lease = None; entry.refreshing_until = None
  store[key] = entry
```

The `read` mutation (minting a lease) and `write` must both hold the lock so two
concurrent stale readers cannot both receive a lease. Expired leases
(`now >= refreshing_until`) are treated as no lease, so a crashed refresher
self-heals after `JENKINS_REFRESH_LEASE_TTL_SECONDS`.

Construct one `JenkinsCache` in the app lifespan (`app.state.jenkins_cache`),
expose via a dependency in `deps.py` (e.g. `get_jenkins_cache(request)`), mirror
the `session_maker` pattern.

### Router — `backend/app/api/v1/jenkins.py` (new), mounted in `api/v1/__init__.py`

Prefix `RoutePath.JENKINS = "/jenkins"`, tag `ApiTag.JENKINS`. Endpoints:

- `GET /jenkins/tree?signature=<sig>` → `JenkinsTreeCacheRead`.
- `PUT /jenkins/tree` (body `JenkinsTreeCachePut`) → `JenkinsTreeCacheRead`
  (the stored snapshot, `stale=false`, `refreshLease=null`).
- `GET /jenkins/builds?signature=<sig>&path=<path>` → `JenkinsBuildsCacheRead`.
- `PUT /jenkins/builds` (body `JenkinsBuildsCachePut`) → `JenkinsBuildsCacheRead`.

No Jenkins access here — the backend only stores/serves what agents PUT. Path is
an opaque cache key (the frontend passes the agent-validated `node.path`); do not
re-validate scope on the backend.

Tests (`backend/tests`): fresh read returns `stale=false,lease=null`; first
stale reader gets a lease, a second concurrent stale reader gets
`lease=null` + stale data; a `PUT` with the lease clears staleness so the next
read is fresh; a lease past `refreshing_until` is re-mintable; unauthenticated
request → 401.

---

## Part C — Frontend: read from backend, fetch via agent on miss, write back

Constants (`frontend/src/constants.ts`): add `BackendPath.JENKINS_TREE`
(`/jenkins/tree`) and `BackendPath.JENKINS_BUILDS` (`/jenkins/builds`) with query
builders (mirror existing `buildBackend*Path` helpers); add
`AgentPath.JENKINS_SCOPE` + a `buildAgentJenkinsScopePath()`; add
`QueryKey.JENKINS_SCOPE` and `QueryKey.JENKINS_TREE_CACHE`. Add the
`JenkinsBuild.builds`-carrying node field to `frontend/src/api/types.ts`
(`JenkinsNode.builds: JenkinsBuild[]`), plus `JenkinsScopeResponse` and the
cache DTO types (`JenkinsTreeCacheRead`, etc.).

Clients:
- `frontend/src/api/agentClient.ts`: add `getJenkinsScope(port, token, signal)`.
  (Keep `getJenkinsTree` / `getJenkinsBuilds` — they are the "fetch from
  Jenkins" calls used on a cache miss.)
- `frontend/src/api/backendClient.ts`: add
  `getJenkinsTreeCache(signature)`, `putJenkinsTreeCache(body)`,
  `getJenkinsBuildsCache(signature, path)`, `putJenkinsBuildsCache(body)`.

Orchestration hook — `frontend/src/plugins/jenkins/useJenkinsTree.ts` (new),
used by both `TreePanel` and `BoardPanel`:

1. `scopeQuery` → `agentClient.getJenkinsScope` → `{ signature }`
   (cheap, no Jenkins; enabled when token+port).
2. `cacheQuery` → `backendClient.getJenkinsTreeCache(signature)`; while the Tree
   tab is active, `refetchInterval = JENKINS_TREE_REFETCH_MS` (add const = 900_000)
   and `staleTime` the same; `refetchOnWindowFocus: false`.
3. A `refreshMutation` runs **only when** `cacheQuery.data.stale &&
   cacheQuery.data.refreshLease`: call `agentClient.getJenkinsTree(port,...)`,
   then `backendClient.putJenkinsTreeCache({ signature, roots, refreshLease })`,
   then invalidate `cacheQuery`. Because the backend hands the lease to exactly
   one caller, only one browser refreshes per expiry (single-flight); the others
   render the stale `roots` until the invalidation lands. Trigger the mutation
   from a `useEffect` keyed on `(stale, refreshLease)`, guarded so it fires once
   per lease.
4. Expose `{ roots, fetchedAt, isRefreshing, error, refetch }`. `refetch` forces
   a fresh agent fetch + PUT (the manual "Refresh" button).

`TreePanel.tsx`:
- Replace `treeQuery` with `useJenkinsTree`. Render `roots` from the cache.
- **Delete the per-pipeline `buildQuery`** used for the strip. The
  `BuildHistoryLine` now reads `node.builds` directly (reverse for oldest→newest
  as today). The strip therefore renders for all pipelines at once,
  deterministically, from cached data.
- For the **expanded** full build list, add a separate `useJenkinsBuilds(path)`
  hook (same read-through-then-agent-fetch-then-PUT pattern against
  `/jenkins/builds`, TTL 60s), enabled **only when the pipeline is expanded and
  the tab is active** (`enabled: expanded && isActive`), with
  `refetchInterval = JENKINS_BUILDS_REFETCH_MS` (add const = 60_000) while
  expanded. This is the "auto-refresh only open pipelines" behavior. Fall back to
  the node's folded `builds` for the initial paint before the fuller list loads.
- Keep the manual **Refresh** button wired to the hook's forced `refetch`.

`BoardPanel.tsx`: switch its `treeQuery` to `useJenkinsTree` as well so pinned
tiles read strips from the shared cache (no per-pipeline agent calls).

Update `frontend/src/plugins/jenkins/TreePanel.test.tsx` and
`BoardPanel.test.tsx`: mock the backend cache endpoints + agent scope/tree;
assert (a) a fresh cache read renders strips from `node.builds` with **no**
per-pipeline `getJenkinsBuilds` calls; (b) a stale+lease read triggers exactly
one agent `getJenkinsTree` + one `putJenkinsTreeCache`; (c) a stale+no-lease read
renders stale roots and does NOT fetch; (d) expanding a pipeline triggers the
builds read-through.

---

## Non-goals / notes to preserve

- No backend→Jenkins networking and no shared service account: the agent stays
  the only thing that talks to Jenkins.
- Shared view = whoever last refreshed (their token/ACL). Acceptable for the
  shared read-only `.QAA/E2E` scope; do not add per-user cache partitioning.
- SSE push of cache diffs to open pages is a deliberate future step, NOT in this
  brief. 15-min poll + stale-while-revalidate is the mechanism here.
- In-memory single-instance backend cache; multi-instance would need a shared
  store — out of scope, note it.

## Acceptance criteria

- Opening the Tree tab issues **one** agent `/jenkins/scope` + at most **one**
  agent `/jenkins/tree` per 15-min window per user (only the lease-holder on a
  cache miss), and **zero** per-pipeline `/jenkins/builds` for the collapsed
  strips. Strips render together, not one-by-one.
- With N users on the same scope, at most **one** agent actually hits Jenkins per
  15-min window (single-flight via the backend lease); the rest read the shared
  cache.
- Expanding a pipeline shows the full build list and auto-refreshes (≤60s) only
  while expanded and the tab is active; collapsing stops it.
- The manual Refresh button forces a fresh fetch and repopulates the shared
  cache for everyone.
- `agent`, `backend`, `frontend` all green: ruff + mypy + pytest (agent,
  backend); eslint + `tsc --noEmit` + vitest (frontend). New code follows
  `CONVENTIONS.md` (no bare string literals; enums in the constants modules;
  English UI text).

## Verify (this machine)

Follow the local run recipe (host-network PG + native backend/agent/frontend).
With the agent configured for the `.QAA/E2E` scope and the Tree tab open:
- Network tab shows one `/jenkins/scope`, one backend `GET /jenkins/tree`, and —
  on a cold cache — one agent `GET /jenkins/tree`, then a `PUT /jenkins/tree`;
  reopening the tab within 15 min shows only the backend `GET` (cache hit, no
  agent Jenkins call).
- Strips appear for all pipelines simultaneously.
- Expand a pipeline → one `GET /jenkins/builds` (backend), and on a cold builds
  cache one agent `GET /jenkins/builds` + `PUT`; the full list refreshes while
  it stays expanded.
