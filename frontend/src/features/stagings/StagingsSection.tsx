import { Alert, Button, Group, Stack, Text, Title } from "@mantine/core";
import { IconInfoCircle, IconLayoutKanban, IconPlaylistAdd } from "@tabler/icons-react";

import { PreflightPanel } from "@/features/stagings/PreflightPanel";
import { SectionKey, TabId, ViewKey, type ViewKey as ViewKeyType } from "@/constants";
import { useUiStore } from "@/store/uiStore";

interface StagingsSectionProps {
  mode: Extract<ViewKeyType, typeof ViewKey.STAGINGS_PREFLIGHT | typeof ViewKey.STAGINGS_NAMESPACES>;
}

export function StagingsSection({ mode }: StagingsSectionProps) {
  const openTab = useUiStore((state) => state.openTab);
  const switchTab = useUiStore((state) => state.switchTab);
  const sectionTabs = useUiStore((state) => state.tabsBySection[SectionKey.STAGINGS]);
  const namespacesOpen = sectionTabs.tabIds.includes(TabId.STAGINGS_NAMESPACES);

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
        <Button
          leftSection={<IconPlaylistAdd size={16} />}
          onClick={() => {
            if (namespacesOpen) {
              switchTab(SectionKey.STAGINGS, TabId.STAGINGS_NAMESPACES);
              return;
            }

            openTab(SectionKey.STAGINGS, TabId.STAGINGS_NAMESPACES);
          }}
          variant="light"
        >
          {namespacesOpen ? "Switch to Namespaces" : "Open Namespaces tab"}
        </Button>
      </Group>

      <PreflightPanel />
    </Stack>
  );
}
