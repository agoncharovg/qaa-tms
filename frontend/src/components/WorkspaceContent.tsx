import { useEffect, useRef } from "react";
import { Alert, Code, Stack, Text, Title } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";

import { createAgentHeaders } from "@/api/agentClient";
import type { WorkspaceTabDefinition } from "@/api/types";
import { ContentType, PluginOrigin } from "@/constants";
import { useBuiltinHostApi, type AgentAccess } from "@/core/plugins/host";
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

const UNAVAILABLE_AGENT_ACCESS: AgentAccess = {
  baseUrl: "",
  fetch() {
    return Promise.reject(
      new Error("MountContext.agent.fetch is unavailable because no companion agent is bound.")
    );
  },
};

function createAuthenticatedAgentAccess(agentBaseUrl: string, token: string): AgentAccess {
  const injectedHeaders = createAgentHeaders(token);
  const authorization = injectedHeaders.get("Authorization");
  const marker = injectedHeaders.get("X-QAA-TMS");

  return {
    baseUrl: agentBaseUrl,
    fetch(path, init) {
      const headers = createAgentHeaders(token, init?.headers);
      if (authorization) {
        headers.set("Authorization", authorization);
      }
      if (marker) {
        headers.set("X-QAA-TMS", marker);
      }

      return fetch(new URL(path, agentBaseUrl), {
        ...init,
        headers,
      });
    },
  };
}

function MountedPluginTab({
  agentBaseUrl,
  mountTab,
  token,
  viewKey,
}: {
  agentBaseUrl?: string;
  mountTab: PluginMountTab;
  token?: string | null;
  viewKey: PluginMountTab["viewKey"];
}) {
  const host = useBuiltinHostApi();
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const agent =
      agentBaseUrl && token
        ? createAuthenticatedAgentAccess(agentBaseUrl, token)
        : UNAVAILABLE_AGENT_ACCESS;

    return mountTab.mount({
      agent,
      agentBaseUrl,
      container,
      host,
      viewKey,
    });
  }, [agentBaseUrl, host, mountTab, token, viewKey]);

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
        return <MountedPluginTab mountTab={pluginTab} token={token} viewKey={tab.viewKey} />;
      }

      return null;

    case PluginOrigin.LOCAL:
      if (pluginTab && pluginTabHasMount(pluginTab) && tab.viewKey && agentBaseUrl) {
        return (
          <MountedPluginTab
            agentBaseUrl={agentBaseUrl}
            mountTab={pluginTab}
            token={token}
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
