# Brief 34 — Assistant plugin (shared LLM access via personal keys, embeddable; first consumer = Kuber/Pods)

A shared **Assistant** plugin that talks to an LLM using the user's **personal
API keys** (Anthropic + OpenAI for now), configured in **Profile → Settings**
along with the **list of available models**. The plugin is both:

- a standalone free-chat tab;
- a shared frontend module that other plugins embed.

First embed: **Kuber / Pods**. An **Ask AI** action in the pod drawer opens a
chat seeded with `{context, namespace, pod}`. The model pulls pod detail on
demand via **read-only kube tools** instead of dumping `describe` up front.

Design and decisions: `discuss/20`.

Reference patterns already present in `qaa-tms` and verified against the real
repo:

- **Kuber**: local-agent transport, `kubectl` helpers, SSE log streaming,
  per-plugin settings card.
- **Notebook**: optional builtin plugin + local agent + Profile settings wiring.
- **Leonid / Notificator**: builtin plugin manifests / sections / tabs shape.

Reference studied for LLM orchestration: `~/Projects/qaa-e2e/ai/scripts/qaa_orchestrator`
specifically `main.py`, `graph.py`, `config.py`,
`runners/claude_runner.py`, `runners/codex_runner.py`, and
`ai/scripts/ai-requirements.txt`. We borrow its model-config shape, provider
routing, usage / cost parsing, and transient-retry list. We do **not** borrow
its CLI transport.

## Critical corrections vs generic assumptions

- The agent uses **`pyproject.toml`**, not `requirements/`. Add SDK deps in
  `agent/pyproject.toml` and refresh `agent/uv.lock`.
- In current `qaa-tms` secret-setting semantics, **omitting a field means
  "leave unchanged"**. Sending an explicit empty string means **clear it**.
  Assistant keys must follow the same contract as `jenkins_token` and
  `qaa_generator_token`.
- `frontend/src/plugins/discovery.ts` and `frontend/src/plugins/catalog.ts`
  need **no manual registry edits**. A new `manifest.tsx` is enough for
  frontend discovery. Backend still needs explicit `OPTIONAL_PLUGIN_IDS`.
- `agent/app/services/command.py` already exists and already supports `env=...`.
  Do **not** re-extract subprocess helpers again.

---

## Model config shape

Provider keys are separate. Models are stored as JSON and parsed agent-side.

Provider key fields:

- `llm_anthropic_key`
- `llm_openai_key`

Models field:

- `llm_models` = JSON array of:
  `{label, provider, model_id, params?}`

Rules:

- `label`: display name shown in the model picker.
- `provider`: `"anthropic"` or `"openai"`.
- `model_id`: raw provider model id; **user-entered, never hardcoded**.
- `params`: free-form JSON object merged into the provider request
  (`reasoning_effort`, `max_tokens`, ...).

Recommended storage contract:

- agent `.env`: `AGENT_LLM_ANTHROPIC_KEY`, `AGENT_LLM_OPENAI_KEY`,
  `AGENT_LLM_MODELS`
- agent settings GET: never echo key values, only `*_set: bool`
- agent settings PUT: key fields are optional; if omitted they stay unchanged;
  if provided as `""` they clear the stored secret

---

## Scope

- **Phase 1**: provider abstraction, Anthropic/OpenAI SDK adapters, free chat
  over SSE, settings card, standalone Assistant tab, permissions.
- **Phase 2**: read-only kube tool-use, Kuber embed, Ask AI action in pod UI.
- **Phase 3**: backend plugin / permission seeding, default-enabled plugin list,
  test completion.

Out of scope / backlog:

- formal `HostApi.llm`
- CLI power mode (`claude -p` / `codex exec`)
- conversation persistence
- mid-conversation model switching
- privacy consent checkbox
- tool-use for non-Kuber plugins

---

## Layer AG — Agent (`agent/`)

### 1. `agent/app/core/constants.py`

Add:

