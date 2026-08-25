# Brief 30 — Notificator full functionality (whole admin screen) + plugin permissions in Security

Extend the Notificator plugin from the read-only MVP (brief 27) to cover the
**entire aut-notificator admin screen** (13 sections), with editing, and fix
**Administration → Security** so plugin permissions show up.

Full analysis, decisions, phasing, open questions: `discuss/18`. Read it first.
Reference implementation for every layer: **Leonid** (grep `leonid`/`Leonid`).

**Two repos, three layers in qaa-tms:**
- Repo 1 `~/Projects/aut-notificator` — the REST API (Layer A).
- Repo 2 `qaa-tms` — `agent/` (Layer B), `frontend/` (Layer C), `backend/` (Layer D + S).

**Phasing (do NOT do it all at once — see discuss/18 §6):**
- Phase 0 (BLOCKER): token hardening — see §Token blocker.
- Phase 1: read-all (Layer A read + B read + C view-only tabs).
- Phase 2: write (Layer A write + B write + NOTIFICATOR_WRITE + C forms).
- Phase 3: Security catalog (Layer S).

---

## Token blocker (Phase 0 — must resolve before any write)

`NOTIFICATOR_API_TOKEN` in aut-notificator `src/settings.py` defaults to the stub
`changeme-notificator-token`. Opening **write** under a shared stub = full CRUD
bypassing SSO. Before Phase 2:
1. Remove the stub default (empty → endpoints return "not configured", not open).
2. Store the real token in Vault (see memory `project_k8s_deploy`).

Token model: **single token for read+write** (RESOLVED, discuss/18 Q2) — one
`HasNotificatorToken` permission class covers both; no separate read/write tokens.

Read (Phase 1) may ship on the existing shared-token model.

---

## Layer A — aut-notificator REST API (repo 1)

**Conventions (discuss/18 §4):**
- All endpoints token-gated: `permission_classes=[HasNotificatorToken]`,
  `authentication_classes=[]` (agent has only the shared token). Do NOT reuse the
  SSO-protected `/teams`, `/users` — add parallel viewsets under a `notificator/`
  prefix in `src/urls.py`.
- `ModelViewSet` (read-only sections → `ReadOnlyModelViewSet`),
  `pagination_class=None`.
- FK/M2M: **write** as id lists (`PrimaryKeyRelatedField`); **read** as nested
  `{id, name/label}` (mirror the existing `NotificationConfigSerializer`).
- Serializers/viewsets live in `contact_manager/` or `notifications/` matching the
  model's app; register all in `src/urls.py`; tests in the app's `tests.py`.

**Reference-data endpoint (needed for edit forms):**
- `GET notificator/choices/` → `{ "notification_types": [{code,label}] }` from
  `ALLOWED_NOTIFICATION_TYPES` (the only choice field on a writable entity —
  notification_configs). `match_targets`/`environments` belong to read-only
  sections; add them only if used as display filters.

**SCOPE (resolved — discuss/18 Q1, 2026-08-25):** CRUD (R+W) for **4** sections
only — **notification_configs, products, sub_products, slack_channels**. The other
**9** are **read-only (R)**. So Phase 2 (write) + `NOTIFICATOR_WRITE` + frontend
forms apply to those 4 only.

**Per-entity endpoints** (prefix `notificator/…`; R=GET list/retrieve,
W=POST/PUT/PATCH/DELETE).

