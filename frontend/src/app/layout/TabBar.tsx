import {
  ActionIcon,
  AppShell,
  Group,
  ScrollArea,
  Tabs,
  Text,
} from "@mantine/core";
import { IconX } from "@tabler/icons-react";
import { useNavigate } from "react-router-dom";

import { usePalette } from "@/app/theme/usePalette";
import { type PluginId as PluginIdType, type TabId as TabIdType } from "@/constants";
import { pluginById } from "@/plugins/registry";
import { useAuthStore } from "@/store/authStore";
import { getOpenWorkspaceTabs, useUiStore } from "@/store/uiStore";

interface TabBarProps {
  activePluginId?: PluginIdType;
}

function TabLabel({
  isCloseable,
  onClose,
  title,
}: {
  isCloseable: boolean;
  onClose: () => void;
  title: string;
}) {
  return (
    <Group gap={6} wrap="nowrap">
      <Text fw={500} size="sm">
        {title}
      </Text>
      {isCloseable ? (
        <ActionIcon
          aria-label={`Close ${title} tab`}
          color="gray"
          component="span"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }}
          radius="xl"
          size="sm"
          variant="subtle"
        >
          <IconX size={12} />
        </ActionIcon>
      ) : null}
    </Group>
  );
}

export function TabBar(_: TabBarProps) {
  const navigate = useNavigate();
  const palette = usePalette();
  const currentUser = useAuthStore((state) => state.currentUser);
  const activeWorkspaceTabId = useUiStore((state) => state.activeWorkspaceTabId);
  const closeTab = useUiStore((state) => state.closeTab);
  const switchTab = useUiStore((state) => state.switchTab);
  const workspaceTabIds = useUiStore((state) => state.workspaceTabIds);

  const openTabs = getOpenWorkspaceTabs(workspaceTabIds).filter((tab) => {
    const plugin = pluginById(tab.pluginId);
    if (!plugin) {
      return false;
    }

    return plugin.tabs.some(
      (pluginTab) => pluginTab.id === tab.id && (!pluginTab.adminOnly || Boolean(currentUser?.is_admin))
    );
  });

  return (
    <AppShell.Header
      px="md"
      py="sm"
      style={{ backgroundColor: palette.surface, borderBottom: `1px solid ${palette.line}` }}
    >
      <Group h="100%" justify="space-between" wrap="nowrap">
        <ScrollArea scrollbarSize={4} w="100%">
          {openTabs.length > 0 ? (
            <Tabs
              onChange={(value) => {
                if (!value) {
                  return;
                }

                const nextTab = openTabs.find((tab) => tab.id === value);
                if (!nextTab) {
                  return;
                }

                switchTab(nextTab.pluginId, value as TabIdType);
                const plugin = pluginById(nextTab.pluginId);
                if (plugin) {
                  navigate(plugin.route);
                }
              }}
              styles={{
                list: {
                  gap: "8px",
                },
                tab: {
                  borderRadius: "10px",
                  paddingBlock: "6px",
                  paddingInline: "14px",
                },
                tabLabel: {
                  fontWeight: 600,
                },
              }}
              value={activeWorkspaceTabId}
              variant="unstyled"
            >
              <Tabs.List>
                {openTabs.map((tab) => {
                  const isActive = tab.id === activeWorkspaceTabId;
                  return (
                  <Tabs.Tab
                    key={tab.id}
                    value={tab.id}
                    style={{
                      backgroundColor: isActive ? palette.accentSoft : palette.chip,
                      border: `1px solid ${isActive ? palette.accent : palette.line}`,
                      color: isActive ? palette.accent : palette.inkSoft,
                    }}
                  >
                    <TabLabel
                      isCloseable={tab.closeable}
                      onClose={() => {
                        closeTab(tab.pluginId, tab.id);
                        const nextActiveTabId = useUiStore.getState().activeWorkspaceTabId;
                        if (!nextActiveTabId) {
                          return;
                        }

                        const nextTab = getOpenWorkspaceTabs(useUiStore.getState().workspaceTabIds).find(
                          (candidate) => candidate.id === nextActiveTabId
                        );
                        const plugin = pluginById(nextTab?.pluginId);
                        if (plugin) {
                          navigate(plugin.route);
                        }
                      }}
                      title={tab.title}
                    />
                  </Tabs.Tab>
                  );
                })}
              </Tabs.List>
            </Tabs>
          ) : (
            <Text c="dimmed" size="sm">
              No workspace tabs are open. Select a menu item from the sidebar.
            </Text>
          )}
        </ScrollArea>
      </Group>
    </AppShell.Header>
  );
}