- `AgentPath.LLM_MODELS = "/llm/models"`
- `AgentPath.LLM_CHAT = "/llm/chat"`
- `EnvKey.LLM_ANTHROPIC_KEY = "AGENT_LLM_ANTHROPIC_KEY"`
- `EnvKey.LLM_OPENAI_KEY = "AGENT_LLM_OPENAI_KEY"`
- `EnvKey.LLM_MODELS = "AGENT_LLM_MODELS"`
- `PermissionKey.ASSISTANT_USE = "assistant.use"`
- `DEFAULT_LLM_MODELS = "[]"`

Also add small typed enums/constants instead of inline literals:

- `LlmProvider` string enum: `ANTHROPIC`, `OPENAI`
- `ToolsNamespace` string enum: at least `KUBE`
- `LlmStreamEvent` string enum for SSE:
  `TEXT_DELTA`, `TOOL_START`, `TOOL_RESULT`, `USAGE`, `DONE`, `ERROR`
- read-only assistant tool names, for example:
  `KUBE_DESCRIBE_POD`, `KUBE_READ_POD_LOGS`, `KUBE_READ_POD_EVENTS`,
  `KUBE_TOP_PODS`

For Phase 2, extend kube constants for internal read helpers:

- `KubectlFlag.FIELD_SELECTOR`
- `KubectlFlag.SORT_BY`

Only if needed for pod-event fetching.

### 2. `agent/app/core/config.py`

Add to `Settings`:

- `llm_anthropic_key: str = Field(default="", alias=EnvKey.LLM_ANTHROPIC_KEY.value)`
- `llm_openai_key: str = Field(default="", alias=EnvKey.LLM_OPENAI_KEY.value)`
- `llm_models: str = Field(default=DEFAULT_LLM_MODELS, alias=EnvKey.LLM_MODELS.value)`

Keep `llm_models` as raw string in settings; parse it in the LLM service layer,
not in BaseSettings.

### 3. `agent/app/services/sse.py`

Current `encode_sse()` is typed around the job-stream enum. Reuse it instead of
forking a second encoder:

- widen the signature to accept `str | StrEnum`, or at least any string enum
- keep job-stream behavior unchanged

`frontend/src/api/sse.ts` already accepts arbitrary event names, so this small
typing change is enough to reuse the common SSE encoder.

### 4. `agent/app/services/kube.py`

Reuse existing safe helpers instead of adding a second kubectl layer.

Already present and reusable:

- `validate_kube_name`
- `validate_context_name`
- `list_pods`
- `describe_pod`
- `top_pods`
- `build_pod_logs_argv`

Add **internal read-only helpers** for Assistant tool-use:

- `read_pod_logs(...) -> PlainTextCommandResult`
  Uses existing `build_pod_logs_argv(..., follow=False, ...)` plus
  `run_plain_text_command(...)`. Assistant needs a finite string result, not
  the SSE stream used by the Pods UI.
- `read_pod_events(...) -> PlainTextCommandResult`
  New one-shot helper for events of a single pod.
- optional helper `list_pod_names(...)` only if the tool layer needs discovery;
  otherwise keep the tool surface tighter and skip it.

Do **not** add any mutating tool paths here. Assistant only consumes internal
read helpers.

### 5. `agent/app/services/llm/` (new package)

Create a dedicated package, for example:

- `agent/app/services/llm/__init__.py`
- `agent/app/services/llm/models.py`
- `agent/app/services/llm/provider.py`
- `agent/app/services/llm/anthropic_provider.py`
- `agent/app/services/llm/openai_provider.py`
- `agent/app/services/llm/retry.py`
- `agent/app/services/llm/service.py`

Responsibilities:

- `models.py`
  - parse `settings.llm_models`
  - define `ModelSpec`
  - resolve selected model label to provider + model_id + params
  - raise clear typed errors for bad JSON, unknown label, or missing key
- `provider.py`
  - define the provider protocol, for example
    `stream(messages, model_spec, tools) -> AsyncIterator[LlmProviderEvent]`
  - define provider-side event DTOs
- `anthropic_provider.py`
  - use Anthropic streaming Messages API
  - map text deltas, tool calls, usage, errors
