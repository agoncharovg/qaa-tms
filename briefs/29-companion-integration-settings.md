# Brief 29 — Notificator & Leonid tokens in Profile → Settings (companion `.env`)

STATUS: ready for implementation. Executor: Codex. Author/reviewer: Claude.
Created 2026-08-25. Relates to discuss/16 (Leonid per-env token debt) and
brief 27 (Notificator plugin).

## Problem

The Notificator and Leonid plugins are `requiresAgent: true` — their data flows
through the **local companion agent**, which reads `AGENT_NOTIFICATOR_URL/TOKEN`
and `AGENT_LEONID_URL/TOKEN` from its own `.env`.

But **neither service is wired into Profile → Settings**. The settings surface
(`AGENT_SETTINGS_ENV_KEY_BY_FIELD` in `agent/app/api/routes.py`) only knows
jenkins / kube / staging / qaa_generator fields. Consequences:

- A user cannot set the Notificator/Leonid URL or token from the UI.
- The only way to configure them today is to hand-edit the *installed* companion's
  `.env` under `.companion-install/<date>/agent/.env` — which does **not** survive
  a companion refresh/reinstall (a new dated install dir regenerates `.env`).

We already verified end-to-end that the deployed preprod API works
(`https://notificator-preprod.i.gc.onl/notification_configs/` → 200 with the real
token, 403 with a wrong token). The only missing piece is a durable, UI-driven way
to give the companion the URL + token. This is exactly the discuss/16 debt for
Leonid, and now the same gap for Notificator.

## Goal

Add `notificator_url`, `notificator_token`, `leonid_url`, `leonid_token` to the
companion settings surface so they can be edited in Profile → Settings and
persisted by the agent to its own `.env` (surviving refresh). Mirror the existing
patterns exactly — **do not invent new mechanisms**.

Secrets are **write-only**: the read schema exposes only a `*_token_set: bool`
(never the token value), identical to `jenkins_token` / `qaa_generator_token`.

Scope is the **companion agent + frontend only**. The k8s backend does NOT consume
`AGENT_NOTIFICATOR_*` / `AGENT_LEONID_*` (the plugins never route through it), so
**no qaa-deploy / backend changes** are needed. Each user enters their own token
(shared service token from Vault) on their own machine, same model as the Jenkins
personal token.

## What already exists (do not re-create)

- `agent/app/core/config.py`: fields `notificator_url` (default
  `DEFAULT_NOTIFICATOR_URL`), `notificator_token` (default `""`), `leonid_url`
  (default `DEFAULT_LEONID_URL`), `leonid_token` (default `""`), each aliased to the
  corresponding `EnvKey`. Properties `notificator_configured`,
  `leonid_configured`, `leonid_write_configured`. A `field_validator("notificator_url",
  "leonid_url", mode="before")` normalizes the URLs. **No config changes needed.**
- `agent/app/core/constants.py`: `EnvKey.NOTIFICATOR_URL = "AGENT_NOTIFICATOR_URL"`,
  `EnvKey.NOTIFICATOR_TOKEN = "AGENT_NOTIFICATOR_TOKEN"`, `EnvKey.LEONID_URL =
  "AGENT_LEONID_URL"`, `EnvKey.LEONID_TOKEN = "AGENT_LEONID_TOKEN"`. **Already there.**
- `frontend/src/constants.ts`: `PluginId.NOTIFICATOR`, `PluginId.LEONID`. **Already there.**

## Layer A — agent (`agent/`)

All in `agent/app/schemas.py` and `agent/app/api/routes.py`. Mirror the
`jenkins_token` (write-only secret + `jenkins_token_set`) and `jenkins_url` (plain
string) fields exactly.

A1. `agent/app/schemas.py` → `AgentSettingsRead` (currently line ~61): add
    ```
    notificator_url: str
    notificator_token_set: bool
    leonid_url: str
    leonid_token_set: bool
    ```

A2. `agent/app/schemas.py` → `AgentSettingsUpdate` (currently line ~87): add
    ```
    notificator_url: str | None = None
    notificator_token: str | None = None
    leonid_url: str | None = None
    leonid_token: str | None = None
    ```

A3. `agent/app/schemas.py` → `to_agent_settings_read()` (currently line ~345): add
    ```
    notificator_url=settings.notificator_url,
    notificator_token_set=bool(settings.notificator_token),
    leonid_url=settings.leonid_url,
    leonid_token_set=bool(settings.leonid_token),
    ```

A4. `agent/app/api/routes.py` → `AGENT_SETTINGS_ENV_KEY_BY_FIELD` (line ~235): add
    ```
    "notificator_url": EnvKey.NOTIFICATOR_URL,
    "notificator_token": EnvKey.NOTIFICATOR_TOKEN,
    "leonid_url": EnvKey.LEONID_URL,
    "leonid_token": EnvKey.LEONID_TOKEN,
    ```
    `build_env_updates` iterates `payload.model_fields_set`, so only fields the
    client actually sends get written — no extra logic needed. `notificator_url` /
    `leonid_url` are runtime fields; confirm `merge_runtime_settings` /
    `AGENT_SETTINGS_RUNTIME_FIELDS` pick them up automatically (they derive from the
    same map — verify, no change expected).

