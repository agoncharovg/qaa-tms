import { useEffect, useRef } from "react";
import { AppShell, Stack } from "@mantine/core";
import { Navigate, useLocation } from "react-router-dom";

import { Sidebar } from "@/app/layout/Sidebar";
import { Workspace } from "@/app/layout/Workspace";
import { usePalette } from "@/app/theme/usePalette";
import { BuiltinHostApiProvider } from "@/core/plugins/host";
import { enabledOptionalPluginIdSet, pluginByRoute, visiblePlugins } from "@/plugins/registry";
import { PluginsProvider } from "@/plugins/provider";
import { RoutePath } from "@/constants";
import { useAuthStore } from "@/store/authStore";
import { activatePluginWorkspaceTab, syncTabsForUser, TAB_DEFINITIONS, useUiStore } from "@/store/uiStore";

export function AppLayout() {
  const location = useLocation();
  const palette = usePalette();
  const currentUser = useAuthStore((state) => state.currentUser);
  const activeWorkspaceTabId = useUiStore((state) => state.activeWorkspaceTabId);
  const sidebarCollapsed = useUiStore((state) => state.sidebarCollapsed);
  const enabledOptionalIds = enabledOptionalPluginIdSet(currentUser?.enabled_plugins);
  const activePlugin = pluginByRoute(location.pathname);
  const plugins = visiblePlugins(currentUser, enabledOptionalIds);
  const activePluginVisible = Boolean(activePlugin && plugins.some((plugin) => plugin.id === activePlugin.id));
  const workspaceBootstrappedRef = useRef(false);
  const syncedPathnameRef = useRef<string | null>(null);

  useEffect(() => {
    syncTabsForUser(currentUser);
  }, [currentUser]);

  useEffect(() => {
    if (!activePluginVisible || !activePlugin) {
      return;
    }

    const pathnameChanged = syncedPathnameRef.current !== location.pathname;
    syncedPathnameRef.current = location.pathname;

    if (!workspaceBootstrappedRef.current) {
      workspaceBootstrappedRef.current = true;

      // Honor a persisted workspace tab only when it belongs to the plugin the
      // URL points at. Otherwise a deep-link or reload to a different plugin
      // (e.g. /profile) would be overridden by the last-active tab restored from
      // localStorage, so the URL changes but the workspace keeps showing the old
      // tab — the link appears to do nothing.
      const bootstrappedPluginId = activeWorkspaceTabId
        ? TAB_DEFINITIONS[activeWorkspaceTabId]?.pluginId
        : undefined;
      if (activeWorkspaceTabId && bootstrappedPluginId === activePlugin.id) {
        return;
      }

      activatePluginWorkspaceTab(activePlugin.id);
      return;
    }

    if (!pathnameChanged || !activeWorkspaceTabId) {
      return;
    }

    const activeWorkspacePluginId = TAB_DEFINITIONS[activeWorkspaceTabId]?.pluginId;
    if (activeWorkspacePluginId !== activePlugin.id) {
      activatePluginWorkspaceTab(activePlugin.id);
    }
  }, [activePlugin, activePluginVisible, activeWorkspaceTabId, location.pathname]);

  if (!currentUser) {
    return <Navigate replace to={RoutePath.LOGIN} />;
  }

  if (!activePlugin || !activePluginVisible) {
    return <Navigate replace to={plugins[0]?.route ?? RoutePath.LOGIN} />;
  }

  return (
    <PluginsProvider>
      <BuiltinHostApiProvider>
        <AppShell
          navbar={{ breakpoint: "sm", width: sidebarCollapsed ? 84 : 264 }}
          padding="md"
          styles={{
            main: {
              background: palette.page,
              minHeight: "100vh",
            },
          }}
        >
          <Sidebar activePluginId={activePlugin.id} />
          <AppShell.Main>
            <Stack gap="md" h="calc(100vh - 32px)">
              <Workspace />
            </Stack>
          </AppShell.Main>
        </AppShell>
      </BuiltinHostApiProvider>
    </PluginsProvider>
  );
}
