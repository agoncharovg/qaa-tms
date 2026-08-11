import { AppShell, Paper } from "@mantine/core";

import { WorkspaceContent } from "@/components/WorkspaceContent";
import { type PluginId as PluginIdType } from "@/constants";
import { pluginById } from "@/plugins/registry";
import { getTabsForPlugin, useUiStore } from "@/store/uiStore";

interface WorkspaceProps {
  activePluginId: PluginIdType;
}

export function Workspace({ activePluginId }: WorkspaceProps) {
  const tabsByPlugin = useUiStore((state) => state.tabsByPlugin);
  const activePlugin = pluginById(activePluginId);
  const activeTabId = tabsByPlugin[activePluginId].activeTabId;
  const activeTab =
    getTabsForPlugin(activePluginId, tabsByPlugin).find((tab) => tab.id === activeTabId) ?? null;

  if (!activePlugin) {
    return null;
  }

  return (
    <AppShell.Main>
      <Paper
        h="calc(100vh - 116px)"
        p="md"
        radius="xl"
        shadow="sm"
        style={{
          backgroundColor: "rgba(7, 12, 18, 0.88)",
          border: "1px solid rgba(255, 255, 255, 0.06)",
          overflow: "auto",
        }}
      >
        <WorkspaceContent activePlugin={activePlugin} tab={activeTab} />
      </Paper>
    </AppShell.Main>
  );
}
