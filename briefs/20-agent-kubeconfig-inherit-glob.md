# Brief 20 — agent kubeconfig: empty = inherit ambient (A), directory = glob its kubeconfigs (B)

## Problem

The Kuber → Clusters tab shows only ONE cluster. Root cause: the local agent's
`GET /kube/contexts` runs `kubectl config view -o json` but **pins**
`KUBECONFIG` to a single file. `agent/app/services/kube.py::build_kube_env`
already HAS a correct "inherit + merge ambient `KUBECONFIG`" branch, but it is
**dead code** because `agent/app/core/config.py::normalize_kubeconfig` coerces an
empty `AGENT_KUBECONFIG` to `DEFAULT_KUBECONFIG` (`~/.kube/config`) — so
`settings.kubeconfig` is never empty and the explicit branch always wins. On the
dev machine `~/.kube/config` is a symlink to a single-context staging file, while
the real multi-context file lives elsewhere and is only referenced via the
ambient `KUBECONFIG` env — which the agent discards.

Also: users expect to point "Kubeconfig path" at `~/.kube` and get all clusters,
but `KUBECONFIG` is a list of FILES, not a directory — `kubectl` errors
("is a directory") on a directory value.

Implement two changes:

## A — empty/unset `AGENT_KUBECONFIG` means "inherit ambient" (don't force a file)

- `agent/app/core/config.py`:
  - `normalize_kubeconfig` (the `kubeconfig` `field_validator`): when the value is
    `None` or a blank/whitespace string, return **`""`** (empty) — do NOT coerce
    to `DEFAULT_KUBECONFIG`.
  - Change the `kubeconfig` field **default** from `DEFAULT_KUBECONFIG` to `""`
    so an unset env var also means "inherit".
- Result: with an empty value, `build_kube_env` takes its existing inherited/merge
  branch (agent/app/services/kube.py lines ~138-163): it merges
  `kubeconfig_active_path` with the ambient `KUBECONFIG` env, deduped by realpath.
  No change needed to that branch's merge logic for A.
- `agent/.env.example`: change `AGENT_KUBECONFIG=~/.kube/config` to
  `AGENT_KUBECONFIG=` (empty) and update the nearby comment to state: empty =
  inherit ambient kubeconfig resolution (the `KUBECONFIG` env and/or
  `~/.kube/config`), merged with the active-path symlink.
- `agent/tests/test_config.py`: the two tests asserting unset/empty →
  `settings.kubeconfig == DEFAULT_KUBECONFIG` (around lines 37-51) must be updated
  to assert `settings.kubeconfig == ""`. Keep any import of `DEFAULT_KUBECONFIG`
  only if still used; otherwise drop it.

`DEFAULT_KUBECONFIG` (constants.py) is separate from
`DEFAULT_KUBECONFIG_ACTIVE_PATH`; the active-path default (`~/.kube/config`) is
unchanged and still used by the merge branch. Do not change `kubeconfig_active_path`.

## B — a directory value expands to the kubeconfig files inside it

In `agent/app/services/kube.py::build_kube_env`, when expanding `KUBECONFIG`
parts, if an (expanduser'd) part is a **directory**, replace it with the sorted
list of kubeconfig files directly inside it: glob `*.yaml` and `*.yml`
(sorted, non-recursive). A part that is a regular file is kept as-is.

- Apply this expansion consistently to BOTH the explicit branch (the
  `settings.kubeconfig` parts) and the inherited/active parts in the merge branch.
  Factor a small helper, e.g. `_expand_kubeconfig_part(raw: str) -> list[str]`
  that: strips, expanduser's, and returns `[str(p)]` for a file or the sorted
  glob for a directory (empty list if the dir has no matching files).
- Preserve the existing realpath-based dedup so the same file listed twice
  (e.g. a directory that also contains the active-path target) is not duplicated.
- Guard against producing an empty `KUBECONFIG`: if expansion yields no files at
  all (e.g. an empty directory and no ambient), do NOT set `KUBECONFIG` to an
  empty string (that breaks kubectl) — return an empty dict so kubectl falls back
  to its own default resolution. (Mirror the intent of the current empty-branch.)
- Directory globbing intentionally matches only `*.yaml`/`*.yml`, so dotted
  backups like `kubecfg.yaml.230219` and non-kubeconfig files are excluded.

### Tests (`agent/tests/test_kube.py`)
- Directory expansion: set `AGENT_KUBECONFIG` to a temp dir containing two valid
  kubeconfig files (`a.yaml`, `b.yaml`); assert `build_kube_env` returns
  `KUBECONFIG` = both files joined by `os.pathsep`, sorted, and that a
  non-`.yaml` file in the dir is excluded.
- Regression: a plain file value still yields exactly that file (existing test).
- Empty/inherit: with an empty `AGENT_KUBECONFIG` and an ambient `KUBECONFIG`
  set, the merge branch still runs and includes the ambient file (existing
  merge test should keep passing; adjust only if the empty-default change
  requires it).

## Frontend (optional, nice-to-have)

In `frontend/src/plugins/profile/SettingsPanel.tsx`, add/adjust the helper
description under the **"Kubeconfig path"** field to read something like: "Leave
empty to inherit your ambient kubeconfig (the `KUBECONFIG` env or
`~/.kube/config`). A file path, a `:`-separated list, or a directory (whose
`*.yaml` files are all loaded) are also accepted." Enumerate literals per house
style; update the SettingsPanel test only if it asserts on this copy.

## Acceptance criteria

- Empty/unset `AGENT_KUBECONFIG` → agent inherits + merges the ambient
  `KUBECONFIG` (multiple clusters show when the ambient config has several).
- `AGENT_KUBECONFIG` pointing at a directory → all its `*.yaml`/`*.yml`
  kubeconfigs are merged; kubectl no longer errors on a directory.
- A single file value is unchanged.
- `agent`: ruff, mypy, and pytest all green (update the two config tests + add the
  directory-expansion test). Frontend green if the optional copy change is made.

## Verify (this machine)

With the agent restarted and an empty `AGENT_KUBECONFIG` (ambient
`KUBECONFIG=~/.kube/kubecfg.yaml` present), `GET /kube/contexts` should return
the four prod contexts (plus the staging active-path context). Alternatively,
setting "Kubeconfig path" to `~/.kube/kubecfg.yaml` (a file) yields the four.
