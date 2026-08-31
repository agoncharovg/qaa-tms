import {
  ActionIcon,
  Anchor,
  AppShell,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  Indicator,
  Menu,
  Modal,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconLogout,
  IconMoon,
  IconSun,
  IconUserCircle,
} from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";

import { usePalette } from "@/app/theme/usePalette";
import type { Palette } from "@/app/theme/tokens";
import type { NotebookReminder } from "@/api/types";
import { PluginId, RoutePath, type PluginId as PluginIdType } from "@/constants";
import { resolveIcon } from "@/core/plugins/icons";
import { useNotebookNavStore } from "@/plugins/notebook/notebookNavStore";
import {
  accountVisiblePlugins,
  enabledOptionalPluginIdSet,
  pluginById,
  primaryVisiblePlugins,
  visibleTabs,
} from "@/plugins/registry";
import { useAuthStore } from "@/store/authStore";
import { activatePluginWorkspaceTab, useUiStore } from "@/store/uiStore";
import { formatReminder, useNotebookReminders } from "@/plugins/notebook/reminders";

interface SidebarProps {
  activePluginId: PluginIdType;
}

const SidebarCopy = {
  ACCOUNT_MENU: "Account menu",
  CANCEL: "Cancel",
  COLLAPSE: "Collapse sidebar",
  CONFIRM_LOGOUT: "Log out",
  EXPAND: "Expand sidebar",
  LIGHT_THEME: "Light theme",
  LOGOUT_BODY: "You'll need to sign in again to continue.",
  LOGOUT_TITLE: "Log out",
  PROFILE: "Profile",
  SWITCH_TO_DARK: "Switch to dark theme",
  SWITCH_TO_LIGHT: "Switch to light theme",
  UNKNOWN_USER: "Unknown user",
} as const;

function sortPluginsByLabel<T extends { id: string; label: string }>(plugins: readonly T[]): T[] {
  return [...plugins].sort(
    (left, right) =>
      left.label.localeCompare(right.label, undefined, { sensitivity: "base" }) ||
      left.id.localeCompare(right.id)
  );
}

