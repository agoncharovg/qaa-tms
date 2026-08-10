# Brief 09 — Constants tidiness (kill inline literals, honor CONVENTIONS.md)

This is a **pure refactor / no-behavior-change** task. You do NOT add features,
routes, endpoints, DB columns, or migrations. You replace inline string/number
literals with named `StrEnum` members / `as const` constants, per
`CONVENTIONS.md` ("Do not hardcode string constants inline … model them as
`StrEnum` / union string-literal enums; global constants live in a dedicated
module"). **Every value you introduce must be byte-identical to the literal it
replaces** — this refactor must not change any runtime string, number, wire
payload, CLI argv token, HTTP header, or user-facing message.

Read `CONVENTIONS.md` and the three constants modules FIRST (they are the
source of truth for existing members — reuse, do not duplicate):
- `backend/app/core/constants.py`
- `agent/app/core/constants.py`
- `frontend/src/constants.ts`

The backend, agent, and frontend are **separate deployables**; they legitimately
each carry their own copy of shared enums (e.g. `OperationType`). Add new enums
to the layer that uses them. Do NOT try to share code across the three.

## Hard scope rules
- **No behavior change.** Values must be identical. Where a literal is replaced
  by an enum member, the member's `.value` (Python) / string value (TS) must
  equal the old literal exactly, including case, punctuation, and whitespace.
- **In scope:** the items in Parts A/B/C below, only.
- **Explicitly OUT of scope (do NOT touch):** inline `rgba(...)`/Mantine
  `color`/`variant`/layout-size styling literals (that is a separate theming
  concern); `git`/`kubectl` sub-command argv tokens beyond what is named below;
  wire-payload dict keys in `agent/app/services/backend.py`, `jobs.py` recipe
  dicts, and `routes.py` inline dicts; the `"..." in provided_fields` schema
  field-name checks in `backend/app/api/v1/{operations,users}.py`; SQLAlchemy
  `__tablename__`/`ForeignKey`/`back_populates` names; `text("SELECT 1")`. Leave
  all of these as-is — they are noted but deliberately deferred.
- Keep `discuss/` and comments as-is (English UI text convention already holds).

## Gates (must all pass before you are done)
- Backend: `cd backend && ruff check . && ruff format --check . && mypy app && pytest`
- Agent: `cd agent && ruff check . && ruff format --check . && mypy app && pytest`
- Frontend: `cd frontend && npm run lint && npx tsc --noEmit && npm run test && npm run build`
- Prefer running the tool used by the repo's existing config; match current
  formatting exactly so `ruff format --check` stays clean.

---

## Part A — Agent (`agent/`)

Add to `agent/app/core/constants.py` and thread through:

**A1. `StagingCommand(StrEnum)`** — the `staging` CLI sub-commands. Values MUST
match today's argv exactly:
`DEPLOY="deploy"`, `DESTROY="destroy"`, `ADOPT="adopt"`, `SYNC="sync"`,
`E2E_RUN="e2e-run"` (note the hyphen — this differs from
`OperationType.E2E_RUN="e2e_run"`, do NOT conflate them).
Also add `DEFAULT_STAGING_BINARY_NAME = "staging"` module constant.
Use in:
- `agent/app/services/staging.py:78,99,105,111,135` (sub-commands passed to
  `_build_base_argv`), `:147` (`shutil.which("staging")`).
- `agent/app/services/e2e.py:51` (`"e2e-run"`).

**A2. `StagingFlag(StrEnum)`** — the CLI flags, values exact:
`SERVICES="--services"`, `IMAGE="--image"`, `CLEAN="--clean"`, `FULL="--full"`,
`DRY_RUN="--dry-run"`, `NO_SYNC="--no-sync"`, `STAGE="--stage"`,
`SERVICE="--service"`, `VERBOSE="--verbose"`, `PULL="--pull"`, `APPLY="--apply"`,
`PRODUCT="--product"`, `SUITE="--suite"`, `THREADS="--threads"`,
`LIST_SUITES="--list-suites"`.
Use in BOTH:
- argv construction: `agent/app/services/staging.py:80,82,84,86,88,90,92,113,115,117,119,136,140,142`
  and `agent/app/services/e2e.py:54,56`.
- recipe parsing (same flag strings, currently duplicated):
  `agent/app/services/namespaces.py:374,384,398,402,406,410,414`.
This is the highest-value item — it removes the only real duplicated contract in
the service. Verify the deploy/destroy/adopt/sync/e2e argv and the namespaces
recipe-parse tests still pass unchanged.

**A3. `JobEventType(StrEnum)`** — the job-stream payload discriminator (this is
the `type=` field on the event objects, values `"line"`/`"terminal"`). It is
DISTINCT from the existing `SseEvent` (`"log"`/`"terminal"`) — keep both; do not
merge. `LINE="line"`, `TERMINAL="terminal"`. Use in:
- `agent/app/services/namespaces.py:238,255`, `agent/app/services/jobs.py:335,345`.
- `agent/app/schemas.py:175,184` — the `Literal["line"]` / `Literal["terminal"]`
  discriminators. Keep them valid pydantic `Literal`s; you may reference the
  enum values (e.g. `Literal[JobEventType.LINE]`) as long as tsc-equivalent
  pydantic validation is unchanged and mypy stays clean. If referencing the enum
  in `Literal[...]` complicates typing, leave the `Literal` string as-is but add
  the enum for the runtime `type=` constructors — do not fight the type checker.

**A4. Extend `HeaderName` / `HeaderValue`** for the SSE response headers in
`agent/app/api/routes.py:368-372`:
- `HeaderName`: add `CACHE_CONTROL="Cache-Control"`, `CONNECTION="Connection"`.
- `HeaderValue`: add `EVENT_STREAM="text/event-stream"`,
  `EVENT_STREAM_UTF8="text/event-stream; charset=utf-8"`, `NO_CACHE="no-cache"`,
  `KEEP_ALIVE="keep-alive"`.
Replace the raw `media_type=` and header dict literals accordingly.

**A5. Magic numbers → module constants:**
- `agent/app/main.py:34` `timeout=10.0` → `DEFAULT_BACKEND_TIMEOUT_SECONDS = 10.0`.
- `agent/app/services/preflight.py:144` `443` → `HTTPS_PORT = 443`.
- Stage bounds `0`/`7`: add `MIN_STAGE = 0`, `MAX_STAGE = 7` and use in
  `agent/app/services/namespaces.py:421` (`stage < 0 or stage > 7`) AND
  `agent/app/schemas.py:46` (`ge=0, le=7`).

**A6. Deduplicated error messages** — add an `ErrorMessage(StrEnum)` (or similar)
and replace the duplicated literals (values exact):
- `"Job not found."` → `routes.py:191,317,362`.
- `"Unauthorized."` → `deps.py:63,67,71,82`.
- `"The staging binary is not installed."` → `staging.py:190`, `namespaces.py:166`,
  `e2e.py:46`.

**A7. Drift fixes (message references a constant's value by hand):**
- `agent/app/core/config.py:46` — the validator message `"AGENT_HOST must stay
  127.0.0.1."` should build the host portion from `DEFAULT_AGENT_HOST` (e.g. an
  f-string) so it can't drift.
- `agent/app/services/preflight.py:185` — `"older than 12 hours"` should derive
  the hours from `DEFAULT_KUBECONFIG_FRESHNESS_SECONDS` (e.g.
  `// 3600` → `12`) so the text tracks the constant. Keep the rendered string
  identical for the current value.

---

## Part B — Backend (`backend/`)

Add to `backend/app/core/constants.py` and thread through:

**B1. `HttpHeader(StrEnum)`** + **`AuthScheme(StrEnum)`:**
- `HttpHeader.WWW_AUTHENTICATE = "WWW-Authenticate"`.
- `AuthScheme.BEARER = "Bearer"`.
- In `backend/app/api/deps.py:37,48,56,64` replace the header-name literal with
  `HttpHeader.WWW_AUTHENTICATE` and replace `TokenType.BEARER.value.capitalize()`
  with `AuthScheme.BEARER` (byte-identical `"Bearer"`, but no fragile
  string-munging). `TokenType.BEARER` (`"bearer"`, the OAuth `token_type` body
  field) stays as-is where it is used for that purpose.

**B2. `DEFAULT_STRING_LENGTH = 255`** module constant — use in the 7
`mapped_column(String(255), ...)` sites: `backend/app/models/operation.py:40,50,51,52`
and `backend/app/models/user.py:25,26,27`.

**B3. `HealthStatus(StrEnum)`** (`OK="ok"`, `READY="ready"`) plus a field-name
constant for the `"status"` response key — use in `backend/app/main.py:48,60`
(`{"status": "ok"}`, `{"status": "ready"}`). Do NOT reuse `OperationStatus` —
this is a different domain.

**B4. Pagination constants** — `backend/app/api/v1/operations.py:128-129`
(`Query(ge=1, le=100)=20`, `Query(ge=0)=0`). Add named constants
(`OPERATIONS_MIN_LIMIT=1`, `OPERATIONS_MAX_LIMIT=100`,
`OPERATIONS_DEFAULT_LIMIT=20`, `DEFAULT_OFFSET=0`) and use them in the `Annotated`
`Query(...)` defaults.

**B5. `ErrorMessage(StrEnum)`** for the duplicated backend messages (values
exact): `"Operation not found."` (`operations.py:50,55,72`), `"User not found."`
(`deps.py:63`, `users.py:26`), `"Invalid authentication credentials."`
(`deps.py:47,55`). Single-use messages may stay inline.

---

## Part C — Frontend (`frontend/`)

Add to `frontend/src/constants.ts` and thread through:

**C1. `HttpMethod`** `as const` (`GET`, `POST`, `PATCH`, `DELETE`) — replace the
`method: "GET"|"POST"|"PATCH"|"DELETE"` literals in
`frontend/src/api/agentClient.ts` and `frontend/src/api/backendClient.ts`
(all `method:` sites the audit listed).

**C2. `HttpHeader`** (`ACCEPT`, `AUTHORIZATION`, `CONTENT_TYPE`),
**`MediaType.JSON = "application/json"`**, **`AUTH_SCHEME_BEARER = "Bearer"`** —
replace the header-name / media-type / bearer-prefix literals in
`agentClient.ts:78,82,83,128` and `backendClient.ts:63,65-67,70`. Keep the
existing `AGENT_REQUEST_HEADER`/`AGENT_REQUEST_HEADER_VALUE` usage as-is.

**C3. Fix the `"log"` enum drift (this is the most important frontend fix):**
`JobStreamEvent.LOG` already exists and is what `parseJobStreamMessage` sets on
`message.event`, but three consumers compare against the raw string `"log"`.
Replace with `JobStreamEvent.LOG` (import it where missing):
- `frontend/src/features/stagings/DeployPanel.tsx:210` (add the import),
- `frontend/src/features/stagings/useTransientLiveJob.ts:82`,
- `frontend/src/features/stagings/NamespacesPanel.tsx:491`.

**C4. Deploy-stage bounds** — `DeployPanel.tsx:717,718,728` inline `max={7}`,
`min={0}`, `placeholder="0-7"`. Use the existing `MAX_DEPLOY_STAGE` /
`MIN_DEPLOY_STAGE`; build the placeholder as
`` `${MIN_DEPLOY_STAGE}-${MAX_DEPLOY_STAGE}` `` (renders identical `"0-7"`).

**C5. `DEFAULT_JOB_POLL_INTERVAL_MS = 2000`** — replace the `2000` refetch
interval in `DeployPanel.tsx:170` and `useTransientLiveJob.ts:42`.

**C6. `DEFAULT_IMAGE_TAG = "latest"`** — replace the `"latest"` literals in
`deployDraft.ts:133,147` and `DeployPanel.tsx:67,69` (leave the two visible
placeholder props `:514,636` as literal text OR use the constant — your call, but
the rendered text must stay `"latest"`).

**C7. `HttpStatus.NO_CONTENT = 204`** — `backendClient.ts:91`
(`response.status === 204`).

**C8. Shared status→color map** — three near-identical functions return the same
Mantine color per `OperationStatus`. Add ONE `OperationStatusColor` map (keyed by
`OperationStatus`, values the current Mantine color strings) in `constants.ts`
and have all three call sites use it:
`HistoryPanel.tsx:36-49`, `LiveJobPanel.tsx:18-31`, `NamespacesPanel.tsx:118-131`.
Preserve every color mapping exactly (including any default/fallback color). If
the three functions differ in their handling of any status, KEEP a thin local
wrapper rather than changing which color a status renders — no visual change.

---

## Deliverable
- All three gate suites green (ruff+format+mypy+pytest for backend and agent;
  lint+tsc+vitest+build for frontend).
- `git diff` shows only literal→constant substitutions and the new enum/constant
  definitions — no logic, control-flow, endpoint, schema-shape, or wire-value
  changes. Confirm no test snapshot/expectation needed editing except where a
  test itself asserted a now-centralized literal (in which case point the test at
  the same constant — do not change the asserted value).
