# Brief 33 — Notebook plugin (personal private notes over local files via the agent)

A **global "Notebook" plugin** for personal notes. Privacy is a hard requirement:
notes must **never** leave the user's machine — not the qaa-tms DB, not the
network. So notes are **plain text files on disk**, read/written through the
local **companion agent** (exactly like Stagings reads local resources), with the
master-folder path configured in **Profile→Settings**.

Design & decisions: `discuss/19`. Wiring pattern to copy: **Stagings**
(agent-backed local files) — NOT Leonid/Notificator (those proxy external HTTP
through the backend). The best per-file model is `agent/app/services/kubeconfig.py`
(read/write a local file at a settings-configured path, atomic `os.replace`).

Memory: `reference_staging_cli`, `environment_agent_port_collision`,
`project_env_consolidation`, `reference_verification_commands`.

---

## On-disk layout (source of truth — see discuss/19 §1)

```
<master-folder>/
  __contents__            # JSON: the bookmark tree (names, nesting, order)
  <bookmark-name>/        # folder = bookmark; contains ONLY note files
    2026-08-25-14-30-05
    2026-08-25-16-12-40
  <bookmark-name>/
    ...
```

- **Note** = plain text file, name `yyyy-MM-dd-hh-mm-ss`, body = raw text. **No
  inline metadata / frontmatter** — the file is pure text. Existence, date and
  order come from the folder + filename (source of truth), NOT from the JSON.
- **Bookmark** = folder; folder name = bookmark name (human-readable, rename =
  folder rename). Note count = number of files in the folder.
- **`__contents__`** (JSON) holds two things: (a) the bookmark tree (names,
  nesting, order) and (b) **all flags/metadata** as a **sparse overlay** — the
  central "store anything" file. A bookmark node is `{name, children?, flags?}`;
  note flags are keyed by filename. Only entries that HAVE flags appear in the
  JSON (absent = no flags), so the JSON never has to enumerate every note and the
  FS↔JSON self-heal (Q2) holds. v1 provisions the flags container but populates
  nothing (important/archive are backlog); adding a flag later is a JSON-only change.
  v1 UI is a flat bookmark list; the tree already supports nesting (backlog).

---

## Scope (v1)

- Bookmarks: flat list with per-bookmark note counts; create / rename / delete.
- Notes: create / open / edit / delete; body is plain text.
- Bookmark page: **1/3** note table (date + first-3-lines preview) · **2/3** full
  text of the selected note.
- Search across all bookmarks — over note text.
- Privacy comes from data location (local), not crypto.

Out of scope (backlog, discuss/19 §6): tabs, nested-bookmark UI, note title,
source, archive, importance marker, "send to notebook" from other plugins,
cross-device sync.

---

## Layer AG — Agent (`agent/`)

Mirror `staging_kubeconfig` for the config field and `kubeconfig.py` for the
service (read/write local file, atomic write via `os.replace`).

1. `agent/app/core/constants.py`
   - `EnvKey`: add `NOTEBOOK_ROOT = "AGENT_NOTEBOOK_ROOT"`.
   - Add default near `DEFAULT_STAGING_KUBECONFIG`: `DEFAULT_NOTEBOOK_ROOT = "~/qaa-notebook"`.
   - `AgentPath`: add `NOTEBOOK_CONTENTS`, `NOTEBOOK_BOOKMARK`, `NOTEBOOK_NOTE`,
     `NOTEBOOK_SEARCH` (paths under `/notebook/...`).
   - `PermissionKey`: add `NOTEBOOK_READ = "notebook.read"`, `NOTEBOOK_WRITE = "notebook.write"`.
     (Keep in sync with backend `PermissionKey` — Layer BE.)
2. `agent/app/core/config.py` — `Settings`: add
   `notebook_root: str = Field(default=DEFAULT_NOTEBOOK_ROOT, alias=EnvKey.NOTEBOOK_ROOT.value)`
   (pattern of `staging_kubeconfig`). `.expanduser()` applied in the service.