- `openai_provider.py`
  - use OpenAI streaming API
  - map text deltas, tool calls, usage, errors
- `retry.py`
  - reuse transient classifications verified in `qaa_orchestrator`
    (`overloaded`, `rate limit`, `service unavailable`, `too many requests`,
    `model is at capacity`, `server error`, `internal error`,
    `request timed out`)
- `service.py`
  - build the message history from system prompt + optional seed context +
    conversation messages
  - stream SSE frames
  - Phase 2: run the read-only tool loop and feed tool results back to the
    provider until completion or `LLM_MAX_TOOL_TURNS`

Phase 2 tool dispatcher rules:

- seed only with identifiers: `context`, `namespace`, `pod`
- validate all model-supplied args with `validate_context_name` /
  `validate_kube_name`
- hard error on unknown tool names
- never shell out through generic bash

### 6. `agent/app/api/routes.py`

Add new auth alias beside `KuberReadAuth` / `NotebookReadAuth`:

- `AssistantAuth = Annotated[AuthContext, Depends(require_permission(PermissionKey.ASSISTANT_USE))]`

Register new settings fields in `AGENT_SETTINGS_ENV_KEY_BY_FIELD`:

- `"llm_anthropic_key": EnvKey.LLM_ANTHROPIC_KEY`
- `"llm_openai_key": EnvKey.LLM_OPENAI_KEY`
- `"llm_models": EnvKey.LLM_MODELS`

Add routes:

- `GET AgentPath.LLM_MODELS`
  - response = non-secret model metadata only
  - no API keys ever returned
- `POST AgentPath.LLM_CHAT`
  - returns `StreamingResponse`
  - reuse `_build_sse_response(...)`
  - request body includes selected model, message history, optional seed context,
    and optional tools namespace

Keep the route agent-only. There is no backend proxy route.

### 7. `agent/app/schemas.py`

Extend settings read/update:

- `AgentSettingsRead`
  - `llm_models: str`
  - `llm_anthropic_key_set: bool`
  - `llm_openai_key_set: bool`
- `AgentSettingsUpdate`
  - `llm_models: str | None = None`
  - `llm_anthropic_key: str | None = None`
  - `llm_openai_key: str | None = None`
- `to_agent_settings_read()`
  - fill `*_set` booleans from actual settings values
  - never expose raw keys

Add LLM DTOs in the same file, matching current repo style:

- `LlmModelInfo`
- `LlmChatMessage`
- `LlmSeedContext`
- `LlmChatRequest`
- SSE payload models for:
  - text delta
  - tool start
  - tool result
  - usage
  - done
  - error

Use the same aliasing conventions the file already uses for camelCase response
fields where appropriate.

### 8. `agent/pyproject.toml` and `agent/uv.lock`

Add runtime dependencies in `agent/pyproject.toml`:

- `anthropic`
- `openai`

Use the same starting versions already present in
`~/Projects/qaa-e2e/ai/scripts/ai-requirements.txt` unless there is a deliberate
upgrade:

- `anthropic==0.116.0`
- `openai==2.44.0`

Refresh `agent/uv.lock` after dependency changes.

### 9. `agent/.env.example`

Document:

- `AGENT_LLM_ANTHROPIC_KEY`
- `AGENT_LLM_OPENAI_KEY`
- `AGENT_LLM_MODELS`

### 10. Agent tests

Update / add:

- `agent/tests/test_settings.py`
  - fixture env includes new vars
  - GET `/settings` masks keys and returns `*_set`
  - PUT `/settings` round-trips `llm_models`
  - explicit `""` clears keys
- `agent/tests/test_kube.py`
  - extend if new internal kube event / log helpers need unit coverage
- `agent/tests/test_llm.py` (new)
  - model parsing
  - provider selection
  - transient retry classification
  - tool-loop with a fake provider
  - read-only enforcement

---

## Layer FE — Frontend shared chat (`frontend/src/`)

Frontend plugin discovery is already automatic via
`frontend/src/plugins/discovery.ts`. Do not edit discovery or catalog logic.

