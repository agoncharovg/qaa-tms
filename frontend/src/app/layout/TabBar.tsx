import {
  ActionIcon,
  AppShell,
  Button,
  Group,
  Menu,
  ScrollArea,
  Tabs,
  Text,
} from "@mantine/core";
import { IconPlus, IconX } from "@tabler/icons-react";

import {
  SectionLabel,
  type SectionKey as SectionKeyType,
  type TabId as TabIdType,
} from "@/constants";
import { SECTION_TAB_CATALOG, TAB_DEFINITIONS, getTabsForSection, useUiStore } from "@/store/uiStore";

interface TabBarProps {
  activeSection: SectionKeyType;
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

export function TabBar({ activeSection }: TabBarProps) {
  const closeTab = useUiStore((state) => state.closeTab);
  const openTab = useUiStore((state) => state.openTab);
  const switchTab = useUiStore((state) => state.switchTab);
  const tabsBySection = useUiStore((state) => state.tabsBySection);

  const currentSectionState = tabsBySection[activeSection];
  const openTabs = getTabsForSection(activeSection, tabsBySection);
  const availableTabIds = SECTION_TAB_CATALOG[activeSection];
  const closedTabIds = availableTabIds.filter((tabId) => !currentSectionState.tabIds.includes(tabId));

  return (
    <AppShell.Header px="md" py="sm">
      <Group h="100%" justify="space-between" wrap="nowrap">
        <ScrollArea scrollbarSize={4} w="100%">
          {openTabs.length > 0 ? (
            <Tabs
              onChange={(value) => {
                if (value) {
                  switchTab(activeSection, value as TabIdType);
                }
              }}
              styles={{
                list: {
                  gap: "8px",
                },
                tab: {
                  backgroundColor: "rgba(255, 255, 255, 0.04)",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  borderRadius: "12px 12px 0 0",
                  paddingInline: "14px",
                  paddingTop: "10px",
                },
              }}
              value={currentSectionState.activeTabId}
              variant="unstyled"
            >
              <Tabs.List>
                {openTabs.map((tab) => (
                  <Tabs.Tab key={tab.id} value={tab.id}>
                    <TabLabel
                      isCloseable={tab.closeable}
                      onClose={() => closeTab(activeSection, tab.id)}
                      title={tab.title}
                    />
                  </Tabs.Tab>
                ))}
              </Tabs.List>
            </Tabs>
          ) : (
            <Text c="dimmed" size="sm">
              No tabs open in {SectionLabel[activeSection]}.
            </Text>
          )}
        </ScrollArea>

        <Menu position="bottom-end" shadow="md" width={220}>
          <Menu.Target>
            <Button leftSection={<IconPlus size={16} />} variant="light">
              Open tab
            </Button>
          </Menu.Target>

          <Menu.Dropdown>
            {closedTabIds.length > 0 ? (
              closedTabIds.map((tabId) => (
                <Menu.Item key={tabId} onClick={() => openTab(activeSection, tabId)}>
                  {TAB_DEFINITIONS[tabId].title}
                </Menu.Item>
              ))
            ) : (
              <Menu.Item disabled>All tabs are already open</Menu.Item>
            )}
          </Menu.Dropdown>
        </Menu>
      </Group>
    </AppShell.Header>
  );
}