3. `agent/app/services/notebook.py` (new) — root = `Path(settings.notebook_root).expanduser()`:
   - `read_contents(settings)` → parse root `__contents__` JSON (missing → empty tree).
   - `list_bookmarks(settings)` → tree + note counts + flags overlay (reconcile
     with real folders, discuss/19 Q2: folders not in JSON appear at the end; JSON
     entries without a folder/file are ignored). Merge flags from `__contents__`
     onto bookmarks/notes; missing entry = no flags.
   - `list_notes(settings, bookmark)`, `read_note(settings, bookmark, name)`.
   - `write_note`, `delete_note`, `create_bookmark`, `rename_bookmark`,
     `delete_bookmark`, `write_contents` (atomic, reuse the `os.replace` idiom).
   - `set_flags(settings, bookmark[, note], flags)` → sparse-update `__contents__`
     (write flags for that node/note; drop the entry entirely when flags become
     empty, to keep the overlay sparse). v1 exposes no flag in the UI but the
     service + JSON shape must already support it (extension point).
   - `search(settings, query)` → scan note files' text.
   - Errors: `NotebookRootMissingError` etc. (pattern `KubeconfigDownloadFailedError`).
   - **PATH-TRAVERSAL GUARD (required, discuss/19 D5):** resolve every
     bookmark/note target and assert it is inside `notebook_root`; reject
     otherwise. Client supplies relative paths — unlike kube/staging.
   - Note-name generation `yyyy-MM-dd-hh-mm-ss` is the agent's job (agent owns the
     clock); on collision within the same second, append `-1`, `-2`, …
4. `agent/app/api/routes.py`
   - Auth deps next to the Stagings ones:
     `NotebookReadAuth = Annotated[AuthContext, Depends(require_permission(PermissionKey.NOTEBOOK_READ))]`
     and `NotebookWriteAuth`.
   - Add GET/PUT/POST/DELETE routes (model `get_namespaces`); map service
     exceptions → `HTTPException` (503 missing root / 400 bad path / 404).
   - Register the settings field in `AGENT_SETTINGS_ENV_KEY_BY_FIELD`:
     `"notebook_root": EnvKey.NOTEBOOK_ROOT` (makes it PUT-persistable + hot-reloaded).
5. `agent/app/schemas.py`
   - `AgentSettingsRead` / `AgentSettingsUpdate` / `to_agent_settings_read`: add
     `notebook_root`.
   - Add response models for tree / note / search (pattern `KubeconfigStatus`,
     `NamespaceListResponse`).
   - `env_file.upsert_env_values` is generic — no change.
6. CORS: no change. New routes inherit `AGENT_CORS_ORIGINS` automatically.
7. `agent/.env.example`: document `AGENT_NOTEBOOK_ROOT`.

Tests: new `agent/tests/test_notebook.py` modelled on `test_kubeconfig.py` +
`test_settings.py`; MUST include path-traversal rejection cases.

---

## Layer FE — Frontend (`frontend/src/`)

Plugins auto-discover via `import.meta.glob("./*/manifest.tsx")`
(`plugins/discovery.ts`), so a manifest + enum entries is enough — no edits to
discovery/registry/context.

1. `frontend/src/plugins/notebook/manifest.tsx` (new) — copy `leonid/manifest.tsx`
   (agent-backed). `definePlugin({ id: PluginId.NOTEBOOK, kind: OPTIONAL,
   origin: BUILTIN, requiresAgent: true, route: "/notebook", order: <n>, tabs: [...] })`.
   `requiresAgent:true` gates it behind the companion (CompanionGate, as Stagings).
2. `frontend/src/plugins/notebook/NotebookSection.tsx` (+ panels) — mirror
   `LeonidSection.tsx`; build the "bookmark list + 1/3 table + 2/3 body" screen and
   the search box.