function sortTabsByTitle<T extends { id: string; title: string }>(tabs: readonly T[]): T[] {
  return [...tabs].sort(
    (left, right) =>
      left.title.localeCompare(right.title, undefined, { sensitivity: "base" }) ||
      left.id.localeCompare(right.id)
  );
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

function buildTabButtonStyle(active: boolean, palette: Palette): CSSProperties {
  return {
    alignItems: "center",
    backgroundColor: active ? palette.accentSoft : "transparent",
    border: "1px solid transparent",
    borderRadius: "8px",
    color: active ? palette.accent : palette.inkSoft,
    display: "flex",
    justifyContent: "flex-start",
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
  const requestNotebookNote = useNotebookNavStore((state) => state.requestNotebookNote);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [logoutConfirmOpened, logoutConfirm] = useDisclosure(false);

  const enabledOptionalIds = enabledOptionalPluginIdSet(currentUser?.enabled_plugins);
  const plugins = sortPluginsByLabel(primaryVisiblePlugins(currentUser, enabledOptionalIds));
  const accountPlugins = accountVisiblePlugins(currentUser, enabledOptionalIds);
  const profilePlugin = pluginById(PluginId.PROFILE);
  const hasVisibleNotebook = plugins.some((plugin) => plugin.id === PluginId.NOTEBOOK);
  const notebookReminders = useNotebookReminders(hasVisibleNotebook);
  const shownReminderKeysRef = useRef(new Set<string>());
  const dueReminderCount = notebookReminders.dueReminders.length;

  const openReminderNote = useCallback(
    (reminder: NotebookReminder): void => {
      requestNotebookNote({ bookmark: reminder.bookmark, name: reminder.name });
      activatePluginWorkspaceTab(PluginId.NOTEBOOK);
      const notebookPlugin = pluginById(PluginId.NOTEBOOK);
      if (notebookPlugin) {
        navigate(notebookPlugin.route);
      }
    },
    [navigate, requestNotebookNote]
  );

  useEffect(() => {
    if (!hasVisibleNotebook) {
      shownReminderKeysRef.current.clear();
      return;
    }

    const visibleKeys = new Set<string>();
    for (const reminder of notebookReminders.dueReminders) {
      const reminderKey = [reminder.bookmark, reminder.name, reminder.remindAt].join("::");
      visibleKeys.add(reminderKey);
      if (!shownReminderKeysRef.current.has(reminderKey)) {
        notifications.show({
          autoClose: false,
          message: (
            <Text size="sm">
              {reminder.bookmark + " • " + formatReminder(reminder.remindAt) + ". "}
              <Anchor
                component="button"
                onClick={() => openReminderNote(reminder)}
                type="button"
              >
                Откройте
              </Anchor>
              {" Notebook, чтобы закрыть."}
            </Text>
          ),
          title: reminder.name,
        });
      }
    }
    shownReminderKeysRef.current = visibleKeys;
  }, [hasVisibleNotebook, notebookReminders.dueReminders, openReminderNote]);

  function openProfile(): void {
    if (!profilePlugin || !accountPlugins.some((plugin) => plugin.id === profilePlugin.id)) {
      return;
    }

    setAccountMenuOpen(false);
    activatePluginWorkspaceTab(profilePlugin.id);
    navigate(profilePlugin.route);
  }

  function confirmLogout(): void {
    setAccountMenuOpen(false);
    logoutConfirm.open();
  }

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
              aria-label={
                colorScheme === "dark"
                  ? SidebarCopy.SWITCH_TO_LIGHT
                  : SidebarCopy.SWITCH_TO_DARK
              }
              color="gray"
              onClick={toggleColorScheme}
              radius="md"
              size="lg"
              variant="subtle"
            >
              {colorScheme === "dark" ? <IconSun size={18} /> : <IconMoon size={18} />}
            </ActionIcon>
          </Tooltip>
          <Tooltip label={sidebarCollapsed ? SidebarCopy.EXPAND : SidebarCopy.COLLAPSE}>
            <ActionIcon
              aria-label={sidebarCollapsed ? SidebarCopy.EXPAND : SidebarCopy.COLLAPSE}
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
            const pluginTabs = sortTabsByTitle(visibleTabs(plugin, currentUser));
            const pluginState = tabsByPlugin[plugin.id];
            const notebookBadgeCount = plugin.id === PluginId.NOTEBOOK ? dueReminderCount : 0;
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
                {notebookBadgeCount > 0 ? <Indicator color="red" label={notebookBadgeCount} size={16}><Icon size={18} /></Indicator> : <Icon size={18} />}
                {!sidebarCollapsed ? (
                  <>
                    <Text c="inherit" fw={isActivePlugin ? 600 : 500}>
                      {plugin.label}
                    </Text>
                    {notebookBadgeCount > 0 ? <Badge color="red" size="sm" variant="filled">{notebookBadgeCount}</Badge> : null}
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

                        return (
                          <UnstyledButton
                            aria-current={isActiveTab ? "page" : undefined}
                            aria-label={tab.title}
                            key={tab.id}
                            onClick={() => {
                              openTab(plugin.id, tab.id);
                              navigate(plugin.route);
                            }}
                            style={buildTabButtonStyle(isActiveTab, palette)}
                          >
                            <Group gap="xs" wrap="nowrap">
                              <Box
                                aria-hidden="true"
                                h={6}
                                style={{
                                  borderRadius: "999px",
                                  backgroundColor: isActiveTab ? palette.accent : palette.faint,
                                  flexShrink: 0,
                                }}
                                w={6}
                              />
                              <Text c="inherit" fw={isActiveTab ? 600 : 500} size="sm">
                                {tab.title}
                              </Text>
                            </Group>
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
        {sidebarCollapsed ? (
          <Menu position="right-start" shadow="md" width={180} withinPortal={false}>
            <Menu.Target>
              <UnstyledButton
                aria-label={SidebarCopy.ACCOUNT_MENU}
                style={buildItemButtonStyle(activePluginId === PluginId.PROFILE, true, palette)}
              >
                <IconUserCircle size={18} />
              </UnstyledButton>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item leftSection={<IconUserCircle size={16} />} onClick={openProfile}>
                {SidebarCopy.PROFILE}
              </Menu.Item>
              <Menu.Item color="red" leftSection={<IconLogout size={16} />} onClick={confirmLogout}>
                {SidebarCopy.CONFIRM_LOGOUT}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        ) : (
          <>
            <UnstyledButton
              aria-label={SidebarCopy.ACCOUNT_MENU}
              onClick={() => setAccountMenuOpen((currentValue) => !currentValue)}
              style={buildItemButtonStyle(activePluginId === PluginId.PROFILE, false, palette)}
            >
              <IconUserCircle size={18} />
              <Box>
                <Text c="inherit" fw={500} size="sm">
                  {currentUser?.display_name ?? SidebarCopy.UNKNOWN_USER}
                </Text>
                <Text c={palette.faint} size="xs">
                  @{currentUser?.username ?? "guest"}
                </Text>
              </Box>
              <Box ml="auto">
                <IconChevronDown
                  size={16}
                  style={{
                    opacity: 0.8,
                    transform: accountMenuOpen ? "rotate(0deg)" : "rotate(-90deg)",
                    transition: "transform 150ms ease, opacity 150ms ease",
                  }}
                />
              </Box>
            </UnstyledButton>

            {accountMenuOpen ? (
              <Box ml="md" pl="md" style={{ borderLeft: `1px solid ${palette.line}` }}>
                <Stack gap={6}>
                  <UnstyledButton
                    aria-current={activePluginId === PluginId.PROFILE ? "page" : undefined}
                    aria-label={SidebarCopy.PROFILE}
                    onClick={openProfile}
                    style={buildTabButtonStyle(activePluginId === PluginId.PROFILE, palette)}
                  >
                    <Group gap="xs" wrap="nowrap">
                      <Box
                        aria-hidden="true"
                        h={6}
                        style={{
                          borderRadius: "999px",
                          backgroundColor:
                            activePluginId === PluginId.PROFILE ? palette.accent : palette.faint,
                          flexShrink: 0,
                        }}
                        w={6}
                      />
                      <Text c="inherit" fw={activePluginId === PluginId.PROFILE ? 600 : 500} size="sm">
                        {SidebarCopy.PROFILE}
                      </Text>
                    </Group>
                  </UnstyledButton>
                  <UnstyledButton
                    aria-label={SidebarCopy.CONFIRM_LOGOUT}
                    onClick={confirmLogout}
                    style={buildTabButtonStyle(false, palette)}
                  >
                    <Group gap="xs" wrap="nowrap">
                      <Box
                        aria-hidden="true"
                        h={6}
                        style={{
                          borderRadius: "999px",
                          backgroundColor: palette.faint,
                          flexShrink: 0,
                        }}
                        w={6}
                      />
                      <Text c="inherit" fw={500} size="sm">
                        {SidebarCopy.CONFIRM_LOGOUT}
                      </Text>
                    </Group>
                  </UnstyledButton>
                </Stack>
              </Box>
            ) : null}
          </>
        )}
      </Stack>

      <Modal
        centered
        onClose={logoutConfirm.close}
        opened={logoutConfirmOpened}
        title={SidebarCopy.LOGOUT_TITLE}
      >
        <Stack gap="md">
          <Text>{SidebarCopy.LOGOUT_BODY}</Text>
          <Group justify="flex-end">
            <Button onClick={logoutConfirm.close} variant="default">
              {SidebarCopy.CANCEL}
            </Button>
            <Button
              color="red"
              onClick={() => {
                logoutConfirm.close();
                logout();
                navigate(RoutePath.LOGIN, { replace: true });
              }}
            >
              {SidebarCopy.CONFIRM_LOGOUT}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </AppShell.Navbar>
  );
}
