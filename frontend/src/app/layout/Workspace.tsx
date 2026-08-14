import { Paper } from "@mantine/core";

import { usePalette } from "@/app/theme/usePalette";
import { WorkspaceContent } from "@/components/WorkspaceContent";
import { pluginById } from "@/plugins/registry";
import { getOpenWorkspaceTabs, useUiStore } from "@/store/uiStore";

export function Workspace() {
  const palette = usePalette();
  const activeWorkspaceTabId = useUiStore((state) => state.activeWorkspaceTabId);
  const workspaceTabIds = useUiStore((state) => state.workspaceTabIds);
  const activeTab =
    getOpenWorkspaceTabs(workspaceTabIds).find((tab) => tab.id === activeWorkspaceTabId) ?? null;
  const activePlugin = pluginById(activeTab?.pluginId);

  return (
    <Paper
      p="lg"
      radius="lg"
      style={{
        backgroundColor: palette.surface,
        border: `1px solid ${palette.line}`,
        flex: 1,
        minHeight: 0,
        overflow: "auto",
      }}
    >
      <WorkspaceContent activePlugin={activePlugin ?? null} tab={activeTab} />
    </Paper>
  );
}
