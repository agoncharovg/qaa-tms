import { useEffect, useRef } from "react";
import { AppShell } from "@mantine/core";
import { useLocation, useNavigate } from "react-router-dom";

import { Sidebar } from "@/app/layout/Sidebar";
import { TabBar } from "@/app/layout/TabBar";
import { Workspace } from "@/app/layout/Workspace";
import { palette } from "@/app/theme/tokens";
import { BuiltinHostApiProvider } from "@/core/plugins/host";
import {
  enabledOptionalPluginIdSet,
  pluginByRoute,
  visiblePlugins,
} from "@/plugins/registry";
import { PluginsProvider } from "@/plugins/provider";
import { useAuthStore } from "@/store/authStore";
import { activatePluginWorkspaceTab, syncTabsForUser, TAB_DEFINITIONS, useUiStore } from "@/store/uiStore";

export function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const currentUser = useAuthStore((state) => state.currentUser);
  const activeWorkspaceTabId = useUiStore((state) => state.activeWorkspaceTabId);
  const sidebarCollapsed = useUiStore((state) => state.sidebarCollapsed);
  const enabledOptionalIds = enabledOptionalPluginIdSet(currentUser?.enabled_plugins);
  const activePlugin = pluginByRoute(location.pathname);
  const plugins = visiblePlugins(currentUser, enabledOptionalIds);
  const activePluginVisible = Boolean(activePlugin && plugins.some((plugin) => plugin.id === activePlugin.id));
  const workspaceBootstrappedRef = useRef(false);

  useEffect(() => {
    syncTabsForUser(currentUser);
  }, [currentUser]);

  useEffect(() => {
    if (plugins.length === 0) {
      return;
    }
    if (!activePlugin || !plugins.some((plugin) => plugin.id === activePlugin.id)) {
      navigate(plugins[0].route, { replace: true });
    }
  }, [activePlugin, navigate, plugins]);

  useEffect(() => {
    if (!activePluginVisible || !activePlugin) {
      return;
    }

    if (!workspaceBootstrappedRef.current) {
      if (activeWorkspaceTabId) {
        workspaceBootstrappedRef.current = true;
        return;
      }

      activatePluginWorkspaceTab(activePlugin.id);
      workspaceBootstrappedRef.current = true;
      return;
    }

    if (!activeWorkspaceTabId) {
      return;
    }

    const activeWorkspacePluginId = TAB_DEFINITIONS[activeWorkspaceTabId]?.pluginId;
    if (activeWorkspacePluginId !== activePlugin.id) {
      activatePluginWorkspaceTab(activePlugin.id);
    }
  }, [activePlugin, activePluginVisible, activeWorkspaceTabId]);

  if (!currentUser || !activePlugin || !activePluginVisible) {
    return null;
  }

  return (
    <PluginsProvider>
      <BuiltinHostApiProvider>
        <AppShell
          header={{ height: 60 }}
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
          <TabBar />
          <Workspace />
        </AppShell>
      </BuiltinHostApiProvider>
    </PluginsProvider>
  );
}
