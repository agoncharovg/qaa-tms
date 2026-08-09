import { Alert, Button, Group, Stack, Text, Title } from "@mantine/core";
import {
  IconHistory,
  IconInfoCircle,
  IconLayoutKanban,
  IconPlaylistAdd,
  IconRocket,
} from "@tabler/icons-react";

import { DeployPanel } from "@/features/stagings/DeployPanel";
import { HistoryPanel } from "@/features/stagings/HistoryPanel";
import { PreflightPanel } from "@/features/stagings/PreflightPanel";
import { SectionKey, TabId, ViewKey, type ViewKey as ViewKeyType } from "@/constants";
import { useUiStore } from "@/store/uiStore";

interface StagingsSectionProps {
  mode: Extract<
    ViewKeyType,
    | typeof ViewKey.STAGINGS_PREFLIGHT
    | typeof ViewKey.STAGINGS_DEPLOY
    | typeof ViewKey.STAGINGS_HISTORY
    | typeof ViewKey.STAGINGS_NAMESPACES
  >;
}

export function StagingsSection({ mode }: StagingsSectionProps) {
  const openTab = useUiStore((state) => state.openTab);
  const switchTab = useUiStore((state) => state.switchTab);
  const sectionTabs = useUiStore((state) => state.tabsBySection[SectionKey.STAGINGS]);
  const deployOpen = sectionTabs.tabIds.includes(TabId.STAGINGS_DEPLOY);
  const historyOpen = sectionTabs.tabIds.includes(TabId.STAGINGS_HISTORY);
  const namespacesOpen = sectionTabs.tabIds.includes(TabId.STAGINGS_NAMESPACES);

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
    return (
      <Stack gap="lg">
        <Group justify="space-between">
          <div>
            <Title order={2}>Namespaces</Title>
            <Text c="dimmed">
              Real namespace controls arrive with the companion app implementation in a later slice.
            </Text>
          </div>
          <Button
            leftSection={<IconLayoutKanban size={16} />}
            onClick={() => switchTab(SectionKey.STAGINGS, TabId.STAGINGS_PREFLIGHT)}
            variant="light"
          >
            Back to preflight
          </Button>
        </Group>

        <Alert icon={<IconInfoCircle size={18} />} title="Companion app required">
          This screen depends on the local companion app and will stay empty until that app is
          available.
        </Alert>
      </Stack>
    );
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <div>
          <Title order={2}>Stagings preflight</Title>
          <Text c="dimmed">
            Validate the local staging toolchain before deploy, destroy, or test actions are added.
          </Text>
        </div>
        <Group>
          <Button
            leftSection={<IconRocket size={16} />}
            onClick={() => activateTab(TabId.STAGINGS_DEPLOY)}
            variant="light"
          >
            {deployOpen ? "Switch to Deploy" : "Open Deploy tab"}
          </Button>
          <Button
            leftSection={<IconHistory size={16} />}
            onClick={() => activateTab(TabId.STAGINGS_HISTORY)}
            variant="light"
          >
            {historyOpen ? "Switch to History" : "Open History tab"}
          </Button>
          <Button
            leftSection={<IconPlaylistAdd size={16} />}
            onClick={() => activateTab(TabId.STAGINGS_NAMESPACES)}
            variant="light"
          >
            {namespacesOpen ? "Switch to Namespaces" : "Open Namespaces tab"}
          </Button>
        </Group>
      </Group>

      <PreflightPanel />
    </Stack>
  );
}
