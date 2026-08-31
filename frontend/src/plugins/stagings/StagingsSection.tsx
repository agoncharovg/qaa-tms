import {
  Button,
  Group,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import {
  IconFlask,
  IconHistory,
  IconPlaylistAdd,
  IconRocket,
} from "@tabler/icons-react";

import {
  PluginId,
  TabId,
  ViewKey,
  type ViewKey as ViewKeyType,
} from "@/constants";
import { DeployPanel } from "@/plugins/stagings/DeployPanel";
import { E2ePanel } from "@/plugins/stagings/E2ePanel";
import { HistoryPanel } from "@/plugins/stagings/HistoryPanel";
import { KubeconfigBanner } from "@/plugins/stagings/KubeconfigBanner";
import { NamespacesPanel } from "@/plugins/stagings/NamespacesPanel";
import { PreflightPanel } from "@/plugins/stagings/PreflightPanel";
import { SyncPanel } from "@/plugins/stagings/SyncPanel";
import { useUiStore } from "@/store/uiStoreCore";

interface StagingsSectionProps {
  mode: Extract<
    ViewKeyType,
    | typeof ViewKey.STAGINGS_PREFLIGHT
    | typeof ViewKey.STAGINGS_DEPLOY
    | typeof ViewKey.STAGINGS_HISTORY
    | typeof ViewKey.STAGINGS_NAMESPACES
    | typeof ViewKey.STAGINGS_SYNC
    | typeof ViewKey.STAGINGS_E2E
  >;
}

export function StagingsSection({ mode }: StagingsSectionProps) {
  const openTab = useUiStore((state) => state.openTab);
  const switchTab = useUiStore((state) => state.switchTab);
  const pluginTabs = useUiStore((state) => state.tabsByPlugin[PluginId.STAGINGS]);
  const deployOpen = pluginTabs.tabIds.includes(TabId.STAGINGS_DEPLOY);
  const historyOpen = pluginTabs.tabIds.includes(TabId.STAGINGS_HISTORY);
  const namespacesOpen = pluginTabs.tabIds.includes(TabId.STAGINGS_NAMESPACES);
  const e2eOpen = pluginTabs.tabIds.includes(TabId.STAGINGS_E2E);

  const activateTab = (tabId: typeof TabId[keyof typeof TabId]) => {
    if (pluginTabs.tabIds.includes(tabId)) {
      switchTab(PluginId.STAGINGS, tabId);
      return;
    }

    openTab(PluginId.STAGINGS, tabId);
  };

  let content = (
    <Stack gap="lg">
      <Group justify="space-between">
        <div>
          <Title order={2}>Stagings preflight</Title>
          <Text c="dimmed">
            Validate the local staging toolchain before deploy, destroy, adopt, sync, or E2E actions.
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
          <Button
            leftSection={<IconFlask size={16} />}
            onClick={() => activateTab(TabId.STAGINGS_E2E)}
            variant="light"
          >
            {e2eOpen ? "Switch to E2E" : "Open E2E tab"}
          </Button>
        </Group>
      </Group>

      <PreflightPanel />
    </Stack>
  );

  if (mode === ViewKey.STAGINGS_DEPLOY) {
    content = <DeployPanel />;
  } else if (mode === ViewKey.STAGINGS_HISTORY) {
    content = <HistoryPanel />;
  } else if (mode === ViewKey.STAGINGS_NAMESPACES) {
    content = <NamespacesPanel />;
  } else if (mode === ViewKey.STAGINGS_SYNC) {
    content = <SyncPanel />;
  } else if (mode === ViewKey.STAGINGS_E2E) {
    content = <E2ePanel />;
  }

  return (
    <Stack gap="lg">
      <KubeconfigBanner />
      {content}
    </Stack>
  );
}
