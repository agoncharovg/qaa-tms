import { afterEach, describe, expect, it, vi } from "vitest";

import { createAgentHeaders } from "@/api/agentClient";
import { CONTRACT_VERSION, PluginOrigin } from "@/constants";
import { PluginKind, pluginTabHasMount } from "@/core/plugins/types";
import { loadLocalPluginsFromAgent } from "@/plugins/localPlugins";

const AGENT_BASE_URL = "http://127.0.0.1:47600";
const TOKEN = "token-123";

function createManifestPayload() {
  return {
    plugins: [
      {
        contractVersion: CONTRACT_VERSION,
        entry: "dist/index.js",
        entryUrl: "/plugins/local-alpha/assets/dist/index.js",
        icon: "sparkles",
        id: "local-alpha",
        label: "Local Alpha",
        order: 500,
        requiresAgent: true,
        route: "/local-alpha",
        tabs: [
          {
            id: "local-alpha-tab",
            title: "Alpha",
            viewKey: "local-alpha-view",
          },
        ],
      },
    ],
    warnings: [],
  };
}

function createJsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}

function expectHeadersMatch(actual: HeadersInit | undefined, expected: Headers): void {
  const actualHeaders = new Headers(actual);
  const expectedEntries = Array.from(expected.entries()).sort(([left], [right]) =>
    left.localeCompare(right)
  );
  const actualEntries = Array.from(actualHeaders.entries()).sort(([left], [right]) =>
    left.localeCompare(right)
  );

  expect(actualEntries).toEqual(expectedEntries);
}