1. **notification_configs/** — **R+W**. ✅ R exists; ADD W.
   Write fields: `notification_type`, `enabled`; relations `product_team` (FK),
   `channels` (M2M), `users` (M2M). Keep the current read serializer shape.
2. **notificator/teams/** — **R only**. `name`, `email`, `pagerduty_ep`;
   nested `product`, `manager`, `members`, `notification_configs` counts.
3. **notificator/products/** — **R+W**. `name`(unique), `description`;
   read-only counts: teams / sub_products / qaa_members.
4. **notificator/sub_products/** — **R+W**. `name`(unique); `product`(FK), `team`(FK).
5. **notificator/slack_channels/** — **R+W**. `channel_id`(unique), `description`.
6. **notificator/users/** — **R only**. `username`, `user_principal_name`,
   `sam_account_name`, `slack_id`, `department`, `company`, `title`,
   `notifications_enabled`; nested `teams`, `events_subscriptions`, `manager`.
7. **notificator/qaa_members/** — **R only**. `QAAMemberModel`: `product`, `user`.
8. **notificator/failure_mention_rules/** — **R only**. `pattern`,
   `match_target`(choice), `environment`(choice), `message_template`, `enabled`;
   nested `users`.
9. **notificator/events/** — **R only**. `name`, `description`, `enabled`.
10. **notificator/recurrent_fails/** — **R only**. `description`, `time_threshold`,
    `number_of_fails`, `environment`, `is_enabled`; nested `channels`,
    `slack_mention`, `fail_reasons`, `product`, `mute_statuses`.
11. **notificator/fail_reasons/** — **R only**. `name`(unique).
12. **notificator/mute_statuses/** — **R only**. `expires_at`, `created_at`;
    `configuration`(FK→recurrent_fails).
13. **notificator/history/** — **R only** (`HistoryElementModel`): `author`,
    `when_muted`, `muted_until`, `config_id`.

Note: with writes limited to the 4 above, `notificator/choices/` only needs
`notification_types` (for entity 1). `match_targets`/`environments` are for
read-only sections — include them only if you also want them as display filters.

**Tests (aut-notificator `tests.py`):** for each viewset — token required (403
without/wrong token), list/retrieve happy path, and for W: create/update/delete
round-trip incl. M2M by id. Mirror the existing `notification_configs` tests.

---

## Layer B — agent proxy (`agent/`, repo 2)

Model on `agent/app/services/leonid.py` + its routes/schemas/config/constants
(Leonid already has the full read+write proxy pattern — copy it).

- `agent/app/services/notificator.py`: extend beyond `list_notification_configs`
  with `list_/get_/create_/update_/patch_/delete_` per resource (Phase 1 = read
  helpers only; Phase 2 = write). Reuse `NotificatorNotConfiguredError` /
  `NotificatorUnreachableError`, token header, error mapping.
- `agent/app/api/routes.py`: routes `/notificator/<resource>` under
  `require_permission(NOTIFICATOR_READ)` (GET) and `NOTIFICATOR_WRITE`
  (POST/PUT/PATCH/DELETE), plus `/notificator/choices`. Map errors 503/502/400
  exactly like Leonid.
- `agent/app/schemas.py`: `Notificator<Entity>Response/Create/Update/Patch` per
  resource (`ConfigDict(extra="ignore")`).
- `agent/app/core/constants.py`: `AgentPath.NOTIFICATOR_*` for every resource;
  reuse existing `EnvKey.NOTIFICATOR_URL/TOKEN/REQUEST_TIMEOUT`,
  `HeaderName.X_NOTIFICATOR_TOKEN`; add `PermissionKey.NOTIFICATOR_WRITE`.
- Tests `agent/tests/test_notificator*.py`: mirror Leonid service/route tests
  (token attached, not-configured→503, unreachable→502, happy path,
  `?product_team=` forwarded, write bodies validated).

---

## Layer C — frontend plugin (`frontend/src/plugins/notificator/`, repo 2)

Model on `frontend/src/plugins/leonid/` (tables + create/edit/delete forms,
`<CompanionGate>`). Auto-registers via `import.meta.glob` — no manual registry.

- One tab per section actually needed (see discuss/18 Q1); each = a panel with a
  table + row actions. Phase 1 view-only; Phase 2 add create/edit/delete modals
  (copy `SharedResourcesPanel`/`ObjectsPanel` structure).
- `src/api/types.ts`: `Notificator<Entity>` types per resource.
- `src/api/agentClient.ts`: `list/create/update/delete Notificator<Entity>`
  helpers + `getNotificatorChoices` (readAgentJson/writeAgentJson).
- `src/constants.ts`: `AgentPath.NOTIFICATOR_*`, `buildAgentNotificator*Path`,
  `ViewKey/TabId/TabTitle.NOTIFICATOR_*`, `QueryKey.NOTIFICATOR_*`.
- Keep the existing **Notifications-by-team** panel as one of the tabs
  (group-by-team + modal is a genuine improvement over the flat admin list).
- Tests: per panel (renders rows; Phase 2: form submits expected payload).
  Update `src/plugins/discovery.test.ts` if it asserts the plugin's tab set.

---

## Layer D — backend permissions (`backend/`, repo 2)

- `backend/app/core/constants.py`: add `PermissionKey.NOTIFICATOR_WRITE =
  "notificator.write"` (READ already exists). PluginId.NOTIFICATOR already in
  `OPTIONAL_PLUGIN_IDS`.
- `backend/app/services/authorization.py`: admin auto-gets it (`tuple(PermissionKey)`);
  grant `NOTIFICATOR_READ/WRITE` to other roles per policy (mirror Leonid — likely
  admin-only for now).
- `seed_security_catalog` already seeds every `PermissionKey`, so the new key
  appears in `GET /security/permissions` automatically.
- Update any security-matrix test/snapshot that enumerates permission keys.

---

## Layer S — Administration/Security catalog fix (discuss/18 §7)

Real bug: the Security UI hardcodes permission lists in two files and they drifted
(`notificator.read` missing everywhere; `leonid.*` buried in "Other"). Backend is
correct and already exposes `GET /security/permissions`
(`backendClient.listSecurityPermissions`).

**Approach — catalog-driven (RESOLVED, discuss/18 Q3):**
- Drive `frontend/src/plugins/admin/security/RolesPanel.tsx` (`ALL_PERMISSIONS`)
  and `UsersMatrix.tsx` (`PERMISSION_DOMAINS`) from the `/security/permissions`
  catalog instead of the hardcoded arrays.
- Group by permission domain/plugin (derive the group from the key prefix, e.g.
  `notificator.*` → "Notificator", `leonid.*` → "Leonid"). Every future plugin's
  permission then appears in Security automatically — the stated requirement
  ("каждый плагин добавлять в Administration/Security").
- Keep the matrix's short-label / vertical-header rendering.
- Tests: RolesPanel/UsersMatrix render groups from a mocked catalog incl.
  `notificator.read`, `leonid.read`, `leonid.write`.

(Rejected fallback (b) — hardcoded-list patch — is NOT the chosen path; catalog
must be the single source so future plugins appear automatically.)

---

## Verification (memory `reference_verification_commands`)

- aut-notificator: run its own test suite (`pytest` / `manage.py test`).
- agent: `ruff format --check . && ruff check . && mypy app && pytest` (in `agent/`).
- backend: same trio (in `backend/`, mypy target `app`).
- frontend: `npm run lint && npx tsc --noEmit && npx vitest run` (in `frontend/`).
- Manual smoke (memory `reference_local_e2e_run`): point `AGENT_NOTIFICATOR_URL/TOKEN`
  at a running aut-notificator, open each tab, verify read (Phase 1) and
  create/edit/delete (Phase 2).

## Scope decisions (all RESOLVED 2026-08-25 — discuss/18 §8)

- Q1: CRUD only for notification_configs / products / sub_products / slack_channels;
  the other 9 sections are read-only.
- Q2: single token for read+write (one `HasNotificatorToken`).
- Q3: Security is catalog-driven (Layer S approach (a)).
- Q4: QAA members is read-only, its own `QAAMemberModel` entity.

Brief is ready for implementation.
