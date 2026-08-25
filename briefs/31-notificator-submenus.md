# Brief 31 — Notificator: split the flat 13-tab list into two grouped pages

**Goal (frontend-only).** Today the Notificator plugin dumps all 13 sections into
one flat tab list in the sidebar (see brief 30 / discuss/18). Reorganize them into
**two groups**, each rendered as a page with its own inner tab strip:

1. **Contract manager** — tabs (in this order):
   Failure Mention Rules · Notifications · Products · QAA Members ·
   Slack Channels · Sub-products · Teams · Users  (8 tabs)
2. **Notifications** — tabs (in this order):
   Events · Fail reasons · History · Recurrent fail notifications  (4 tabs)

This grouping is **grounded in aut-notificator's two Django apps** — verified, not
invented:
- `contact_manager/models.py` → SlackChannel, ProductTeam (Teams), Product,
  SubProduct, QAAMember, FailureMentionRule, NotificationsConfigurationType
  (Notifications), UserModel → **Contract manager**.
- `notifications/models.py` → Event, RecurrentFailsNotification, FailReason,
  HistoryElement, MuteStatus → **Notifications**.
- `notifications/admin.py` registers exactly Event / RecurrentFailsNotification /
  FailReason / HistoryElement as nav items (not MuteStatus) — matching the user's
  4-tab list.

## Scope (read carefully — this is NOT a rewrite)

- **Frontend only.** No changes to `agent/`, `backend/`, or `aut-notificator`.
- **No behavior change per section.** Every panel keeps its current read/write
  capability exactly as brief 30 shipped. The 4 writable sections
  (notification_configs, products, sub_products, slack_channels) stay writable;
  the other 9 stay read-only. The "Add" labels the user pasted next to Events /
  Fail reasons / History were **accidentally copied from the aut-notificator
  admin page** — they do **NOT** mean add create/edit here. Do not add write.
- **All 12 existing panel components are reused verbatim.** `ProductsPanel`,
  `SlackChannelsPanel`, `SubProductsPanel` (`CrudPanels.tsx`); `NotificationsPanel`
  (`NotificationsPanel.tsx`); `EventsPanel`, `FailReasonsPanel`,
  `FailureMentionRulesPanel`, `HistoryPanel`, `QaaMembersPanel`,
  `RecurrentFailsPanel`, `TeamsPanel`, `UsersPanel` (`ReadOnlyPanels.tsx`). Each
  takes an `agentPort: number` prop — unchanged.
- **Mute statuses:** the current 13th tab (`MuteStatusesPanel`) is in **neither**
  group and is **not** a nav item in aut-notificator's admin. **Remove it from the
  navigation.** Leave the `MuteStatusesPanel` export in `ReadOnlyPanels.tsx` in
  place (it is only an export, harmless; a later brief may surface it inline under
  Recurrent fails). If lint flags any now-unused import, remove only that import.

## The framework constraint (why inner tabs, not more sidebar items)

The plugin host is a strict **two-level** nav: sidebar plugin → flat `tabs[]`
(`frontend/src/core/plugins/types.ts`, `Sidebar.tsx`, `TabBar.tsx`). There is no
third level. So the "page with tabs" is built as: the plugin exposes **two**
top-level tabs (Contract manager, Notifications); each tab's `element` is a page
that renders its **own inner Mantine `Tabs`** strip for its sections. The inner
tabs are internal component state — they are **not** registered as plugin
`TabId`/`ViewKey` and must not appear in the sidebar or the workspace TabBar.

## Implementation

### 1. `frontend/src/plugins/notificator/NotificatorSection.tsx` (rewrite internals; keep the module + `NotificatorSection` export name)

Keep the file and the exported symbol `NotificatorSection` — `discovery.test.ts`
mocks this module path, so do not rename/move it.

Change the `mode` prop to the two group keys (see constants below):
`ViewKey.NOTIFICATOR_CONTRACT_MANAGER | ViewKey.NOTIFICATOR_NOTIFICATIONS`.

Structure:
- Keep the single `<CompanionGate>` wrapper (one gate per page — cleaner than the
  current one-gate-per-section; the gate yields `{ agentPort }`).
- Inside the gate, render a Mantine `<Tabs>` inner strip. Define the section list
  per group as a local array of `{ value, label, render(port) }` (local `const`,
  **not** global `TabId`/`ViewKey`). Default the active inner tab to the first
  entry via local `useState`. Render only the active panel (mount-on-select is
  fine; keep it simple).
- Contract manager sections, in order:
  1. Failure Mention Rules → `<FailureMentionRulesPanel agentPort={port} />`
  2. Notifications → `<NotificationsPanel agentPort={port} />`
  3. Products → `<ProductsPanel agentPort={port} />`
  4. QAA Members → `<QaaMembersPanel agentPort={port} />`
  5. Slack Channels → `<SlackChannelsPanel agentPort={port} />`
  6. Sub-products → `<SubProductsPanel agentPort={port} />`
  7. Teams → `<TeamsPanel agentPort={port} />`
  8. Users → `<UsersPanel agentPort={port} />`
