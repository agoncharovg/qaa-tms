# Brief 17b — Jenkins plugin: configurable root folders (limit to PREPROD/PROD)

Review follow-up to briefs 17 / 17a. Live run showed the Tree returns **all**
children of `job/.QAA/job/E2E` — `CUSTOM`, `PREPROD`, `PROD`,
`Product_team_tests_runner`, `STAGING` — but the product scope is **only
`PREPROD` and `PROD`**. Make the set of root folders a **configurable, editable
list** (agent config), defaulting to `PREPROD,PROD`, so more can be added later
without code changes. A UI editor for this list is explicitly **future / out of
scope** here — config-driven is enough for now.

This is a **frontend-agnostic, agent-side** change (plus tests/docs). Do NOT
touch the STUCK heuristic, the backend, or the plugin contract. Keep the existing
enumerated-constant / no-inline-literal style; keep `ruff`/`mypy`/`eslint`/`tsc`
clean.

## Behavior target
- Agent fetches the `job/.QAA/job/E2E` subtree in one call as today, then **keeps
  only the root child folders whose `name` is in the configured allow-list**,
  emitted in the configured list order (so `PREPROD` then `PROD`).
- The builds scope guard must also **tighten** to the allowed roots: a build
  request for a job under a non-allowed folder (e.g. `.../job/E2E/job/CUSTOM/...`)
  must be rejected `400`, even though it is technically under `E2E`.

## Part A — Agent constants (`agent/app/core/constants.py`)
- `EnvKey`: add `JENKINS_ROOT_FOLDERS = "AGENT_JENKINS_ROOT_FOLDERS"`.
- Default: `DEFAULT_JENKINS_ROOT_FOLDERS = ("PREPROD", "PROD")` (tuple of str).
- Reuse `ErrorMessage.JENKINS_PATH_OUT_OF_SCOPE` for the tightened guard.
- Add a small constant for the Jenkins path segment used between folder levels if
  one is not already present: `JENKINS_JOB_PATH_SEGMENT = "job"` (used to build
  `{root_path}/job/{folder}` allowed prefixes).

## Part B — Agent config (`agent/app/core/config.py`)
Add `jenkins_root_folders: Annotated[list[str], NoDecode]` with
`Field(default_factory=lambda: list(DEFAULT_JENKINS_ROOT_FOLDERS),
alias=EnvKey.JENKINS_ROOT_FOLDERS.value)` and a `mode="before"` validator that
mirrors `parse_cors_origins`:
- `None`/empty ⇒ default list;
- list ⇒ stripped non-empty items;
- string ⇒ JSON array if it starts with `[`, else CSV split on `,`; strip, drop
  empties.
Do not lowercase — Jenkins folder names are case-sensitive (`PREPROD`, `PROD`).
Add `AGENT_JENKINS_ROOT_FOLDERS=PREPROD,PROD` to `agent/.env.example` with a
comment that it is an editable allow-list of folders under `.QAA/E2E`.

## Part C — Agent service (`agent/app/services/jenkins.py`)
- Add `allowed_root_paths(settings) -> list[str]`:
  `[f"{settings.jenkins_root_path.strip('/')}/{JENKINS_JOB_PATH_SEGMENT}/{folder}"
  for folder in settings.jenkins_root_folders]`.
- `fetch_tree`: after reading the raw child jobs from the E2E payload, **filter
  to allowed folder names and order by the configured list**, then map. E.g. build
  a `{name: raw}` index over `_read_object_list(payload, CHILDREN_KEY)` and emit
  `[_map_node(settings, index[name]) for name in settings.jenkins_root_folders if
  name in index]`. Folders configured but absent in Jenkins are silently skipped
  (no error). Keep the recursive depth/field expression unchanged.
- `validate_job_path`: replace the single `startswith(root_path)` scope check with
  a check against `allowed_root_paths(settings)`: the normalized path must equal
  one of them or start with `"<allowed>/"`. Keep all existing rejects (`..`,
  scheme, netloc, query, fragment, empty). Raise `JenkinsPathOutOfScopeError` with
  the same message otherwise. (Net effect: builds for `PREPROD`/`PROD` jobs pass;
  builds for `CUSTOM`/`STAGING`/etc. now 400.)

## Part D — Frontend copy (optional, tiny)
The Tree/Board render whatever roots the agent returns, so no functional change is
needed. Optionally soften the `TreePanel` subtitle so it does not hardcode
"PREPROD and PROD" if the list becomes configurable (e.g. "Browse the live Jenkins
tree for the configured .QAA/E2E roots…"). Keep it an `as const` string. Skip if
it risks touching tests unnecessarily.

## Part E — Tests (`agent/tests/test_jenkins.py`)
- `fetch_tree` filtering: feed an E2E payload whose `jobs[]` includes `CUSTOM`,
  `PREPROD`, `PROD`, `STAGING`; assert the result roots are exactly `["PREPROD",
  "PROD"]` in that order (default config).
- Custom allow-list: with `AGENT_JENKINS_ROOT_FOLDERS` set to only `PROD` (or
  `PROD,PREPROD` to check ordering), assert the roots reflect it.
- `validate_job_path`: a path under `.../job/E2E/job/CUSTOM/...` now raises →
  route returns `400`; a path under `.../job/E2E/job/PREPROD/...` still passes.
- Keep all existing brief-17 tests green (status derivation, builds parse, 503/502,
  auth, existing scope rejects for `..`/absolute URLs).

## Part F — Docs
- `agent/README.md` / `agent/.env.example`: document `AGENT_JENKINS_ROOT_FOLDERS`
  (editable allow-list of `.QAA/E2E` child folders; default `PREPROD,PROD`; more
  can be added later; a UI editor is future work).
- `frontend/README.md`: adjust the Jenkins plugin note from "PREPROD+PROD" to
  "the configured `.QAA/E2E` roots (default PREPROD, PROD)".

## Gates (must pass)
- Agent: `cd agent && ruff check . && ruff format --check . && mypy app && pytest`
- Frontend: `cd frontend && npm run lint && npx tsc --noEmit && npm run test && npm run build`
- (Backend untouched; only re-run if you changed something shared by accident.)

When done, stop — the reviewer inspects `git diff` and commits. Do not commit.