### 1. `frontend/src/constants.ts`

Add:

- `PluginId.ASSISTANT = "assistant"`
- `IconName.ASSISTANT = "assistant"`
- `AgentPath.LLM_MODELS = "/llm/models"`
- `AgentPath.LLM_CHAT = "/llm/chat"`
- `ViewKey.ASSISTANT_CHAT = "assistant-chat"`
- `TabId.ASSISTANT_CHAT = "tab-assistant-chat"`
- `TabTitle[TabId.ASSISTANT_CHAT] = "Assistant"`
- `QueryKey.LLM_MODELS = "llm-models"`
- `LlmProvider` const object
- `LlmStreamEvent` const object
- `ToolsNamespace.KUBE = "kube"`

Add path builders only if they help readability:

- `buildAgentLlmModelsPath()`
- `buildAgentLlmChatPath()`

Since both endpoints are fixed, plain constants are also acceptable.

### 2. `frontend/src/core/plugins/icons.ts`

Add a distinct Assistant icon. Do not reuse `IconName.SPARKLES` because that is
already used by QAA Generator.

Recommended:

- import `IconMessageChatbot` or similar Tabler icon
- register `[IconName.ASSISTANT]: IconMessageChatbot`

### 3. `frontend/src/api/types.ts`

Extend `AgentSettings`:

- `llm_models: string`
- `llm_anthropic_key_set: boolean`
- `llm_openai_key_set: boolean`

Extend `AgentSettingsUpdate`:

- `llm_models?: string`
- `llm_anthropic_key?: string`
- `llm_openai_key?: string`

Add frontend DTOs for:

- `LlmModelInfo`
- `LlmChatMessage`
- `LlmSeedContext`
- `LlmChatRequest`
- `LlmTextDeltaEvent`
- `LlmToolStartEvent`
- `LlmToolResultEvent`
- `LlmUsageEvent`
- `LlmDoneEvent`
- `LlmErrorEvent`
- `LlmStreamMessage`

### 4. `frontend/src/api/agentClient.ts`

Current `streamAgentCommand()` is job-stream specific and hardcodes:

- `GET`
- job-event parsing (`log` / `terminal`)

Do not overload that blindly. Add a small generic SSE helper and keep existing
job behavior intact.

Recommended refactor:

- extract a generic `streamAgentSse(port, token, path, init, onFrame, signal)`
- keep `streamAgentCommand(...)` as a thin wrapper for job streams
- add `parseLlmStreamMessage(frame)` or equivalent

Add methods:

- `getLlmModels(port, token, signal?)`
- `streamLlmChat(port, token, body, onMessage, signal?)`

`parseSseStream()` in `frontend/src/api/sse.ts` already supports arbitrary event
names, so no parser changes are required there.

### 5. `frontend/src/core/llm/` (new shared module)

Create:

- `frontend/src/core/llm/useLlm.ts`
- `frontend/src/core/llm/ChatPanel.tsx`

`useLlm.ts` responsibilities:

- load models from `agentClient.getLlmModels`
- hold conversation state
- start SSE chat stream
- append assistant text deltas
- surface tool activity, usage, and errors

`ChatPanel.tsx` responsibilities:

- model picker
- message list
- input area
- tool-activity UI
- seed-context badge
- privacy warning line

Props:

- `seedContext?: LlmSeedContext`
- `toolsNamespace?: ToolsNamespace`

This is the shared embeddable unit that Kuber imports directly.

---

## Layer FE — Assistant plugin (`frontend/src/plugins/assistant/`)

### 1. `frontend/src/plugins/assistant/manifest.tsx`

Create a new builtin optional plugin manifest.

Use the same manifest style as Notebook / Leonid / Kuber. Make it precise:

- `const ASSISTANT_PLUGIN_ORDER = 29 as const`
  The current optional ordering is Kuber 15, Jenkins 25, Leonid 26,
  Notificator 27, Notebook 28, Admin 30. Assistant 29 fits the existing gap.
