import { Alert, Code, Stack, Text, Title } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";

import type { WorkspaceTabDefinition } from "@/api/types";
import { ContentType } from "@/constants";
import { viewRegistry } from "@/plugins/registry";
import { useAuthStore } from "@/store/authStore";

interface WorkspaceContentProps {
  activePluginLabel: string;
  tab: WorkspaceTabDefinition | null;
}

export function WorkspaceContent({ activePluginLabel, tab }: WorkspaceContentProps) {
  const currentUser = useAuthStore((state) => state.currentUser);

  if (!tab) {
    return (
      <Stack gap="sm" h="100%" justify="center">
        <Title order={3}>No workspace tab is open</Title>
        <Text c="dimmed">
          Open a tab from the top bar to start working inside the {activePluginLabel} plugin.
        </Text>
      </Stack>
    );
  }

  if (tab.adminOnly && !currentUser?.is_admin) {
    return null;
  }

  if (tab.contentType === ContentType.REACT_VIEW && tab.viewKey) {
    return viewRegistry[tab.viewKey] ?? null;
  }

  if (tab.contentType === ContentType.IFRAME && tab.iframeSrc) {
    return (
      <iframe
        src={tab.iframeSrc}
        style={{ border: 0, height: "100%", width: "100%" }}
        title={tab.title}
      />
    );
  }

  if (tab.contentType === ContentType.HTML && tab.html) {
    return <div dangerouslySetInnerHTML={{ __html: tab.html }} />;
  }

  return (
    <Alert icon={<IconInfoCircle size={16} />} title="Unsupported content">
      <Text>This tab cannot be rendered yet.</Text>
      <Code>{tab.id}</Code>
    </Alert>
  );
}
