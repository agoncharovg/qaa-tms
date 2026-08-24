# Brief 27 — Notificator plugin (agent + frontend + registration)

Build a qaa-tms plugin that surfaces **aut-notificator** notification configs,
**exactly by analogy with the Leonid plugin**. Data flows through the local
companion **agent** (not the backend), because aut-notificator is behind SSO.

Full analysis and rationale: `discuss/17`. Read it first.

Leonid is the reference implementation for every layer here — mirror its files,
naming, error handling, and tests. Grep `leonid`/`Leonid` across the repo to find
every touch point.

---

## Layer A — aut-notificator REST API — ALREADY DONE (do not redo)

Implemented and tested in `~/Projects/aut-notificator` (separate repo). Documented
here only so you know the exact contract to consume.

New endpoint: `GET /notification_configs/`
- Auth: **shared token** in header `X-Notificator-Token` (mirrors Leonid's
  `X-Leonid-Token`). Token is a **stub** for now:
  `NOTIFICATOR_API_TOKEN` in aut-notificator settings, default
  `changeme-notificator-token`, override via env `NOTIFICATOR_API_TOKEN`.
  Missing/wrong token → HTTP 403.
- No pagination — returns a **plain JSON list** (client groups by team).
- Optional filter `?product_team=<id-or-exact-name>`.
- Read-only (MVP). No create/update/delete yet.

Response item shape (one row per notification config):
```json
{
  "id": 12,
  "product_team_id": 3,
  "product_team": "qaa-team",
  "notification_type": "NEW_JIRA_TICKET",
  "notification_type_label": "Notify about new JIRA ticket creation",
  "enabled": true,
  "channels": [{"id": 1, "channel_id": "C12345678", "description": "alerts"}],
  "users": [{"id": 4, "sam_account_name": "jdoe", "user_principal_name": "jdoe@gcore.com"}]
}
```
Files changed in aut-notificator (reference): `contact_manager/permissions.py`
(new `HasNotificatorToken`), `contact_manager/serializers.py`
(`NotificationConfigSerializer` + nested channel/user serializers),
`contact_manager/views.py` (`NotificationConfigViewSet`, ReadOnly, `pagination_class=None`,
`authentication_classes=[]`), `src/urls.py` (router `notification_configs`),
`src/settings.py` (`NOTIFICATOR_API_TOKEN`), `contact_manager/tests.py`.

---

## Layer B — agent proxy (`agent/`)

Model on `agent/app/services/leonid.py` + its routes/schemas/config/constants.
**Read-only** for MVP (only the GET paths). Keep the token-attach + error-mapping
pattern identical to Leonid.

**B1. `agent/app/services/notificator.py`** (new) — httpx client:
- `NotificatorNotConfiguredError`, `NotificatorUnreachableError` (copy Leonid's
  two exception classes + `require_configured`, `_send_json` with the token header,
  timeout/HTTPError → Unreachable, 401/403 → upstream-rejected, JSON validation).
- `NOTIFICATOR_CONFIGS_PATH = "/notification_configs/"`.
- `async def list_notification_configs(settings, *, product_team=None, transport=None) -> list[dict]`
  — GET with optional `?product_team=` query, token from `settings.notificator_token`.
- Do NOT invent write helpers — read-only for now.

**B2. `agent/app/core/constants.py`**:
- `AgentPath.NOTIFICATOR_CONFIGS = "/notificator/notification_configs"`.
- `EnvKey.NOTIFICATOR_URL = "AGENT_NOTIFICATOR_URL"`,
  `EnvKey.NOTIFICATOR_TOKEN = "AGENT_NOTIFICATOR_TOKEN"`,
  `EnvKey.NOTIFICATOR_REQUEST_TIMEOUT = "AGENT_NOTIFICATOR_REQUEST_TIMEOUT"`.