- `const ASSISTANT_PLUGIN_ROUTE = "/assistant" as const`
- `id: PluginId.ASSISTANT`
- `icon: IconName.ASSISTANT`
- `kind: PluginKind.OPTIONAL`
- `label: "Assistant"`
- `origin: PluginOrigin.BUILTIN`
- `requiresAgent: true`

Single tab:

- `id: TabId.ASSISTANT_CHAT`
- `title: TabTitle[TabId.ASSISTANT_CHAT]`
- `viewKey: ViewKey.ASSISTANT_CHAT`
- `element: <AssistantSection />`

### 2. `frontend/src/plugins/assistant/AssistantSection.tsx`

Make this a **single-tab section component**, closer to
`StatisticsSmokeSection` than to `NotebookSection`.

Responsibilities:

- wrap the free chat in `CompanionGate`
- load `agentPort`
- render `<ChatPanel />` with no seed context

This should mirror `KuberSection.tsx` for the companion gate, not
`LeonidSection.tsx` which is backend-only and does not need the agent.

### 3. Frontend tests for the Assistant plugin

Add / update:

- manifest / discovery coverage if there are snapshot-like expectations
- chat hook / panel tests for stream parsing
- settings tests for model serialization and secret masking

No edit is needed in `frontend/src/plugins/discovery.ts` itself unless tests
hardcode counts or ids.

---

## Layer SET — Profile → Settings (`frontend/src/plugins/profile/SettingsPanel.tsx`)

This file is the exact settings surface to mirror. Follow the existing local
patterns used for Jenkins, Notebook, Kuber, and qaa-generator.

Add copy:

- `ASSISTANT_TITLE`
- `ASSISTANT_DESCRIPTION`
- `ASSISTANT_PRIVACY_NOTE`
- `ASSISTANT_ANTHROPIC_KEY_LABEL`
- `ASSISTANT_OPENAI_KEY_LABEL`
- `ASSISTANT_MODELS_LABEL`
- button labels for add / remove / save / clear

Extend `AgentFormState` with:

- `llmAnthropicKey`
- `llmAnthropicKeyDirty`
- `llmAnthropicKeySet`
- `llmOpenaiKey`
- `llmOpenaiKeyDirty`
- `llmOpenaiKeySet`
- structured model drafts, for example `llmModels: LlmModelDraft[]`

Do not store models only as textarea text in UI state. Use structured rows and
serialize to JSON only on save.

Add:

- `showAssistant = enabledPluginIds.has(PluginId.ASSISTANT)`
- include it in `hasEnabledAgentPlugins`
- one new mutation + notice state, same pattern as `notebookUpdateMutation`
  / `kuberUpdateMutation`

Assistant save contract:

- always send `llm_models: JSON.stringify(agentForm.llmModels)`
- send `llm_anthropic_key` only when dirty
- send `llm_openai_key` only when dirty
- untouched key input => field omitted => unchanged
- clear button => set empty string + dirty => explicit secret removal

UI shape:

- two `PasswordInput`s for provider keys
- explicit configured badges or placeholders derived from `*_set`
- clear buttons per secret, same contract as Jenkins / qaa-generator
- row editor for models:
  - `label`
  - `provider`
  - `model_id`
  - params editor

For params in v1 keep it intentionally small:

- `reasoning_effort` select
- `max_tokens` numeric field

Serialize only populated params keys.

Update tests in `frontend/src/plugins/profile/SettingsPanel.test.tsx`:

- fixture response includes new fields
- save payload includes serialized `llm_models`
- dirty / clear semantics for both keys

---

## Layer KUBE — Kuber embed (`frontend/src/plugins/kuber/PodsPanel.tsx`)

This is the first in-app consumer.

Add plugin-visibility wiring inside the component:

- import `usePluginsContext`
- read `currentUser` from `useAuthStore`
- derive `enabledOptionalPluginIdSet(currentUser?.enabled_plugins)`
- compute `showAssistantAction`

Do not assume `enabledPluginIds` already exists in `PodsPanel`; it currently does
not.

