import { AppShell, Paper } from "@mantine/core";

import { WorkspaceContent } from "@/components/WorkspaceContent";
import { type PluginId as PluginIdType } from "@/constants";
import { pluginById } from "@/plugins/registry";
import { getOpenWorkspaceTabs, useUiStore } from "@/store/uiStore";

interface WorkspaceProps {
  activePluginId?: PluginIdType;
}

export function Workspace(_: WorkspaceProps) {
  const activeWorkspaceTabId = useUiStore((state) => state.activeWorkspaceTabId);
  const workspaceTabIds = useUiStore((state) => state.workspaceTabIds);
  const activeTab =
    getOpenWorkspaceTabs(workspaceTabIds).find((tab) => tab.id === activeWorkspaceTabId) ?? null;
  const activePlugin = pluginById(activeTab?.pluginId);

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
        <WorkspaceContent activePlugin={activePlugin ?? null} tab={activeTab} />
      </Paper>
    </AppShell.Main>
  );
}