- `HeaderName.X_NOTIFICATOR_TOKEN = "X-Notificator-Token"`.
- `PermissionKey.NOTIFICATOR_READ = "notificator.read"`.
- `ErrorMessage.NOTIFICATOR_NOT_CONFIGURED / NOTIFICATOR_UNREACHABLE /
  NOTIFICATOR_UPSTREAM_REJECTED` (copy Leonid wording).
- `DEFAULT_NOTIFICATOR_URL = "https://notificator-prod.i.gc.onl"` (matches
  aut-notificator `SELF_HOSTNAME` default), `DEFAULT_NOTIFICATOR_REQUEST_TIMEOUT = 15.0`.
  (Per discuss/16, do NOT hardcode preprod as the default.)

**B3. `agent/app/core/config.py`**:
- Fields `notificator_url` / `notificator_token` / `notificator_request_timeout`
  (same Field/alias/validator style as `leonid_*`; strip trailing slash validator
  like leonid_url).
- `@property notificator_configured -> bool` = `bool(self.notificator_url and self.notificator_token)`
  (token is required even for reads, exactly like Leonid).

**B4. `agent/app/schemas.py`**:
- `NotificatorChannel(id:int, channel_id:str, description:str|None=None)`
- `NotificatorUser(id:int, sam_account_name:str, user_principal_name:str)`
- `NotificatorNotificationConfigResponse` with `model_config = ConfigDict(extra="ignore")`
  and fields matching the Layer-A shape: `id, product_team_id, product_team,
  notification_type, notification_type_label, enabled, channels: list[...],
  users: list[...]`.

**B5. `agent/app/api/routes.py`**:
- `NotificatorReadAuth = Annotated[AuthContext, Depends(require_permission(PermissionKey.NOTIFICATOR_READ))]`.
- `require_notificator_read_configured(settings)` → 503 if not configured
  (copy `require_leonid_read_configured`).
- `raise_notificator_http_error(exc)` (copy `raise_leonid_http_error`: NotConfigured→503,
  Unreachable→502).
- Route:
  ```
  @router.get(AgentPath.NOTIFICATOR_CONFIGS.value,
              response_model=list[NotificatorNotificationConfigResponse])
  async def get_notificator_configs(_: NotificatorReadAuth, settings: SettingsDep,
                                    product_team: str | None = Query(default=None)) -> ...
  ```
  Call `list_notification_configs`, map errors, return `[Model(**item) for item in payload]`.

**B6. `agent/.env.example`** (and any `.env.example` the repo keeps): add
`AGENT_NOTIFICATOR_URL`, `AGENT_NOTIFICATOR_TOKEN` with comments (there are none
today — same gap discuss/16 flags for Leonid).

**B7. agent tests**: add `agent/tests/test_notificator*.py` mirroring the Leonid
service/route tests (find them under `agent/tests`): token attached, not-configured
→ 503, unreachable → 502, happy path returns parsed list, `?product_team=` forwarded.
Use the same httpx MockTransport pattern the Leonid tests use.

---

## Layer C — frontend plugin (`frontend/src/plugins/notificator/`)

Model on `frontend/src/plugins/leonid/`. Plugins auto-register via
`import.meta.glob("./*/manifest.tsx")` (see `frontend/src/plugins/discovery.ts`) —
no manual registry edit needed on the frontend.

**C1. `frontend/src/constants.ts`**:
- `PluginId.NOTIFICATOR = "notificator"`, `IconName.NOTIFICATOR = "notificator"`.
- `AgentPath.NOTIFICATOR_CONFIGS = "/notificator/notification_configs"`.
- `buildAgentNotificatorConfigsPath(productTeam?: string): string` — returns the
  path, appending `?product_team=<encoded>` when given.
- `ViewKey.NOTIFICATOR_NOTIFICATIONS`, `TabId.NOTIFICATOR_NOTIFICATIONS`,
  `TabTitle[TabId.NOTIFICATOR_NOTIFICATIONS] = "Notifications"`.

**C2. `frontend/src/api/types.ts`**: `NotificatorChannel`, `NotificatorUser`,
`NotificatorNotificationConfig` (fields match Layer-A shape).