3. `frontend/src/constants.ts` — extend object-enums:
   - `PluginId`: `NOTEBOOK: "notebook"`.
   - `IconName`: add a token + wire it in the icon map.
   - `ViewKey`, `TabId`: add `NOTEBOOK_*` per tab.
   - `TabTitle` (`Record<TabId,string>`): add titles for every new `TabId`
     (won't compile otherwise).
   - `AgentPath`: add `NOTEBOOK_*` mirroring the agent strings + `buildAgent*Path`
     helpers for parameterized bookmark/note paths.
   - `QueryKey`: add note query keys.
4. `frontend/src/api/agentClient.ts` — add methods (`getNotebookTree`,
   `listNotes`, `readNote`, `writeNote`, `deleteNote`, `createBookmark`,
   `renameBookmark`, `deleteBookmark`, `searchNotes`) following `listNamespaces`
   (GET) and `updateSettings` (PUT-with-body via `createJsonBody(..., PUT)`).
   Same `127.0.0.1:<port>` + bearer + `X-QAA-TMS` header path.
5. `frontend/src/api/types.ts`: add `notebook_root` to `AgentSettings` +
   `AgentSettingsUpdate`; add note/tree DTO types.

---

## Layer SET — Profile → Settings (master-folder path field)

`frontend/src/plugins/profile/SettingsPanel.tsx` — exactly where
`staging_kubeconfig` (a path) is surfaced:
- `SettingsPanelCopy`: add `NOTEBOOK_TITLE`, `NOTEBOOK_ROOT_LABEL`, `NOTEBOOK_DESCRIPTION`.
- `AgentFormState` + `buildAgentFormState`: add `notebook_root` from `settings.notebook_root`.
- Add `notebookUpdateMutation` (pattern `stagingsUpdateMutation` → `agentClient.updateSettings`)
  and `saveNotebookSettings` (pattern `saveStagingsSettings`).
- Add a `<CardShell>` with a plain `TextInput` for the path, gated by
  `showNotebook = enabledPluginIds.has(PluginId.NOTEBOOK)` (pattern: Stagings
  kubeconfig card); include `showNotebook` in `hasEnabledAgentPlugins` and pass it
  into `SettingsPanelAgentSettings`.

Agent-side of this field is already covered in Layer AG (5) + the
`AGENT_SETTINGS_ENV_KEY_BY_FIELD` registration.

---

## Layer BE — Backend permissions / Administration→Security

Security catalog is auto-seeded from the enum (discuss/18 §7), so the enum member
is the only required edit for it to appear in Administration→Security.

1. `backend/app/core/constants.py`
   - `PermissionKey`: add `NOTEBOOK_READ = "notebook.read"`, `NOTEBOOK_WRITE = "notebook.write"`.
   - `PluginId`: add `NOTEBOOK = "notebook"`; add it to `OPTIONAL_PLUGIN_IDS`.
2. `backend/app/services/authorization.py`
   - `ROLE_SEEDS`: `SUPERADMIN` gets it automatically (`tuple(PermissionKey)`).
     Add `NOTEBOOK_READ`/`WRITE` to `ADMINISTRATOR` and `ENGINEER` tuples (personal
     notebook → any authenticated engineer should have both).
   - `PERMISSION_SEEDS` / `seed_security_catalog` / `resolve_permissions` — no edit.
3. Enforcement: the agent's `require_permission(PermissionKey.NOTEBOOK_READ/WRITE)`
   resolves via backend `POST /authz/check` (agent `deps.py`). No new backend route.

> **Sync note:** `PermissionKey` exists in both `agent/` and `backend/`;
> `PluginId`/`OPTIONAL_PLUGIN_IDS` in both `backend/constants.py` and
> `frontend/constants.ts`. Extend all copies consistently. `CONTRACT_VERSION` — no bump.

---

## Decisions (all resolved 2026-08-25 — discuss/19 §7)

- Q1. `__contents__` = bookmark tree + **sparse flags overlay**. Bookmark node
  `{name, children?, flags?}`; note flags keyed by filename. Flags optional/sparse
  (absent = none), free-form object `{<flag>: true|value}`, keys added as needed.
  v1 provisions the container, populates nothing (important/archive → backlog).
  Order = array order; human-readable folder is the bookmark key.
- Q2. FS↔JSON drift: self-heal — folders not in JSON shown at the end; JSON
  entries without a folder/file ignored, cleaned lazily. FS is the source of truth
  for existence; `__contents__` is an overlay on top.
- Q3. Default `notebook_root = ~/qaa-notebook`; auto-create the folder on first
  write if absent.

---

## Verification (per `reference_verification_commands`)

- agent: `ruff` + `mypy app` + `pytest` (add `test_notebook.py`, incl. traversal).
- frontend: `eslint` + `tsc` + `vitest`.
- backend: `ruff` + `mypy app` + `pytest` (role-seed/permission additions).
