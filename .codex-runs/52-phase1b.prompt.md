Implement **Phase 1b ONLY** from `discuss/.codex-brief-52-local-plugins.md`. Do not start Phase 1c/2/3 — stop after Phase 1b is complete and green.

Read the full brief first. §0, §1 (esp. the `plugin.json` schema and package layout), and the "PHASE 1b" section are the binding spec. Phase 1a already landed (the frontend plugin registry is now a runtime store with `setLocalPlugins`) — do not redo it.

Phase 1b scope (agent-side folder setting + scan + serve):

1. **Setting** (`AGENT_LOCAL_PLUGINS_DIR`), persisted to `~/.qaa-tms/.env` via the existing agent settings mechanism:
   - Add `EnvKey.LOCAL_PLUGINS_DIR` in `agent/app/core/constants.py`.
   - Add `local_plugins_dir: str | None` (default None) to `Settings` in `agent/app/core/config.py`.
   - Register it in `AGENT_SETTINGS_ENV_KEY_BY_FIELD` (`agent/app/api/routes.py`, ~line 295) and in `AgentSettingsRead`/`AgentSettingsUpdate` (`agent/app/schemas.py`) + `to_agent_settings_read`, so it round-trips through the settings PATCH→.env write path exactly like `kubeconfig`/`staging_bin`.
   - Frontend Profile → Settings: add a text field for the folder path, wired like the existing agent-settings fields. Verify the Profile settings form location (likely `frontend/src/plugins/profile/…`, e.g. SettingsPanel).

2. **Service** `agent/app/services/local_plugins.py` + routes in `agent/app/api/routes.py`:
   - `GET /plugins` (add `AgentPath.PLUGINS = "/plugins"`). If `local_plugins_dir` empty/missing/unreadable → return `{"plugins": [], "warnings": []}` (never 500; feature is optional). Otherwise scan immediate subdirectories; for each with a readable `plugin.json`, validate against the §1 schema (id/label/icon/route/order/contractVersion/entry/tabs; route starts with "/"; contractVersion within the host's supported range; `entry` path stays inside the plugin dir). On invalid → skip that plugin, append `{"dir": ..., "error": ...}` to `warnings`, never fail the whole request. Enforce unique `id`; on dup, skip the later with a warning. Return metadata + a resolved `entryUrl` the frontend appends to the asset route (e.g. `/plugins/<id>/assets/dist/index.js`).
   - `GET /plugins/{plugin_id}/assets/{path:path}` — serve a static file from the plugin dir. **Path-traversal guard**: resolve the requested path and assert it is within `local_plugins_dir/<plugin_id>/`; 404 otherwise. Set correct Content-Type (.js → text/javascript, .svg, .css, …).
   - **Auth: `require_auth` only — NO `require_permission`.** Local plugins are RBAC-exempt by design.
   - Reuse the agent's existing CORS handling (the portal origin is already allowed).

Do NOT: build the frontend runtime loader, `mount` rendering of local plugins, the RBAC-bypass in `pluginVisible`, the SDK, or touch Notebook/Requests. Those are later phases.

Verification gates (all must pass, do not weaken types):
- Agent: `ruff`, `mypy app` (target is `app`, not `.`), `pytest`.
- Frontend (for the Profile settings field): eslint, `tsc --noEmit`, vitest.
Add agent tests per the brief's Phase 1b acceptance: empty/missing dir → []; one valid plugin → returned; one invalid plugin.json → skipped + warning while valid siblings return; duplicate id → one skipped; asset route serves a file AND rejects `../` traversal (never escapes the plugin dir).

When done, print a short summary of: files changed, the new routes + their auth, the settings field wiring, and confirmation that all gates pass.