**C3. `frontend/src/api/agentClient.ts`**:
`listNotificatorNotificationConfigs(agentPort, token, productTeam?)` using
`readAgentJson<NotificatorNotificationConfig[]>(...)` (copy a Leonid list fn).

**C4. `frontend/src/core/plugins/icons.ts`**: add a `notificator` icon (bell/📣 —
pick from whatever icon set Leonid uses).

**C5. `frontend/src/plugins/notificator/manifest.tsx`**: `definePlugin({
id: PluginId.NOTIFICATOR, icon: IconName.NOTIFICATOR, kind: PluginKind.OPTIONAL,
label: "Notificator", origin: PluginOrigin.BUILTIN, order: 27, requiresAgent: true,
route: "/notificator", tabs: [{ Notifications → NotificatorSection }] })`.
Pick an `order` that doesn't collide (Leonid=26).

**C6. `frontend/src/plugins/notificator/NotificatorSection.tsx`**: wrap
`NotificationsPanel` in `<CompanionGate>` exactly like `LeonidSection`.

**C7. `frontend/src/plugins/notificator/NotificationsPanel.tsx`** — THE CORE
REQUIREMENT (this is what the user specifically asked for):
- Fetch the flat config list via `listNotificatorNotificationConfigs`.
- **Group by `product_team_id`** into one row per team. Do the grouping in a small
  pure helper (e.g. `groupByTeam.ts`) with its own unit test.
- Table = **one row per team** with columns: team name, total notifications count,
  enabled/total, (optional) distinct channel count.
- Clicking a team row opens a **modal / expanding panel** listing that team's full
  set of notifications: `notification_type_label`, enabled badge, channels, users
  (the "Users DM"). This mirrors the Django-admin ProductTeam inline.
- Loading / error / empty states like the Leonid panels.

**C8. tests**: `NotificationsPanel.test.tsx` (renders grouped rows, opens the modal
with the team's items) + `groupByTeam.test.ts`. Follow the existing Leonid
`*.test.tsx` structure. Update `frontend/src/plugins/discovery.test.ts` if it
asserts the plugin set.

---

## Layer D — backend registration + permissions (`backend/`)

**D1. `backend/app/core/constants.py`**:
- `PluginId.NOTIFICATOR = "notificator"`; add `PluginId.NOTIFICATOR` to
  `OPTIONAL_PLUGIN_IDS`.
- `PermissionKey.NOTIFICATOR_READ = "notificator.read"`.

**D2. `backend/app/services/authorization.py`**: add `PermissionKey.NOTIFICATOR_READ`
to the admin role (which uses `tuple(PermissionKey)` — automatic) and to any other
role that should see it (mirror how `LEONID_READ` is assigned; check whether Leonid
is granted to non-admin roles and match that policy — likely admin-only for MVP).

**D3.** If there is a security-matrix test/snapshot that enumerates permissions or
plugins (grep for `LEONID_READ` and `PluginId.LEONID` in `backend/tests`), update it.

---

## Verification (see memory `reference_verification_commands`)

- agent: `ruff format --check . && ruff check . && mypy app && pytest`
  (run in `agent/`, mypy target is `app`).
- backend: same trio in `backend/` (mypy target `app`).
- frontend: `npm run lint && npx tsc --noEmit && npx vitest run` in `frontend/`.
- Manual smoke (optional, see memory `reference_local_e2e_run`): run aut-notificator
  locally with `NOTIFICATOR_API_TOKEN` set, point `AGENT_NOTIFICATOR_URL/TOKEN` at
  it, open the Notificator tab, confirm teams collapse and the modal shows the list.

## Scope / non-goals
- Read-only. No create/update/delete/toggle in this brief (Phase 2).
- Only the "Notifications" tab (grouped by team). Other admin sections
  (Teams, Slack Channels, Recurrent fail notifications, Events, …) are out of scope.
- Do NOT re-hardcode preprod as a default URL/token; leave per-env config to
  env / Profile→Settings / qaa-deploy (discuss/16 debt applies here too).