function readRequestUrl(input: string | URL | Request): string {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.href;
  }

  return input.url;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadLocalPluginsFromAgent", () => {
  it("builds LOCAL manifests and isolates import or contract failures", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const mountSpy = vi.fn(() => vi.fn());
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        createJsonResponse({
          plugins: [
            createManifestPayload().plugins[0],
            {
              contractVersion: CONTRACT_VERSION,
              entry: "dist/index.js",
              entryUrl: "/plugins/broken-import/assets/dist/index.js",
              icon: "sparkles",
              id: "broken-import",
              label: "Broken Import",
              order: 501,
              requiresAgent: true,
              route: "/broken-import",
              tabs: [
                {
                  id: "broken-import-tab",
                  title: "Broken",
                  viewKey: "broken-import-view",
                },
              ],
            },
            {
              contractVersion: CONTRACT_VERSION + 1,
              entry: "dist/index.js",
              entryUrl: "/plugins/unsupported/assets/dist/index.js",
              icon: "sparkles",
              id: "unsupported",
              label: "Unsupported",
              order: 502,
              requiresAgent: true,
              route: "/unsupported",
              tabs: [
                {
                  id: "unsupported-tab",
                  title: "Unsupported",
                  viewKey: "unsupported-view",
                },
              ],
            },
          ],
          warnings: [{ dir: "ignored", error: "bad plugin.json" }],
        })
      )
    );
    const importModule = vi.fn(({ plugin }: { plugin: { id: string } }) => {
      if (plugin.id === "local-alpha") {
        return Promise.resolve({
          default: {
            contractVersion: CONTRACT_VERSION,
            mount: mountSpy,
          },
        });
      }

      if (plugin.id === "broken-import") {
        return Promise.reject(new Error("module exploded"));
      }

      return Promise.resolve({
        default: {
          contractVersion: CONTRACT_VERSION + 1,
          mount: vi.fn(() => vi.fn()),
        },
      });
    });

    const plugins = await loadLocalPluginsFromAgent(
      {
        agentBaseUrl: AGENT_BASE_URL,
        token: TOKEN,
      },
      {
        fetchImpl,
        importModule,
      }
    );

    expect(plugins).toHaveLength(1);
    expect(plugins[0]).toMatchObject({
      contractVersion: CONTRACT_VERSION,
      id: "local-alpha",
      kind: PluginKind.OPTIONAL,
      origin: PluginOrigin.LOCAL,
      route: "/local-alpha",
    });
    expect(importModule.mock.calls[0]?.[0]).toMatchObject({
      agentBaseUrl: AGENT_BASE_URL,
      plugin: { id: "local-alpha" },
      signal: undefined,
      token: TOKEN,
    });

    const [loadedPlugin] = plugins;
    expect(loadedPlugin).toBeDefined();
    if (!loadedPlugin) {
      throw new Error("Expected the loaded local plugin to exist.");
    }

    const [loadedTab] = loadedPlugin.tabs;
    expect(pluginTabHasMount(loadedTab)).toBe(true);
    if (!loadedTab || !pluginTabHasMount(loadedTab)) {
      throw new Error("Expected the loaded local plugin tab to mount.");
    }

    loadedTab.mount({
      agentBaseUrl: AGENT_BASE_URL,
      container: document.createElement("div"),
      host: {
        contractVersion: CONTRACT_VERSION,
        nav: {},
        theme: {
          getTokens: () => ({
            background: "#000",
            border: "#111",
            colorScheme: "dark",
            dimmed: "#222",
            fontFamily: "sans-serif",
            primaryColor: "#333",
            radius: "4px",
            spacing: "8px",
            surface: "#444",
            text: "#fff",
          }),
          subscribe: () => () => undefined,
        },
        view: {
          requestResize: () => undefined,
          setBusy: () => undefined,
          setTitle: () => undefined,
        },
      },
      viewKey: "local-alpha-view",
    });

    expect(mountSpy).toHaveBeenCalledWith(
      "local-alpha-view",
      expect.objectContaining({
        agentBaseUrl: AGENT_BASE_URL,
        viewKey: "local-alpha-view",
      })
    );
    expect(warnSpy).toHaveBeenCalledWith('Local plugin warning for "ignored": bad plugin.json');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Skipping local plugin "broken-import": module exploded')
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'Skipping local plugin "unsupported": local plugin "unsupported" contractVersion'
      )
    );
  });

  it("fetches bundle entries with auth headers and builds manifests from the fetched module", async () => {
    const bundleSource =
      'export default { contractVersion: 1, mount(viewKey, ctx) { return () => undefined; } };';
    const bundleBlobUrl = "blob:local-alpha";
    const mountSpy = vi.fn(() => vi.fn());
    const abortController = new AbortController();
    const fetchImpl = vi.fn(
      (input: string | URL | Request, init?: RequestInit) => {
        const url = readRequestUrl(input);
        if (url === `${AGENT_BASE_URL}/plugins`) {
          return Promise.resolve(createJsonResponse(createManifestPayload()));
        }

        if (url === `${AGENT_BASE_URL}/plugins/local-alpha/assets/dist/index.js`) {
          expectHeadersMatch(init?.headers, createAgentHeaders(TOKEN));
          expect(init?.signal).toBe(abortController.signal);

          return Promise.resolve(
            new Response(bundleSource, {
              headers: { "Content-Type": "text/javascript" },
              status: 200,
            })
          );
        }

        throw new Error(`Unexpected fetch URL: ${url}`);
      }
    );
    const createBlobUrl = vi.fn((source: string) => {
      expect(source).toBe(bundleSource);
      return bundleBlobUrl;
    });
    const importBlobUrl = vi.fn((url: string) => {
      expect(url).toBe(bundleBlobUrl);
      return Promise.resolve({
        default: {
          contractVersion: CONTRACT_VERSION,
          mount: mountSpy,
        },
      });
    });
    const revokeBlobUrl = vi.fn();

    const plugins = await loadLocalPluginsFromAgent(
      {
        agentBaseUrl: AGENT_BASE_URL,
        signal: abortController.signal,
        token: TOKEN,
      },
      {
        createBlobUrl,
        fetchImpl,
        importBlobUrl,
        revokeBlobUrl,
      }
    );

    expect(plugins).toHaveLength(1);
    expect(plugins[0]).toMatchObject({
      contractVersion: CONTRACT_VERSION,
      id: "local-alpha",
      kind: PluginKind.OPTIONAL,
      origin: PluginOrigin.LOCAL,
      route: "/local-alpha",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(createBlobUrl).toHaveBeenCalledWith(bundleSource);
    expect(importBlobUrl).toHaveBeenCalledWith(bundleBlobUrl);
    expect(revokeBlobUrl).toHaveBeenCalledWith(bundleBlobUrl);

    const [loadedPlugin] = plugins;
    if (!loadedPlugin) {
      throw new Error("Expected the loaded local plugin to exist.");
    }
    const [loadedTab] = loadedPlugin.tabs;
    if (!loadedTab || !pluginTabHasMount(loadedTab)) {
      throw new Error("Expected the loaded local plugin tab to mount.");
    }

    loadedTab.mount({
      agentBaseUrl: AGENT_BASE_URL,
      container: document.createElement("div"),
      host: {
        contractVersion: CONTRACT_VERSION,
        nav: {},
        theme: {
          getTokens: () => ({
            background: "#000",
            border: "#111",
            colorScheme: "dark",
            dimmed: "#222",
            fontFamily: "sans-serif",
            primaryColor: "#333",
            radius: "4px",
            spacing: "8px",
            surface: "#444",
            text: "#fff",
          }),
          subscribe: () => () => undefined,
        },
        view: {
          requestResize: () => undefined,
          setBusy: () => undefined,
          setTitle: () => undefined,
        },
      },
      viewKey: "local-alpha-view",
    });

    expect(mountSpy).toHaveBeenCalledWith(
      "local-alpha-view",
      expect.objectContaining({
        agentBaseUrl: AGENT_BASE_URL,
        viewKey: "local-alpha-view",
      })
    );
  });

  it("skips a plugin when its bundle fetch is non-ok and still loads siblings", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchImpl = vi.fn((input: string | URL | Request) => {
      const url = readRequestUrl(input);
      if (url === `${AGENT_BASE_URL}/plugins`) {
        return Promise.resolve(
          createJsonResponse({
            plugins: [
              {
                contractVersion: CONTRACT_VERSION,
                entry: "dist/index.js",
                entryUrl: "/plugins/unauthorized/assets/dist/index.js",
                icon: "sparkles",
                id: "unauthorized",
                label: "Unauthorized",
                order: 500,
                requiresAgent: true,
                route: "/unauthorized",
                tabs: [
                  {
                    id: "unauthorized-tab",
                    title: "Unauthorized",
                    viewKey: "unauthorized-view",
                  },
                ],
              },
              {
                contractVersion: CONTRACT_VERSION,
                entry: "dist/index.js",
                entryUrl: "/plugins/local-alpha/assets/dist/index.js",
                icon: "sparkles",
                id: "local-alpha",
                label: "Local Alpha",
                order: 501,
                requiresAgent: true,
                route: "/local-alpha",
                tabs: [
                  {
                    id: "local-alpha-tab",
                    title: "Alpha",
                    viewKey: "local-alpha-view",
                  },
                ],
              },
            ],
            warnings: [],
          })
        );
      }

      if (url === `${AGENT_BASE_URL}/plugins/unauthorized/assets/dist/index.js`) {
        return Promise.resolve(new Response("unauthorized", { status: 401 }));
      }

      if (url === `${AGENT_BASE_URL}/plugins/local-alpha/assets/dist/index.js`) {
        return Promise.resolve(
          new Response("export default {}", {
            headers: { "Content-Type": "text/javascript" },
            status: 200,
          })
        );
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });
    const createBlobUrl = vi.fn(() => "blob:local-alpha");
    const importBlobUrl = vi.fn(() =>
      Promise.resolve({
        default: {
          contractVersion: CONTRACT_VERSION,
          mount: vi.fn(() => vi.fn()),
        },
      })
    );
    const revokeBlobUrl = vi.fn();

    const plugins = await loadLocalPluginsFromAgent(
      {
        agentBaseUrl: AGENT_BASE_URL,
        token: TOKEN,
      },
      {
        createBlobUrl,
        fetchImpl,
        importBlobUrl,
        revokeBlobUrl,
      }
    );

    expect(plugins).toHaveLength(1);
    expect(plugins[0]?.id).toBe("local-alpha");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        `Skipping local plugin "unauthorized": GET ${AGENT_BASE_URL}/plugins/unauthorized/assets/dist/index.js failed with status 401.`
      )
    );
    expect(importBlobUrl).toHaveBeenCalledTimes(1);
    expect(revokeBlobUrl).toHaveBeenCalledWith("blob:local-alpha");
  });
});
