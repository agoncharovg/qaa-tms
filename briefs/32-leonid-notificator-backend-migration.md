# Brief 32 — Move Leonid & Notificator off the agent into the backend

Leonid and Notificator are **QAA-team-only** tools that run on a **single shared
token** (not per-user creds). The only reason they lived on the local agent was
network reachability of the internal `*.i.gc.onl` upstreams. That reason no longer
holds — see §Reachability. This brief moves both proxies from `agent/` into the
FastAPI `backend/`, so they work without the companion app.

Reference implementations to copy: backend already has the exact pattern in
`backend/app/services/qaa_generator.py` (httpx outbound proxy, `Settings`-driven,
errors → `HTTPException`) and `jenkins_client.py`. RBAC, permission keys, and
plugin registration for both already exist backend-side.

Memory: `project_leonid_notificator_shared_token`, `reference_leonid_service`,
`project_k8s_deploy` (Vault), `reference_verification_commands`.

---

## Reachability (verified 2026-08-25 — no longer a blocker)

Tested from inside k8s pods in **both** namespaces (`qaa-preprod` from the qaa-tms
pod; `qaa-prod` from a neighbour pod, since qaa-tms isn't deployed to prod yet).
DNS resolves and the apps answer over TLS in ~30–60 ms:

- `leonid-preprod.i.gc.onl/api/healthcheck/` → **200**
- `notificator-preprod.i.gc.onl/notificator/teams/` → **403** (its own token gate = reachable to the app)
- `notificator-prod.i.gc.onl` → reachable (404 on that path)

Egress to `*.i.gc.onl` is open. The "requires local VPN/SSO reachability" note in
`agent/.env.example` does **not** apply to the backend.

---

## Scope

- Move the **full CRUD** proxy for both services (agent already has read+write for
  all resources — this is a lift-and-shift, not a rewrite).
- Leonid resources: `shared_resource_limit_types` (RO), `shared_resource_limits`,
  `shared_resources` (+`toggle_enabled`), `object_definitions` (+toggle),
  `object_values` (+toggle), `pipeline_params`.
- Notificator resources: writable `notification_configs`, `products`,
  `sub_products`, `slack_channels`; read-only `teams`, `users`, `qaa_members`,
  `failure_mention_rules`, `events`, `recurrent_fails`, `fail_reasons`,
  `mute_statuses`, `history`; plus `choices`.
- These two features **stop being companion-gated**. Jenkins/kube/stagings stay on
  the agent (they need per-user VPN creds / kubeconfig) — do NOT touch them.

---

## Layer A — backend service clients (`backend/app/services/`)

Create `leonid_client.py` and `notificator_client.py` by porting
`agent/app/services/leonid.py` (~560 lines) and `agent/app/services/notificator.py`
(~700 lines) nearly verbatim. Changes on port:

- Take the backend `Settings` object; read `settings.leonid_url` / `leonid_token`
  and `settings.notificator_url` / `notificator_token` (added in Layer C) instead
  of the agent settings.
- Keep the token headers exactly: `X-Leonid-Token` (attach whenever token present —
  reads are token-gated too, see the comment at `agent/app/services/leonid.py:60-63`)
  and `X-Notificator-Token` (attach on every request).
- Map upstream errors to `fastapi.HTTPException` the way `qaa_generator.py` does
  (not the agent's `*NotConfiguredError`/`*UnreachableError`): not configured →
  503; unreachable/network → 502; upstream 401/403 → 502 with a "shared token
  rejected" detail; pass through 4xx bodies where the agent does.
- Reuse `httpx.AsyncClient` with `settings.*_request_timeout`.

The agent's Pydantic models in `agent/app/schemas.py` (all `Leonid*` and
`Notificator*` `Create/Update/Patch/Response`, `ConfigDict(extra="ignore")`) move
into `backend/app/schemas/leonid.py` and `backend/app/schemas/notificator.py`
as-is — they're the request/response contract for the new routes too.

---

## Layer B — backend routes (`backend/app/api/v1/`)

Add `leonid.py` and `notificator.py` routers mirroring `jenkins.py` /
`qaa_generator.py`:

- `router = APIRouter(prefix=RoutePath.LEONID.value, tags=[ApiTag...])` (add the
  route-path/tag enums in `constants.py`).
- Gate each endpoint with the existing dependency:
  `require_permission(PermissionKey.LEONID_READ)` for GET,
  `PermissionKey.LEONID_WRITE` for POST/PUT/PATCH/DELETE (and the Notificator
  equivalents). These keys **already exist** — `backend/app/core/constants.py:249-252`.
- Inject the client via a `get_leonid_client` / `get_notificator_client` dep in
  `deps.py` (build from `get_settings`, like `get_jenkins_cache`).
- Register both in `backend/app/api/v1/__init__.py` (`router.include_router(...)`,
  next to the existing 12).
- The agent route handlers (`agent/app/api/routes.py:324-964` for Leonid,
  `agent/app/api/notificator.py:107-559` for Notificator) are the reference for
  paths, query params (`?product_team=`), and per-resource wiring — port the
  handler bodies, swap the agent's `require_permission`/backend-callback auth for
  the backend `require_permission` dependency (no more agent→backend `/me` +
  authz round-trip; `deps.py` does it directly).

---

## Layer C — backend config, constants, secrets (`backend/app/core/` + deploy)

- `backend/app/core/config.py`: add fields mirroring the qaa_generator pattern
  (`config.py:134-140`):
  `leonid_url`, `leonid_token`, `leonid_request_timeout`,
  `notificator_url`, `notificator_token`, `notificator_request_timeout`,
  each `Field(default=..., alias=EnvKey.*)`. Add the URLs to the existing
  `normalize_base_url` `field_validator` (rstrip `/`).
- `backend/app/core/constants.py`: add the `EnvKey.*`, `RoutePath.*`, `ApiTag`
  entries. **Do NOT hardcode a real host default** — the target host is chosen by
  the deploy layer (Q1). Default the URLs to `""` (empty → client reports "not
  configured"); the running host comes from env.
- **Hosts are NOT secret** — set as plain `env` in `qaa-deploy/qaa-tms/overlays/<env>/custom_envs.yaml`
  (exactly like the existing `QAA_GENERATOR_BASE_URL` there): add `LEONID_URL` and
  `NOTIFICATOR_URL`. Per-env host split lives in each overlay's custom_envs.yaml (Q1/Q2).
- **Only the two shared tokens are secret.** They flow Vault → `secret.env` →
  `qaa-tms-secret` (`envFrom`). Concretely: add two lines to the qaa-tms
  `vault_secrets` block in `qaa-deploy/.github/workflows/deploy_app_by_tag.yml`:
  `LEONID_TOKEN=secret/project_cdn_qaa/qaa_apps/qaa-tms/${namespace}#LEONID_TOKEN`
  and the `NOTIFICATOR_TOKEN` equivalent. `${namespace}` gives prod vs preprod
  different Vault keys automatically (Q2). Do not ship a stub default token.
- The token **value** is issued on the aut side (`aut-deploy`; upstream validates
  it via `LEONID_API_TOKENS` / `NOTIFICATOR_API_TOKEN`) — qaa-tms stores its own
  copy under its `qaa_apps/qaa-tms/<env>` Vault path. Host → aut service; token copy → qaa-tms.

---

## Layer D — frontend repoint (`frontend/src/`)

- `src/api/backendClient.ts`: add Leonid/Notificator methods mirroring the agent
  helpers in `agentClient.ts:365-767` — but as normal backend calls (auth via the
  existing bearer header; **drop the `(port, token)` args**). Reuse the generic
  `listNotificatorCollection`/`createNotificatorItem`/… shapes.
- `src/api/types.ts`: the `Leonid*` / `Notificator*` TS types stay; they now
  describe backend responses.
- `LeonidSection.tsx` / `NotificatorSection.tsx`: **remove the `<CompanionGate>`
  wrapper** and the `agentPort` plumbing. Panels
  (`SharedResourcesPanel`, `ObjectsPanel`, `PipelineConfigsPanel`,
  `CrudPanels`/`ReadOnlyPanels`, `NotificationsPanel`) drop the `agentPort` prop
  and call `backendClient` directly. Update their `*.test.tsx` accordingly
  (they currently pass `agentPort={PORT}` and mock `CompanionGate`).
- `src/constants.ts`: the agent `AgentPath.LEONID_*/NOTIFICATOR_*` and
  `buildAgent*Path` helpers for these two become unused — remove or repoint to
  backend route paths.

---

## Layer E — cleanup (remove the agent proxy)

Once D is green, delete the migrated agent code so there's one source of truth:

- `agent/app/services/leonid.py`, `agent/app/services/notificator.py`;
  Leonid routes in `agent/app/api/routes.py:324-964`; `agent/app/api/notificator.py`.
- Leonid/Notificator entries in `agent/app/schemas.py`,
  `agent/app/core/constants.py` (`AgentPath.*`, `EnvKey.*_URL/TOKEN`,
  `HeaderName.X_*_TOKEN`, `PermissionKey.*`), `agent/app/core/config.py:80-90,250-260`.
- **Profile → Settings**: the Leonid/Notificator **service-token** fields
  (`frontend/src/plugins/profile/SettingsPanel.tsx:95-96`, and the agent settings
  API that writes `AGENT_LEONID_TOKEN`/`AGENT_NOTIFICATOR_TOKEN` at
  `agent/app/api/routes.py:239-241`) are now infra secrets in Vault — **remove**
  them from the user-editable settings surface.
- `agent/.env.example`: drop the Leonid/Notificator URL/token lines.

Keep Layer E as a separate commit so A–D can be verified against the still-running
agent first, then the agent code is removed.

---

## Deferred (NOT in this migration — the user's "note for the future")

Per-call **access logging by user name**. On the shared token there's no per-user
attribution today. Once in the backend this is cheap: `require_permission` already
yields the acting `User` (has `.username`/display name), so the client can forward
e.g. an `X-Acting-User` header to Leonid/Notificator (or log it locally). Do this
only when the upstreams grow a field to record it — tracked, not built here.

---

## Decisions (RESOLVED 2026-08-25)

- **Q1 — target hosts: decided by the deploy repos, not the app.** The upstream
  host for each environment is set in **qaa-deploy/qaa-tms** (`overlays/<env>/custom_envs.yaml`,
  plain `env`) pointing at the **aut-deploy**-managed Notificator/Leonid service. The
  backend must **not** hardcode a `*.i.gc.onl` default — URLs are injected via env.
- **Q2 — env split.** The **host** is non-secret → per-env `custom_envs.yaml`. The
  **token** is secret → Vault path `secret/project_cdn_qaa/qaa_apps/qaa-tms/${namespace}`,
  wired in `deploy_app_by_tag.yml`'s qaa-tms `vault_secrets` block; `${namespace}`
  splits prod vs preprod. No env branching in app code.
- **Q3 — one shared token for read+write** (for now). A single token class covers
  both, matching brief 30. Splitting off a read-only token is out of scope.

---

## Verification (`reference_verification_commands`)

- backend: `ruff format --check . && ruff check . && mypy app && pytest` (in `backend/`).
  Add service tests (token attached; not-configured → 503; unreachable → 502; happy
  path; `?product_team=` forwarded) and route tests (permission gating: 403 without
  `leonid.read`/`write` etc.) — mirror the agent's `test_leonid*`/`test_notificator*`.
- frontend: `npm run lint && npx tsc --noEmit && npx vitest run` (in `frontend/`).
- agent (after Layer E): same trio — ensure nothing still imports the removed code.
- Manual smoke (`reference_local_e2e_run`): with `LEONID_URL`/`NOTIFICATOR_URL`/tokens
  set on the **backend**, open Leonid and Notificator with the companion app
  **stopped** — every tab must read and (for writable resources) create/edit/delete.
