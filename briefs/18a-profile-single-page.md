# Brief 18a — Profile: one page with a nested section menu (frontend-only correction)

Correction to brief 18. Today the Profile plugin exposes **three workspace tabs**
(`Account`, `Plugins`, `Settings`) that land in the TabBar. The user wants
instead **one "Profile" page** that opens as a single workspace tab (behaving
like every other menu), and **inside it a nested vertical menu** switching
between the setting types (`Account`, `Plugins`, `Settings`).

This is a **frontend-only** change. Do NOT touch backend or agent code, the
settings endpoints, the API clients/types, `runtimeConfig`, or the three panel
components' internals (`AccountPanel`, `PluginsPanel`, `SettingsPanel`) — they
are reused verbatim; only their container changes.

Read `CONVENTIONS.md` + brief 09 (no inline string/number literals; enums in the
constants module; English-only UI; `eslint` + `tsc --noEmit` + tests clean).

Read FIRST:
- `frontend/src/plugins/profile/manifest.tsx` — becomes a single-tab plugin.
- `frontend/src/plugins/profile/AccountPanel.tsx`, `PluginsPanel.tsx`,
  `SettingsPanel.tsx` — the section bodies (unchanged; imported by the new page).
- `frontend/src/constants.ts` — `ViewKey` / `TabId` / `TabTitle` profile entries.
- `frontend/src/app/layout/Sidebar.tsx` — the account menu's `openProfile`
  (keeps working unchanged; it activates the Profile plugin's single tab).
- Tests referencing the removed ids:
  `frontend/src/store/uiStore.test.ts`, `frontend/src/app/layout/TabBar.test.tsx`,
  `frontend/src/plugins/discovery.test.ts`.

---

## 1. Constants (`frontend/src/constants.ts`)

- `ViewKey`: **remove** `PROFILE_ACCOUNT`, `PROFILE_PLUGINS`, `PROFILE_SETTINGS`;
  **add** `PROFILE = "profile"`.
- `TabId`: **remove** the three `PROFILE_*`; **add** `PROFILE = "tab-profile"`.
- `TabTitle`: **remove** the three `PROFILE_*` entries; **add**
  `[TabId.PROFILE]: "Profile"`.
- **Add** an enum for the in-page nested menu:
  - `ProfileSection` const object + union type: `ACCOUNT = "account"`,
    `PLUGINS = "plugins"`, `SETTINGS = "settings"`.
  - `ProfileSectionLabel: Record<ProfileSection, string>` →
    `Account` / `Plugins` / `Settings`.
  - `PROFILE_SECTION_ORDER = [ProfileSection.ACCOUNT, ProfileSection.PLUGINS, ProfileSection.SETTINGS] as const`.

## 2. Profile page (`frontend/src/plugins/profile/ProfilePage.tsx`, new)

- Renders a single page with a **left nested menu** and a **right content pane**:
  - Left column (fixed width, ~200–220px): a vertical list of nav items built
    from `PROFILE_SECTION_ORDER` using `ProfileSectionLabel`, styled with
    `usePalette()` to match the sidebar's sub-tab look (reuse the same active/
    hover treatment — an active item uses `palette.accentSoft`/`palette.accent`).
    Use Mantine `NavLink` or `UnstyledButton`s; do not introduce a new nav idiom.
  - Right column: the panel for the active section — `<AccountPanel/>`,
    `<PluginsPanel/>`, or `<SettingsPanel/>`.
- Active section is **local component state** (`useState<ProfileSection>`,
  default `ProfileSection.ACCOUNT`) — it is NOT a workspace tab and NOT persisted
  in the ui store. Keep it simple; no routing/hash needed.
- Responsive: on narrow widths the two columns may stack, but a plain
  `Group`/`Grid` split is acceptable. Give each nav item an `aria-current` when
  active and an accessible label.

## 3. Manifest (`frontend/src/plugins/profile/manifest.tsx`)

- Collapse `tabs` to a **single** tab:
  `{ id: TabId.PROFILE, title: TabTitle[TabId.PROFILE], viewKey: ViewKey.PROFILE, element: <ProfilePage /> }`.
- Keep everything else (`navSection: NavSection.ACCOUNT`, order 40, route
  `/profile`, system/builtin, icon `IconName.USER`). Drop the now-unused imports
  of `AccountPanel`/`PluginsPanel`/`SettingsPanel` here (they are imported by
  `ProfilePage` instead).

## 4. Sidebar (`frontend/src/app/layout/Sidebar.tsx`)

- No behavioral change required: the account menu still shows **Profile** and
  **Log out**, and `openProfile` still activates the Profile plugin (now its
  single `PROFILE` tab). Verify it compiles against the single tab and that
  clicking Profile opens the page.

## 5. Tests

- `frontend/src/store/uiStore.test.ts` and `frontend/src/app/layout/TabBar.test.tsx`:
  they currently open/switch a **second** Profile tab (`TabId.PROFILE_PLUGINS`).
  Profile now has one tab, so retarget those multi-tab assertions to an existing
  multi-tab plugin (e.g. `PluginId.QAA_GENERATOR` with `TabId.QAA_GENERATE` /
  `TabId.QAA_ADMIN`, or `PluginId.STAGINGS`). Where a test asserts Profile's
  default sanitized state, expect `{ activeTabId: TabId.PROFILE, tabIds: [TabId.PROFILE] }`.
- `frontend/src/plugins/discovery.test.ts`: the synthetic manifest that used
  `ViewKey.PROFILE_PLUGINS` / `TabId.PROFILE_PLUGINS` must use the new
  `ViewKey.PROFILE` / `TabId.PROFILE` (or a clearly synthetic id that does not
  collide with a real one).
- Add a small `ProfilePage.test.tsx`: default section is Account; clicking the
  `Plugins` / `Settings` nested items swaps the rendered panel.
- Keep `AccountPanel.test.tsx` / `PluginsPanel.test.tsx` / `SettingsPanel.test.tsx`
  as-is (they test the panels directly).

## Acceptance

- Account menu → **Profile** opens a single "Profile" workspace tab.
- Inside it, a nested vertical menu switches Account / Plugins / Settings without
  opening extra workspace tabs.
- No `PROFILE_ACCOUNT` / `PROFILE_PLUGINS` / `PROFILE_SETTINGS` identifiers remain
  anywhere.
- Backend/agent untouched.
- `npm run lint`, `npx tsc --noEmit`, `npm run test`, `npm run build` all clean.
