# Brief 17a — Jenkins plugin corrections (review follow-up to brief 17)

Two review findings on the already-implemented `frontend/src/plugins/jenkins/`
plugin (brief 17). The agent/backend and all gates are already green — this is a
**frontend-only** fix. Do NOT touch the agent, backend, schemas, constants, or
the plugin's behavior beyond the two items below. Keep the existing enumerated-
constant / no-inline-literal style; keep everything `eslint` + `tsc` clean.

## Fix 1 (required) — pin/unpin does not update the Tree tab live

**Bug:** `TreePanel.tsx` reads the pin state via
`const isPinned = useJenkinsStore((state) => state.isPinned)` — this selects the
store **function**, whose identity is stable, so the component never subscribes
to `pinnedPaths`. Pinning/unpinning a folder in the Tree tab therefore does NOT
re-render the row, and the pin icon (`IconPin` ↔ `IconPinnedOff`) only flips on
the next unrelated render (the 30s tree refetch or an expand toggle). The nested
child rows compound this by reading `pinnedPaths` imperatively via
`useJenkinsStore.getState().isPinned(child.path)`, which is likewise non-reactive.
(`BoardPanel.tsx` is correct — it already subscribes to `state.pinnedPaths`.)

**Fix:** make the Tree tab subscribe to the `pinnedPaths` **array** so any
pin/unpin re-renders the affected rows immediately, with no reload and no reliance
on the refetch.
- In `TreePanel`, subscribe to the array: `const pinnedPaths = useJenkinsStore(
  (state) => state.pinnedPaths)` (keep `pin`/`unpin` selectors as-is).
- Derive per-node pinned state from that array. Simplest: pass `pinnedPaths` down
  to `TreeNodeRow` and compute `const pinned = pinnedPaths.includes(node.path)`
  there — for BOTH the root rows and the recursive child rows. Remove the
  imperative `useJenkinsStore.getState().isPinned(...)` call at the child-row site
  (line ~278) and the now-unused `isPinned` selector.
- Behavior must be otherwise identical (pin toggles, tooltip/aria labels, the
  `event.stopPropagation()` on the pin button so it doesn't also toggle expand).

You may keep `jenkinsStore.isPinned` in the store (BoardPanel/tests may use it) —
just don't rely on selecting it for reactivity in `TreePanel`.

## Fix 2 (optional but preferred) — double-click also fires the single-click toggle

**Nit:** the folder/pipeline `Paper` and the `BuildRow`/board `Card` bind both
`onClick` (expand/collapse) and `onDoubleClick` (`window.open`). A double-click
also delivers two `click` events, so opening a pipeline in Jenkins also toggles
its expansion twice (net no-op, but it flashes and can fire a stray builds query).

**Fix (only if clean):** debounce the single-click so a double-click suppresses
it. Add one small shared helper (e.g. `useSingleClick(onSingle, onDouble)` in a
new `frontend/src/plugins/jenkins/useClickIntent.ts`, or an inline
`SINGLE_CLICK_DELAY_MS = 200` timer) that:
- on `click`, starts a ~200ms timer that runs the single-click action;
- on `dblclick`, cancels the pending timer and runs the double-click action.
Apply it to the Tree node `Paper`, the `BuildRow` `Paper`, and the board `Card`.
Model the delay as an enumerated `as const` value (no inline number literal).
Keep `event.stopPropagation()` on the pin/unpin `ActionIcon`s. If this cannot be
done cleanly without regressing tests, skip Fix 2 and leave a one-line comment
noting the click/dblclick coupling — Fix 1 is the only hard requirement.

## Tests
- Update/extend `TreePanel.test.tsx`: after clicking a folder's pin button, the
  row's control reflects the pinned state **without** any refetch/rerender
  trigger (assert the icon/aria-label switches to "Unpin folder" synchronously).
- If Fix 2 is applied: add a test that a double-click on a pipeline row calls the
  mocked `window.open` and does NOT leave the row toggled open (single-click
  suppressed). Keep the existing pin/store and `window.open` assertions.
- Do not weaken existing assertions.

## Gate (must pass)
`cd frontend && npm run lint && npx tsc --noEmit && npm run test && npm run build`

Agent and backend are untouched, but if you changed anything shared by accident,
re-run their gates too. When done, stop — the reviewer inspects `git diff` and
commits. Do not commit.
