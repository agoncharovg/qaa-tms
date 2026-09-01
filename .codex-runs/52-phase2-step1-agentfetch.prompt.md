Implement **Phase 2 · step 1** of brief 52: add an authenticated agent-fetch to the local-plugin contract. Small, focused, in-repo change. Do NOT port Notebook/Requests yet and do NOT remove anything from the host — later steps.

## Why

Local plugins render via `mount(viewKey, ctx: MountContext)`. Today `MountContext` only has
`agentBaseUrl` (a string), so a plugin has no sanctioned way to call the agent WITH the
companion auth token. Notebook/Requests make many authenticated agent calls, so the contract
must expose an authenticated fetch. The token must stay host-injected (the plugin should not
have to handle it).

## Change

Add an `agent` capability to `MountContext` (in `frontend/src/core/plugins/host.ts` and mirrored
in `sdk/src` + the drift guard):

```ts
interface AgentAccess {
  baseUrl: string;                                  // resolved companion base URL
  fetch(path: string, init?: RequestInit): Promise<Response>; // prepends baseUrl + injects auth
}
interface MountContext {
  container: HTMLElement;
  viewKey: ViewKey;
  host: HostApi;
  agent: AgentAccess;      // NEW
  agentBaseUrl?: string;   // keep for back-compat
}
```

- The host builds `agent.fetch` where the current authenticated bundle path is built
  (`frontend/src/components/WorkspaceContent.tsx` `MountedPluginTab`, which already has the
  resolved agent base URL, plus the companion token from `useAuthStore`). `agent.fetch(path, init)`
  must resolve `new URL(path, baseUrl)` and merge the companion Authorization header the app uses
  elsewhere (reuse `createAgentHeaders` from `@/api/agentClient`) into `init.headers` without
  clobbering caller-supplied headers.
- Update the SDK: add `AgentAccess` + the `agent` field on `MountContext` in `sdk/src`
  (contracts), keep the existing `agentFetch` helper but have it complement this (or note that
  `ctx.agent.fetch` is the sanctioned runtime path). Update the drift guard
  `frontend/src/core/plugins/sdkContract.test.ts` so SDK and host `MountContext` remain
  bidirectionally assignable.
- Update the local loader's mount wiring (`frontend/src/plugins/localPlugins.ts`
  `buildLocalPluginTab` / wherever `mount(ctx)` is invoked) and `MountedBuiltinPluginTab` so the
  `agent` object is present in the `MountContext` passed to `mount()`. Where a builtin mount tab
  has no agent available, provide an `agent` whose `fetch` rejects with a clear error and
  `baseUrl: ""` (do not pass a half-built context).
- The hello example does not need to change, but if trivial, add one line in its README noting
  `ctx.agent.fetch("/your/endpoint")` is how a plugin calls the agent authenticated.

## Gates

Frontend `eslint`, `tsc --noEmit`, `vitest` (incl. the updated drift guard) all pass; do not
weaken types. Add a small unit test that `agent.fetch("/x", ...)` targets `${baseUrl}/x` and
includes the auth header (mock fetch).

When done: print the changed files, the final `MountContext`/`AgentAccess` shape, and confirm gates pass.
