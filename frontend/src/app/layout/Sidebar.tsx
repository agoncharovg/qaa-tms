import {
  ActionIcon,
  AppShell,
  Box,
  Divider,
  Group,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import {
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconLogout,
  IconMoon,
  IconSun,
  IconUserCircle,
} from "@tabler/icons-react";
import type { CSSProperties } from "react";
import { useNavigate } from "react-router-dom";

import { usePalette } from "@/app/theme/usePalette";
import type { Palette } from "@/app/theme/tokens";
import { RoutePath, type PluginId as PluginIdType } from "@/constants";
import { resolveIcon } from "@/core/plugins/icons";
import { enabledOptionalPluginIdSet, visiblePlugins, visibleTabs } from "@/plugins/registry";
import { useAuthStore } from "@/store/authStore";
import { activatePluginWorkspaceTab, useUiStore } from "@/store/uiStore";

interface SidebarProps {
  activePluginId: PluginIdType;
}

function buildItemButtonStyle(active: boolean, collapsed: boolean, palette: Palette): CSSProperties {
  return {
    alignItems: "center",
    backgroundColor: active ? palette.chip : "transparent",
    border: "1px solid transparent",
    borderRadius: "10px",
    color: active ? palette.accent : palette.inkSoft,
    display: "flex",
    gap: "12px",
    justifyContent: collapsed ? "center" : "flex-start",
    padding: collapsed ? "10px 10px" : "10px 12px",
    transition: "background-color 150ms ease, color 150ms ease",
    width: "100%",
  };
}

function buildTabButtonStyle(active: boolean, open: boolean, palette: Palette): CSSProperties {
  return {
    alignItems: "center",
    backgroundColor: active ? palette.accentSoft : open ? palette.chip : "transparent",
    border: "1px solid transparent",
    borderRadius: "8px",
    color: active ? palette.accent : palette.inkSoft,
    display: "flex",
    justifyContent: "space-between",
    padding: "8px 10px",
    transition: "background-color 150ms ease, color 150ms ease",
    width: "100%",
  };
}

export function Sidebar({ activePluginId }: SidebarProps) {
  const navigate = useNavigate();
  const palette = usePalette();
  const currentUser = useAuthStore((state) => state.currentUser);
  const logout = useAuthStore((state) => state.logout);
  const sidebarCollapsed = useUiStore((state) => state.sidebarCollapsed);
  const tabsByPlugin = useUiStore((state) => state.tabsByPlugin);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  const toggleColorScheme = useUiStore((state) => state.toggleColorScheme);
  const colorScheme = useUiStore((state) => state.colorScheme);
  const openTab = useUiStore((state) => state.openTab);

  const enabledOptionalIds = enabledOptionalPluginIdSet(currentUser?.enabled_plugins);
  const plugins = visiblePlugins(currentUser, enabledOptionalIds);

  return (
    <AppShell.Navbar
      p="sm"
      style={{ backgroundColor: palette.surface, borderRight: `1px solid ${palette.line}` }}
    >
      <Group justify={sidebarCollapsed ? "center" : "space-between"} mb="sm" wrap="nowrap">
        {!sidebarCollapsed ? (
          <Group gap="xs" wrap="nowrap">
            <Box
              style={{
                alignItems: "center",
                backgroundColor: palette.accent,
                borderRadius: "8px",
                color: "#fff",
                display: "flex",
                fontSize: "16px",
                fontWeight: 800,
                height: "28px",
                justifyContent: "center",
                width: "28px",
              }}
            >
              Q
            </Box>
            <Text c={palette.ink} fw={800} size="lg">
              QAA-TMS
            </Text>
          </Group>
        ) : null}
        <Group
          gap={4}
          wrap="nowrap"
          style={{ flexDirection: sidebarCollapsed ? "column" : "row" }}
        >
          <Tooltip label={colorScheme === "dark" ? "Light theme" : "Dark theme"}>
            <ActionIcon
              aria-label={colorScheme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              color="gray"
              onClick={toggleColorScheme}
              radius="md"
              size="lg"
              variant="subtle"
            >
              {colorScheme === "dark" ? <IconSun size={18} /> : <IconMoon size={18} />}
            </ActionIcon>
          </Tooltip>
          <Tooltip label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}>
            <ActionIcon
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              color="gray"
              onClick={toggleSidebar}
              radius="md"
              size="lg"
              variant="subtle"
            >
              {sidebarCollapsed ? <IconChevronRight size={18} /> : <IconChevronLeft size={18} />}
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      <Divider mb="sm" />

      <AppShell.Section grow>
        <Stack gap="xs">
          {plugins.map((plugin) => {
            const Icon = resolveIcon(plugin.icon);
            const isActivePlugin = activePluginId === plugin.id;
            const pluginTabs = visibleTabs(plugin, currentUser);
            const pluginState = tabsByPlugin[plugin.id];
            const item = (
              <UnstyledButton
                aria-current={isActivePlugin ? "page" : undefined}
                aria-label={plugin.label}
                key={plugin.id}
                onClick={() => {
                  activatePluginWorkspaceTab(plugin.id);
                  navigate(plugin.route);
                }}
                style={buildItemButtonStyle(isActivePlugin, sidebarCollapsed, palette)}
              >
                <Icon size={18} />
                {!sidebarCollapsed ? (
                  <>
                    <Text c="inherit" fw={isActivePlugin ? 600 : 500}>
                      {plugin.label}
                    </Text>
                    <Box ml="auto">
                      <IconChevronDown
                        size={16}
                        style={{
                          opacity: isActivePlugin && pluginTabs.length > 0 ? 0.9 : 0.35,
                          transform:
                            isActivePlugin && pluginTabs.length > 0 ? "rotate(0deg)" : "rotate(-90deg)",
                          transition: "transform 150ms ease, opacity 150ms ease",
                        }}
                      />
                    </Box>
                  </>
                ) : null}
              </UnstyledButton>
            );

            return (
              <Box key={plugin.id}>
                {sidebarCollapsed ? (
                  <Tooltip label={plugin.label} position="right">
                    {item}
                  </Tooltip>
                ) : (
                  item
                )}

                {!sidebarCollapsed && isActivePlugin && pluginTabs.length > 0 ? (
                  <Box
                    ml="md"
                    mt="xs"
                    pl="md"
                    style={{ borderLeft: `1px solid ${palette.line}` }}
                  >
                    <Stack gap={6}>
                      {pluginTabs.map((tab) => {
                        const isActiveTab = pluginState.activeTabId === tab.id;
                        const isOpenTab = pluginState.tabIds.includes(tab.id);

                        return (
                          <UnstyledButton
                            aria-current={isActiveTab ? "page" : undefined}
                            aria-label={tab.title}
                            key={tab.id}
                            onClick={() => {
                              openTab(plugin.id, tab.id);
                              navigate(plugin.route);
                            }}
                            style={buildTabButtonStyle(isActiveTab, isOpenTab, palette)}
                          >
                            <Group gap="xs" wrap="nowrap">
                              <Box
                                aria-hidden="true"
                                h={6}
                                style={{
                                  borderRadius: "999px",
                                  backgroundColor: isActiveTab
                                    ? palette.accent
                                    : isOpenTab
                                      ? palette.dim
                                      : palette.faint,
                                  flexShrink: 0,
                                }}
                                w={6}
                              />
                              <Text c="inherit" fw={isActiveTab ? 600 : 500} size="sm">
                                {tab.title}
                              </Text>
                            </Group>
                            {isOpenTab ? (
                              <Text c={palette.faint} size="xs">
                                Open
                              </Text>
                            ) : null}
                          </UnstyledButton>
                        );
                      })}
                    </Stack>
                  </Box>
                ) : null}
              </Box>
            );
          })}
        </Stack>
      </AppShell.Section>

      <Divider my="sm" />

      <Stack gap="xs">
        <Group justify={sidebarCollapsed ? "center" : "flex-start"} wrap="nowrap">
          <IconUserCircle size={18} />
          {!sidebarCollapsed ? (
            <Box>
              <Text fw={500} size="sm">
                {currentUser?.display_name ?? "Unknown user"}
              </Text>
              <Text c="dimmed" size="xs">
                @{currentUser?.username ?? "guest"}
              </Text>
            </Box>
          ) : null}
        </Group>

        <UnstyledButton
          aria-label="Log out"
          onClick={() => {
            logout();
            navigate(RoutePath.LOGIN, { replace: true });
          }}
          style={{
            alignItems: "center",
            border: `1px solid ${palette.line}`,
            borderRadius: "10px",
            color: palette.inkSoft,
            display: "flex",
            gap: "12px",
            justifyContent: sidebarCollapsed ? "center" : "flex-start",
            padding: sidebarCollapsed ? "10px 10px" : "10px 12px",
          }}
        >
          <IconLogout size={18} />
          {!sidebarCollapsed ? <Text fw={500}>Log out</Text> : null}
        </UnstyledButton>
      </Stack>
    </AppShell.Navbar>
  );
}
