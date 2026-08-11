import { useEffect } from "react";
import { AppShell } from "@mantine/core";
import { useLocation, useNavigate } from "react-router-dom";

import { Sidebar } from "@/app/layout/Sidebar";
import { TabBar } from "@/app/layout/TabBar";
import { Workspace } from "@/app/layout/Workspace";
import { BuiltinHostApiProvider } from "@/core/plugins/host";
import {
  enabledOptionalPluginIdSet,
  pluginByRoute,
  visiblePlugins,
} from "@/plugins/registry";
import { PluginsProvider } from "@/plugins/provider";
import { useAuthStore } from "@/store/authStore";
import { syncTabsForUser, useUiStore } from "@/store/uiStore";

export function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const currentUser = useAuthStore((state) => state.currentUser);
  const sidebarCollapsed = useUiStore((state) => state.sidebarCollapsed);
  const enabledOptionalIds = enabledOptionalPluginIdSet(currentUser?.enabled_plugins);
  const activePlugin = pluginByRoute(location.pathname);
  const plugins = visiblePlugins(currentUser, enabledOptionalIds);
  const activePluginVisible = Boolean(activePlugin && plugins.some((plugin) => plugin.id === activePlugin.id));

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

  if (!currentUser || !activePlugin || !activePluginVisible) {
    return null;
  }

  return (
    <PluginsProvider>
      <BuiltinHostApiProvider>
        <AppShell
          header={{ height: 76 }}
          navbar={{ breakpoint: "sm", width: sidebarCollapsed ? 92 : 280 }}
          padding="md"
          styles={{
            main: {
              background:
                "radial-gradient(circle at top right, rgba(34, 139, 230, 0.14), transparent 30%), #0b1017",
              minHeight: "100vh",
            },
          }}
        >
          <Sidebar activePluginId={activePlugin.id} />
          <TabBar activePluginId={activePlugin.id} />
          <Workspace activePluginId={activePlugin.id} />
        </AppShell>
      </BuiltinHostApiProvider>
    </PluginsProvider>
  );
}