Add UI:

- an **Ask AI** action in the selected pod drawer
- open a dedicated chat surface hosting:
  `<ChatPanel seedContext={{ context: activeContext, namespace: activeNamespace, pod: selectedPod.name }} toolsNamespace={ToolsNamespace.KUBE} />`

Keep seed lightweight:

- `context`
- `namespace`
- `pod`

Do not prefetch and inject `describe` into the seed.

Important Agent / Kube integration detail:

- the Assistant tool executor should call `agent/app/services/kube.py`
  helpers directly
- the Pods UI continues to use the existing public kube routes

Update `frontend/src/plugins/kuber/PodsPanel.test.tsx`:

- add one test proving the Ask AI action is visible only when Assistant is
  enabled
- add one test that opening the action passes the expected seed context

---

## Layer BE — Backend permissions and plugin enablement

### 1. `backend/app/core/constants.py`

Add:

- `PluginId.ASSISTANT = "assistant"`
- include it in `OPTIONAL_PLUGIN_IDS`
- `PermissionKey.ASSISTANT_USE = "assistant.use"`

This automatically affects:

- `OPTIONAL_PLUGIN_ID_VALUES`
- `resolve_enabled_plugins(...)`

**Default-enabled (intentional).** `resolve_enabled_plugins(None)` returns the
full `OPTIONAL_PLUGIN_ID_VALUES`, so adding `ASSISTANT` to `OPTIONAL_PLUGIN_IDS`
makes it **on by default** for every user — the same convention as all existing
optional plugins. That is intended: with no keys/models configured the plugin is
harmless (empty model picker, gated by `CompanionGate`). This is why the
test-local `DEFAULT_OPTIONAL_PLUGIN_IDS` lists in `test_auth.py` / `test_users.py`
must gain `"assistant"` (§4). If we ever want it opt-in instead, that is a
separate decision, not part of this brief.

No route addition is needed.

### 2. `backend/app/services/authorization.py`

`PERMISSION_SEEDS` auto-covers the new permission because it iterates the enum.

Update `ROLE_SEEDS`:

- `SUPERADMIN`: no manual change needed; it already uses `tuple(PermissionKey)`
- add `PermissionKey.ASSISTANT_USE` to `ADMINISTRATOR`
- add `PermissionKey.ASSISTANT_USE` to `ENGINEER`

### 3. `backend/app/api/v1/users.py`

No direct code edit required if only plugin validation logic is concerned.
`normalize_enabled_plugins()` already validates against
`OPTIONAL_PLUGIN_ID_VALUES`, so the constants change is enough.

### 4. Backend tests

Update:

- `backend/tests/test_auth.py`
- `backend/tests/test_users.py`

Both files hardcode `DEFAULT_OPTIONAL_PLUGIN_IDS`; add `"assistant"` there.

Also add / extend one authorization test proving the engineer seed has
`assistant.use`.

---

## Explicit no-touch list

Avoid unnecessary edits here:

- `frontend/src/plugins/discovery.ts`
- `frontend/src/plugins/catalog.ts`
- `frontend/src/plugins/context.ts`
- backend route modules unrelated to authz / users
- public kube agent routes beyond adding the new Assistant routes
- Stagings / Notebook / Leonid implementations, except using them as patterns

---

## Decisions (resolved — see `discuss/20`)

- Transport = local companion agent, not backend.
- Provider transport = SDK, not CLI.
- Embed = shared frontend module, not formal HostApi service.
- Kube tool-use = read-only only.
- Seed = identifiers only.
- Backend never sees API keys.

---

## Verification

- agent:
  `ruff check`, `mypy app`, `pytest`
  with coverage in `test_settings.py`, `test_kube.py`, `test_llm.py`
- frontend:
  `eslint .`, `tsc --noEmit`, `vitest run`
  with coverage in `SettingsPanel.test.tsx`, Assistant chat tests,
  `PodsPanel.test.tsx`
- backend:
  `ruff check`, `mypy app`, `pytest`
  with updated `test_auth.py` and `test_users.py`