- Notifications sections, in order:
  1. Events → `<EventsPanel agentPort={port} />`
  2. Fail reasons → `<FailReasonsPanel agentPort={port} />`
  3. History → `<HistoryPanel agentPort={port} />`
  4. Recurrent fail notifications → `<RecurrentFailsPanel agentPort={port} />`
- Drop the `MuteStatusesPanel` wiring (see Mute statuses note above).

Inner-tab labels (exact strings): "Failure Mention Rules", "Notifications",
"Products", "QAA Members", "Slack Channels", "Sub-products", "Teams", "Users",
"Events", "Fail reasons", "History", "Recurrent fail notifications".

Keep `NOTIFICATOR_SECTION_COPY` (companion loading/error text) as-is.

### 2. `frontend/src/plugins/notificator/manifest.tsx`

Replace the 13-entry `tabs` array with **two** entries:
```
{ id: TabId.NOTIFICATOR_CONTRACT_MANAGER, title: TabTitle[...],
  viewKey: ViewKey.NOTIFICATOR_CONTRACT_MANAGER,
  element: <NotificatorSection mode={ViewKey.NOTIFICATOR_CONTRACT_MANAGER} /> },
{ id: TabId.NOTIFICATOR_NOTIFICATIONS, title: TabTitle[...],
  viewKey: ViewKey.NOTIFICATOR_NOTIFICATIONS,
  element: <NotificatorSection mode={ViewKey.NOTIFICATOR_NOTIFICATIONS} /> },
```
Order: Contract manager first, then Notifications. Plugin `order`/`route`/`icon`
unchanged.

### 3. `frontend/src/constants.ts`

Collapse the Notificator `TabId`, `ViewKey`, and `TabTitle` entries from 13 to 2.
**Do NOT touch** `AgentPath.NOTIFICATOR_*`, the `buildAgentNotificator*Path`
helpers, or `QueryKey.NOTIFICATOR_*` — the panels still call all of those.

- `TabId`: remove the 13 `NOTIFICATOR_*` keys; add
  `NOTIFICATOR_CONTRACT_MANAGER: "tab-notificator-contract-manager"` and keep/add
  `NOTIFICATOR_NOTIFICATIONS: "tab-notificator-notifications"`.
- `ViewKey`: same two — `NOTIFICATOR_CONTRACT_MANAGER: "notificator-contract-manager"`,
  `NOTIFICATOR_NOTIFICATIONS: "notificator-notifications"`; remove the other 11.
- `TabTitle`: `[TabId.NOTIFICATOR_CONTRACT_MANAGER]: "Contract manager"`,
  `[TabId.NOTIFICATOR_NOTIFICATIONS]: "Notifications"`; remove the other 11.

Only `manifest.tsx` and `NotificatorSection.tsx` reference these removed constants
(verified by grep) — no other call sites to fix.

### 4. Tests

- `NotificationsPanel.test.tsx`, `groupByTeam.test.ts` — unchanged (panels
  untouched).
- `discovery.test.ts` — the `NotificatorSection` module mock keeps resolving
  (name unchanged); the plugin at index 5 stays `NOTIFICATOR`, `requiresAgent:
  true`. Verify it still passes; adjust only if it enumerates the old per-section
  tabs (it currently does not).
- **Add** `frontend/src/plugins/notificator/NotificatorSection.test.tsx`: for each
  mode, render (mock `CompanionGate` to yield a port, mock the panels) and assert
  the correct inner tab labels appear in the correct order, and that switching the
  inner tab swaps the rendered panel. Mirror the existing `NotificationsPanel`
  test setup for mocking the agent/companion.

## Verification (memory `reference_verification_commands`)

- `frontend/`: `npm run lint && npx tsc --noEmit && npx vitest run`.
- Manual smoke (memory `reference_local_e2e_run`): open Notificator in the
  sidebar → it now expands to exactly **two** sub-items (Contract manager,
  Notifications); open each → inner tab strip shows the 8 / 4 sections in the
  listed order; each section still reads (and, for the 4 writable ones, still
  creates/edits). Confirm the sidebar no longer lists 13 flat items and there is
  no "Mute statuses" tab.

## Notes for the reviewer (me)

- Watch that inner tab state is local — no leakage into the workspace TabBar or
  sidebar; the two workspace tabs must be "Contract manager" and "Notifications"
  only.
- Confirm no orphaned references to removed `TabId/ViewKey` constants remain
  (`grep -rn "NOTIFICATOR_TEAMS\|NOTIFICATOR_PRODUCTS\|…" src`).
- Confirm the writable panels still submit (regression risk is zero if panels are
  untouched, but verify the `agentPort` prop is threaded through the new page).
