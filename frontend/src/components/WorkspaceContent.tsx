import { useEffect, useRef } from "react";
import { Alert, Code, Stack, Text, Title } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";

import type { WorkspaceTabDefinition } from "@/api/types";
import { ContentType, PluginOrigin } from "@/constants";
import { useBuiltinHostApi } from "@/core/plugins/host";
import {
  pluginTabHasElement,
  pluginTabHasMount,
  type PluginManifest,
  type PluginMountTab,
} from "@/core/plugins/types";
import { viewRegistry } from "@/plugins/registry";
import { useAuthStore } from "@/store/authStore";

interface WorkspaceContentProps {
  activePlugin: PluginManifest;
  tab: WorkspaceTabDefinition | null;
}

const PluginTabRenderCopy = {
  NO_LOCAL_PLUGIN_BODY: "Local plugins are not supported by this build yet.",
  NO_LOCAL_PLUGIN_TITLE: "Unsupported plugin origin",
} as const;

function MountedBuiltinPluginTab({
  mountTab,
  viewKey,
}: {
  mountTab: PluginMountTab;
  viewKey: PluginMountTab["viewKey"];
}) {
  const host = useBuiltinHostApi();
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    return mountTab.mount({
      container,
      host,
      viewKey,
    });
  }, [host, mountTab, viewKey]);

  return <div ref={containerRef} style={{ height: "100%" }} />;
}

function PluginTabView({ plugin, tab }: { plugin: PluginManifest; tab: WorkspaceTabDefinition }) {
  const pluginTab = plugin.tabs.find(
    (candidate) => candidate.id === tab.id && candidate.viewKey === tab.viewKey
  );

  switch (plugin.origin) {
    case PluginOrigin.BUILTIN:
      if (!pluginTab) {
        return null;
      }

      if (pluginTabHasElement(pluginTab)) {
        return viewRegistry[tab.viewKey!] ?? null;
      }

      if (pluginTabHasMount(pluginTab) && tab.viewKey) {
        return <MountedBuiltinPluginTab mountTab={pluginTab} viewKey={tab.viewKey} />;
      }

      return null;

    case PluginOrigin.LOCAL:
      // TODO(discuss/06 §5-6): replace this guard with the local iframe transport slice.
      return (
        <Alert icon={<IconInfoCircle size={16} />} title={PluginTabRenderCopy.NO_LOCAL_PLUGIN_TITLE}>
          <Text>{PluginTabRenderCopy.NO_LOCAL_PLUGIN_BODY}</Text>
          <Code>{tab.id}</Code>
        </Alert>
      );

    default:
      return null;
  }
}

export function WorkspaceContent({ activePlugin, tab }: WorkspaceContentProps) {
  const currentUser = useAuthStore((state) => state.currentUser);

  if (!tab) {
    return (
      <Stack gap="sm" h="100%" justify="center">
        <Title order={3}>No workspace tab is open</Title>
        <Text c="dimmed">
          Open a tab from the sidebar tree or the top bar to start working inside the {activePlugin.label} plugin.
        </Text>
      </Stack>
    );
  }

  if (tab.adminOnly && !currentUser?.is_admin) {
    return null;
  }

  if (tab.contentType === ContentType.REACT_VIEW && tab.viewKey) {
    return <PluginTabView plugin={activePlugin} tab={tab} />;
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
