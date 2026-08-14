import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { MantineProvider } from "@mantine/core";
import { IconRocket } from "@tabler/icons-react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import type { WorkspaceTabDefinition } from "@/api/types";
import { WorkspaceContent } from "@/components/WorkspaceContent";
import {
  CONTRACT_VERSION,
  ContentType,
  IconName,
  PluginId,
  PluginOrigin,
  TabId,
  TabTitle,
  ViewKey,
} from "@/constants";
import { definePlugin } from "@/core/plugins/definePlugin";
import { BuiltinHostApiProvider } from "@/core/plugins/host";
import { FALLBACK_PLUGIN_ICON, resolveIcon } from "@/core/plugins/icons";
import { PluginKind, type PluginManifest } from "@/core/plugins/types";
import { resetAuthStoreState, useAuthStore } from "@/store/authStore";

const CONTRACT_TEST_ROUTE = "/stagings" as const;

function renderWithHost(ui: ReactNode) {
  return render(
    <MantineProvider forceColorScheme="dark">
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <BuiltinHostApiProvider>{ui}</BuiltinHostApiProvider>
      </MemoryRouter>
    </MantineProvider>
  );
}

function createWorkspaceTabDefinition(overrides: Partial<WorkspaceTabDefinition> = {}): WorkspaceTabDefinition {
  return {
    closeable: true,
    contentType: ContentType.REACT_VIEW,
    id: TabId.STAGINGS_PREFLIGHT,
    pluginId: PluginId.STAGINGS,
    title: TabTitle[TabId.STAGINGS_PREFLIGHT],
    viewKey: ViewKey.STAGINGS_PREFLIGHT,
    ...overrides,
  };
}

function createPluginManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    contractVersion: CONTRACT_VERSION,
    id: PluginId.STAGINGS,
    icon: IconName.ROCKET,
    kind: PluginKind.OPTIONAL,
    label: "Contract Test",
    origin: PluginOrigin.BUILTIN,
    order: 10,
    route: CONTRACT_TEST_ROUTE,
    tabs: [
      {
        element: <div>builtin element</div>,
        id: TabId.STAGINGS_PREFLIGHT,
        title: TabTitle[TabId.STAGINGS_PREFLIGHT],
        viewKey: ViewKey.STAGINGS_PREFLIGHT,
      },
    ],
    ...overrides,
  };
}

describe("plugin contract", () => {
  it("does not render admin-only tabs for non-admin users", () => {
    resetAuthStoreState();
    useAuthStore.setState({
      currentUser: {
        auto_login: false,
        created_at: "2026-08-11T00:00:00Z",
        display_name: "Viewer",
        enabled_plugins: [PluginId.QAA_GENERATOR],
        qaa_generator_token_set: false,
        id: 2,
        is_admin: false,
        updated_at: "2026-08-11T00:00:00Z",
        username: "viewer@example.com",
      },
      token: "token-123",
    });

    const plugin = createPluginManifest({
      tabs: [
        {
          adminOnly: true,
          element: <div>admin panel</div>,
          id: TabId.QAA_ADMIN,
          title: "Admin",
          viewKey: ViewKey.QAA_ADMIN,
        },
      ],
    });

    renderWithHost(
      <WorkspaceContent
        activePlugin={plugin}
        tab={createWorkspaceTabDefinition({
          adminOnly: true,
          id: TabId.QAA_ADMIN,
          pluginId: PluginId.QAA_GENERATOR,
          title: "Admin",
          viewKey: ViewKey.QAA_ADMIN,
        })}
      />
    );

    expect(screen.queryByText("admin panel")).not.toBeInTheDocument();
  });

  it("mounts a builtin definePlugin mount tab in-process and cleans it up", () => {
    const cleanupSpy = vi.fn();
    let mountedElement: HTMLElement | undefined;

    const plugin = definePlugin({
      contractVersion: CONTRACT_VERSION,
      id: PluginId.STAGINGS,
      icon: IconName.ROCKET,
      kind: PluginKind.OPTIONAL,
      label: "Mount contract",
      origin: PluginOrigin.BUILTIN,
      order: 10,
      route: CONTRACT_TEST_ROUTE,
      tabs: [
        {
          id: TabId.STAGINGS_PREFLIGHT,
          mount({ container, host }) {
            mountedElement = container;
            container.textContent = JSON.stringify(host.theme.getTokens());
            return () => {
              cleanupSpy();
              container.replaceChildren();
            };
          },
          title: TabTitle[TabId.STAGINGS_PREFLIGHT],
          viewKey: ViewKey.STAGINGS_PREFLIGHT,
        },
      ],
    });

    const { unmount } = renderWithHost(
      <WorkspaceContent activePlugin={plugin} tab={createWorkspaceTabDefinition()} />
    );

    expect(screen.getByText(/"colorScheme":"dark"/)).toBeInTheDocument();
    if (!mountedElement) {
      throw new Error("Expected the mount contract test container to exist.");
    }
    expect(mountedElement.textContent).toContain('"primaryColor"');

    unmount();

    expect(cleanupSpy).toHaveBeenCalledTimes(1);
    expect(mountedElement.textContent).toBe("");
  });

  it("rejects a missing contractVersion", () => {
    const invalidPlugin = createPluginManifest() as unknown as Record<string, unknown>;
    delete invalidPlugin.contractVersion;

    expect(() => definePlugin(invalidPlugin as unknown as PluginManifest)).toThrow(
      /missing contractVersion/i
    );
  });

  it("rejects an out-of-range contractVersion", () => {
    expect(() =>
      definePlugin(
        createPluginManifest({
          contractVersion: CONTRACT_VERSION + 1,
        })
      )
    ).toThrow(/unsupported/i);
  });

  it("rejects a tab that declares both element and mount", () => {
    expect(() =>
      definePlugin({
        ...createPluginManifest(),
        tabs: [
          ({
            element: <div>duplicate</div>,
            id: TabId.STAGINGS_PREFLIGHT,
            mount() {
              return vi.fn();
            },
            title: TabTitle[TabId.STAGINGS_PREFLIGHT],
            viewKey: ViewKey.STAGINGS_PREFLIGHT,
          } as unknown as PluginManifest["tabs"][number]),
        ],
      })
    ).toThrow(/either element or mount, not both/i);
  });

  it("rejects a tab that declares neither element nor mount", () => {
    expect(() =>
      definePlugin({
        ...createPluginManifest(),
        tabs: [
          {
            id: TabId.STAGINGS_PREFLIGHT,
            title: TabTitle[TabId.STAGINGS_PREFLIGHT],
            viewKey: ViewKey.STAGINGS_PREFLIGHT,
          } as unknown as PluginManifest["tabs"][number],
        ],
      })
    ).toThrow(/exactly one render entry/i);
  });

  it("resolves icon names and falls back safely for unknown names", () => {
    expect(resolveIcon(IconName.ROCKET)).toBe(IconRocket);
    expect(resolveIcon("missing-icon")).toBe(FALLBACK_PLUGIN_ICON);
  });
});
