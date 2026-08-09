import { AppShell, Paper } from "@mantine/core";

import { WorkspaceContent } from "@/components/WorkspaceContent";
import { type SectionKey as SectionKeyType } from "@/constants";
import { getTabsForSection, useUiStore } from "@/store/uiStore";

interface WorkspaceProps {
  activeSection: SectionKeyType;
}

export function Workspace({ activeSection }: WorkspaceProps) {
  const tabsBySection = useUiStore((state) => state.tabsBySection);
  const activeTabId = tabsBySection[activeSection].activeTabId;
  const activeTab =
    getTabsForSection(activeSection, tabsBySection).find((tab) => tab.id === activeTabId) ?? null;

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
        <WorkspaceContent activeSection={activeSection} tab={activeTab} />
      </Paper>
    </AppShell.Main>
  );
}
