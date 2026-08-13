import { AppShell, Paper } from "@mantine/core";

import { usePalette } from "@/app/theme/usePalette";
import { WorkspaceContent } from "@/components/WorkspaceContent";
import { type PluginId as PluginIdType } from "@/constants";
import { pluginById } from "@/plugins/registry";
import { getOpenWorkspaceTabs, useUiStore } from "@/store/uiStore";

interface WorkspaceProps {
  activePluginId?: PluginIdType;
}

export function Workspace(_: WorkspaceProps) {
  const palette = usePalette();
  const activeWorkspaceTabId = useUiStore((state) => state.activeWorkspaceTabId);
  const workspaceTabIds = useUiStore((state) => state.workspaceTabIds);
  const activeTab =
    getOpenWorkspaceTabs(workspaceTabIds).find((tab) => tab.id === activeWorkspaceTabId) ?? null;
  const activePlugin = pluginById(activeTab?.pluginId);

  return (
    <AppShell.Main>
      <Paper
        h="calc(100vh - 100px)"
        p="lg"
        radius="lg"
        style={{
          backgroundColor: palette.surface,
          border: `1px solid ${palette.line}`,
          overflow: "auto",
        }}
      >
        <WorkspaceContent activePlugin={activePlugin ?? null} tab={activeTab} />
      </Paper>
    </AppShell.Main>
  );
}
