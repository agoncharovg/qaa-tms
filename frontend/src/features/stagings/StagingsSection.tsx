import { Button, Group, Stack, Text, Title } from "@mantine/core";
import { IconHistory, IconPlaylistAdd, IconRefresh, IconRocket } from "@tabler/icons-react";

import { DeployPanel } from "@/features/stagings/DeployPanel";
import { HistoryPanel } from "@/features/stagings/HistoryPanel";
import { NamespacesPanel } from "@/features/stagings/NamespacesPanel";
import { PreflightPanel } from "@/features/stagings/PreflightPanel";
import { SyncPanel } from "@/features/stagings/SyncPanel";
import { SectionKey, TabId, ViewKey, type ViewKey as ViewKeyType } from "@/constants";
import { useUiStore } from "@/store/uiStore";

interface StagingsSectionProps {
  mode: Extract<
    ViewKeyType,
    | typeof ViewKey.STAGINGS_PREFLIGHT
    | typeof ViewKey.STAGINGS_DEPLOY
    | typeof ViewKey.STAGINGS_HISTORY
    | typeof ViewKey.STAGINGS_NAMESPACES
    | typeof ViewKey.STAGINGS_SYNC
  >;
}

export function StagingsSection({ mode }: StagingsSectionProps) {
  const openTab = useUiStore((state) => state.openTab);
  const switchTab = useUiStore((state) => state.switchTab);
  const sectionTabs = useUiStore((state) => state.tabsBySection[SectionKey.STAGINGS]);
  const deployOpen = sectionTabs.tabIds.includes(TabId.STAGINGS_DEPLOY);
  const historyOpen = sectionTabs.tabIds.includes(TabId.STAGINGS_HISTORY);
  const namespacesOpen = sectionTabs.tabIds.includes(TabId.STAGINGS_NAMESPACES);
  const syncOpen = sectionTabs.tabIds.includes(TabId.STAGINGS_SYNC);

  const activateTab = (tabId: typeof TabId[keyof typeof TabId]) => {
    if (sectionTabs.tabIds.includes(tabId)) {
      switchTab(SectionKey.STAGINGS, tabId);
      return;
    }

    openTab(SectionKey.STAGINGS, tabId);
  };

  if (mode === ViewKey.STAGINGS_DEPLOY) {
    return <DeployPanel />;
  }

  if (mode === ViewKey.STAGINGS_HISTORY) {
    return <HistoryPanel />;
  }

  if (mode === ViewKey.STAGINGS_NAMESPACES) {
    return <NamespacesPanel />;
  }

  if (mode === ViewKey.STAGINGS_SYNC) {
    return <SyncPanel />;
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <div>
          <Title order={2}>Stagings preflight</Title>
          <Text c="dimmed">
            Validate the local staging toolchain before deploy, destroy, adopt, or sync actions.
          </Text>
        </div>
        <Group>
          <Button leftSection={<IconRocket size={16} />} onClick={() => activateTab(TabId.STAGINGS_DEPLOY)} variant="light">
            {deployOpen ? "Switch to Deploy" : "Open Deploy tab"}
          </Button>
          <Button leftSection={<IconHistory size={16} />} onClick={() => activateTab(TabId.STAGINGS_HISTORY)} variant="light">
            {historyOpen ? "Switch to History" : "Open History tab"}
          </Button>
          <Button
            leftSection={<IconPlaylistAdd size={16} />}
            onClick={() => activateTab(TabId.STAGINGS_NAMESPACES)}
            variant="light"
          >
            {namespacesOpen ? "Switch to Namespaces" : "Open Namespaces tab"}
          </Button>
          <Button leftSection={<IconRefresh size={16} />} onClick={() => activateTab(TabId.STAGINGS_SYNC)} variant="light">
            {syncOpen ? "Switch to Sync" : "Open Sync tab"}
          </Button>
        </Group>
      </Group>

      <PreflightPanel />
    </Stack>
  );
}
