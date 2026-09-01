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
import { useResolvedAgentBaseUrl } from "@/plugins/localPlugins";
import { useViewRegistry } from "@/plugins/registry";
import { useAuthStore } from "@/store/authStore";

interface WorkspaceContentProps {
  activePlugin: PluginManifest | null;
  tab: WorkspaceTabDefinition | null;
}

function MountedPluginTab({
  agentBaseUrl,
  mountTab,
  viewKey,
}: {
  agentBaseUrl?: string;
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
      agentBaseUrl,
      container,
      host,
      viewKey,
    });
  }, [agentBaseUrl, host, mountTab, viewKey]);

  return <div ref={containerRef} style={{ height: "100%" }} />;
}

function PluginTabView({ plugin, tab }: { plugin: PluginManifest; tab: WorkspaceTabDefinition }) {
  const viewRegistry = useViewRegistry();
  const currentUser = useAuthStore((state) => state.currentUser);
  const token = useAuthStore((state) => state.token);
  const agentBaseUrl = useResolvedAgentBaseUrl(
    plugin.origin === PluginOrigin.LOCAL && Boolean(currentUser && token)
  );
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
        return <MountedPluginTab mountTab={pluginTab} viewKey={tab.viewKey} />;
      }

      return null;

    case PluginOrigin.LOCAL:
      if (pluginTab && pluginTabHasMount(pluginTab) && tab.viewKey && agentBaseUrl) {
        return (
          <MountedPluginTab
            agentBaseUrl={agentBaseUrl}
            mountTab={pluginTab}
            viewKey={tab.viewKey}
          />
        );
      }

      return null;

    default:
      return null;
  }
}

export function WorkspaceContent({ activePlugin, tab }: WorkspaceContentProps) {
  const currentUser = useAuthStore((state) => state.currentUser);

  if (!tab || !activePlugin) {
    return (
      <Stack gap="sm" h="100%" justify="center">
        <Title order={3}>No workspace tab is open</Title>
        <Text c="dimmed">
          Select a menu item from the sidebar to open it in the workspace.
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
