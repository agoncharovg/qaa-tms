# `@qaa-tms/plugin-sdk`

Tiny public SDK for QAA TMS local plugins. It contains the host contract types, local-plugin
metadata types, the `LocalPluginModule` interface, and small agent-request helpers. It has no
React dependency.

## Build

```bash
npm install
npm run build
```

The build emits ESM and type declarations into `dist/`.

## Public surface

- Contract types: `HostApi`, `ThemeTokens`, `MountContext`, `Unmount`
- Local-plugin types: `LocalPluginManifestMetadata`, `LocalPluginTabMetadata`,
  `LocalPluginRead`, `LocalPluginWarning`, `LocalPluginsResponse`
- Metadata shapes: `PluginManifestMetadata`, `PluginTabMetadata`, `PluginKind`,
  `PluginOrigin`, `NavSection`
- Runtime helpers: `CONTRACT_VERSION`, `SUPPORTED_CONTRACT_VERSION_RANGE`,
  `isSupportedContractVersion`, `resolveAgentUrl`, `createAgentHeaders`, `agentFetch`

## Local bundle requirement

The host loads local plugin bundles by fetching them from the agent and importing the source
through a same-origin `blob:` URL. Because of that, each plugin entry must be a single-file,
self-contained ESM bundle:

- no code splitting
- no bare module specifiers at runtime
- no relative chunk imports

See [`examples/hello-plugin`](./examples/hello-plugin/) for the template build setup.
