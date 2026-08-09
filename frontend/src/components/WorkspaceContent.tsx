import { Alert, Code, Stack, Text, Title } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";

import type { WorkspaceTabDefinition } from "@/api/types";
import { ContentType, ViewKey, type SectionKey as SectionKeyType } from "@/constants";
import { UsersPage } from "@/features/admin/UsersPage";
import { StagingsSection } from "@/features/stagings/StagingsSection";

const reactViewRegistry = {
  [ViewKey.ADMIN_USERS]: <UsersPage />,
  [ViewKey.STAGINGS_DEPLOY]: <StagingsSection mode={ViewKey.STAGINGS_DEPLOY} />,
  [ViewKey.STAGINGS_HISTORY]: <StagingsSection mode={ViewKey.STAGINGS_HISTORY} />,
  [ViewKey.STAGINGS_NAMESPACES]: <StagingsSection mode={ViewKey.STAGINGS_NAMESPACES} />,
  [ViewKey.STAGINGS_PREFLIGHT]: <StagingsSection mode={ViewKey.STAGINGS_PREFLIGHT} />,
} as const;

interface WorkspaceContentProps {
  activeSection: SectionKeyType;
  tab: WorkspaceTabDefinition | null;
}

export function WorkspaceContent({ activeSection, tab }: WorkspaceContentProps) {
  if (!tab) {
    return (
      <Stack gap="sm" h="100%" justify="center">
        <Title order={3}>No workspace tab is open</Title>
        <Text c="dimmed">
          Open a tab from the top bar to start working inside the {activeSection} section.
        </Text>
      </Stack>
    );
  }

  if (tab.contentType === ContentType.REACT_VIEW && tab.viewKey) {
    return reactViewRegistry[tab.viewKey];
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
