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
  IconChevronLeft,
  IconChevronRight,
  IconLogout,
  IconUserCircle,
} from "@tabler/icons-react";
import { useNavigate } from "react-router-dom";

import { RoutePath, type PluginId as PluginIdType } from "@/constants";
import { resolveIcon } from "@/core/plugins/icons";
import { enabledOptionalPluginIdSet, visiblePlugins } from "@/plugins/registry";
import { useAuthStore } from "@/store/authStore";
import { useUiStore } from "@/store/uiStore";

interface SidebarProps {
  activePluginId: PluginIdType;
}

export function Sidebar({ activePluginId }: SidebarProps) {
  const navigate = useNavigate();
  const currentUser = useAuthStore((state) => state.currentUser);
  const logout = useAuthStore((state) => state.logout);
  const sidebarCollapsed = useUiStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);

  const enabledOptionalIds = enabledOptionalPluginIdSet(currentUser?.enabled_plugins);
  const plugins = visiblePlugins(currentUser, enabledOptionalIds);

  return (
    <AppShell.Navbar p="sm">
      <Group justify={sidebarCollapsed ? "center" : "space-between"} mb="sm">
        {!sidebarCollapsed ? (
          <Box>
            <Text fw={700} size="lg">
              QAA-TMS
            </Text>
            <Text c="dimmed" size="sm">
              Test management shell
            </Text>
          </Box>
        ) : null}
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

      <Divider mb="sm" />

      <AppShell.Section grow>
        <Stack gap="xs">
          {plugins.map((plugin) => {
            const Icon = resolveIcon(plugin.icon);
            const item = (
              <UnstyledButton
                aria-current={activePluginId === plugin.id ? "page" : undefined}
                aria-label={plugin.label}
                key={plugin.id}
                onClick={() => navigate(plugin.route)}
                style={{
                  alignItems: "center",
                  backgroundColor:
                    activePluginId === plugin.id ? "rgba(34, 139, 230, 0.18)" : "transparent",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  borderRadius: "12px",
                  display: "flex",
                  gap: "12px",
                  justifyContent: sidebarCollapsed ? "center" : "flex-start",
                  padding: sidebarCollapsed ? "12px 10px" : "12px 14px",
                  transition: "background-color 150ms ease",
                }}
              >
                <Icon size={18} />
                {!sidebarCollapsed ? <Text fw={500}>{plugin.label}</Text> : null}
              </UnstyledButton>
            );

            return sidebarCollapsed ? (
              <Tooltip key={plugin.id} label={plugin.label} position="right">
                {item}
              </Tooltip>
            ) : (
              item
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
            border: "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: "12px",
            display: "flex",
            gap: "12px",
            justifyContent: sidebarCollapsed ? "center" : "flex-start",
            padding: sidebarCollapsed ? "12px 10px" : "12px 14px",
          }}
        >
          <IconLogout size={18} />
          {!sidebarCollapsed ? <Text fw={500}>Log out</Text> : null}
        </UnstyledButton>
      </Stack>
    </AppShell.Navbar>
  );
}