A5. Tests (`agent/tests/`): mirror the existing qaa_generator/jenkins settings tests
    (see `agent/tests/test_config.py` and whichever test covers
    `update_companion_settings`).
    - Read returns `notificator_url`/`leonid_url` and `*_token_set` booleans;
      never returns the token value.
    - PUT with `notificator_url` + `notificator_token` writes both env keys to the
      agent `.env` and reloads (`notificator_token_set` becomes true; value absent
      from the read response).
    - PUT with only `notificator_token` leaves the URL untouched.
    - Same for leonid.

## Layer B — frontend (`frontend/`)

B1. `frontend/src/api/types.ts`:
    - `AgentSettings` (line ~145): add `notificator_url: string;
      notificator_token_set: boolean; leonid_url: string; leonid_token_set: boolean;`
    - `AgentSettingsUpdate` (line ~167): add `notificator_url?: string;
      notificator_token?: string; leonid_url?: string; leonid_token?: string;`

B2. `frontend/src/plugins/profile/SettingsPanel.tsx` — add two cards mirroring the
    **Jenkins card** (which already combines a URL `TextInput` + a token
    `PasswordInput` with `*Set`/dirty state + Clear + Save + its own mutation).
    - Gate each card by plugin visibility, exactly like the others:
      `const showNotificator = enabledPluginIds.has(PluginId.NOTIFICATOR);`
      `const showLeonid = enabledPluginIds.has(PluginId.LEONID);` (line ~561).
    - Add both to `hasEnabledAgentPlugins` (line ~565) and pass `showNotificator` /
      `showLeonid` props down (line ~192 destructure, ~199 prop types, ~597 call site).
    - Extend `agentForm` state with `notificatorUrl`, `notificatorToken`,
      `notificatorTokenDirty`, `notificatorTokenSet`, and the leonid equivalents,
      initialized from `settings.notificator_url` / `settings.notificator_token_set`
      etc. (mirror the jenkins fields at lines ~96–115).
    - Two new `useMutation`s calling `agentClient.updateSettings(...)`, mirroring
      `jenkinsUpdateMutation` / `saveJenkinsSettings` (lines ~346): send `*_url`
      always, and `*_token` only when the token field is dirty.
    - New `SettingsPanelCopy` entries (titles/labels/descriptions) and
      `SECRET_INPUT_NAME` entries for the two tokens, mirroring the jenkins ones.
      Suggested copy: Notificator — title "Notificator", URL label "Service URL",
      token label "Service token", description noting it is a shared service token
      written to the local companion `.env` on this machine. Leonid — analogous.
    - Reuse `SECRET_SET` / `NOT_SET` for the token description, `CLEAR_SECRET` for
      the clear button, `UPDATE_SUCCESS` for the notice.

B3. Tests: extend `frontend/src/plugins/profile/SettingsPanel.test.tsx` (and any
    settings-form test) — cards appear only when the plugin is enabled; saving the
    URL + token sends the expected `AgentSettingsUpdate`; the token input is
    write-only (shows set/not-set, never a prefilled value).

## Gotchas / constraints

- **Write-only secrets**: never put `notificator_token` / `leonid_token` in
  `AgentSettingsRead` or `AgentSettings` (frontend). Only the `*_token_set` boolean.
- **Only send changed fields**: the token must be sent only when its input was
  edited (dirty), or an empty save would blank the stored token. The URL can be
  sent every save (it round-trips through the read).
- **No backend / qaa-deploy changes.** This is companion-local config.
- Do not touch `notificator_request_timeout` / `leonid_request_timeout` — leave them
  env/default only (not exposed in the UI), consistent with how request timeouts are
  handled today.
- Keep field ordering and style consistent with the surrounding jenkins/qaa_generator
  code; match existing naming conventions.

## Verification (per reference_verification_commands)

- agent: `ruff check app && ruff format --check app && mypy app && pytest`
  (run from `agent/`; mypy target is `app`, not `.`).
- frontend: `npm run lint && npx tsc --noEmit && npx vitest run`
  (run from `frontend/`).

## Acceptance

1. With the Notificator (and/or Leonid) plugin enabled, Profile → Settings shows a
   card to set the service URL + token; saving persists them to the running
   companion's `.env` and the token shows as "set" without ever echoing the value.
2. After restarting the companion (or via the normal reload), the Notificator plugin
   loads `/notificator/notification_configs` successfully against
   `notificator-preprod.i.gc.onl`.
3. The config survives a companion refresh (no more hand-editing the install `.env`).
4. All verification commands pass.
