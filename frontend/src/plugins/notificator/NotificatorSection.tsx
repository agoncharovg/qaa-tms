import { useEffect, useState, type ReactNode } from "react";
import { Stack, Tabs } from "@mantine/core";

import { ViewKey, type ViewKey as ViewKeyType } from "@/constants";
import {
  ProductsPanel,
  SlackChannelsPanel,
  SubProductsPanel,
} from "@/plugins/notificator/CrudPanels";
import { NotificationsPanel } from "@/plugins/notificator/NotificationsPanel";
import {
  EventsPanel,
  FailReasonsPanel,
  FailureMentionRulesPanel,
  HistoryPanel,
  QaaMembersPanel,
  RecurrentFailsPanel,
  TeamsPanel,
  UsersPanel,
} from "@/plugins/notificator/ReadOnlyPanels";

interface NotificatorInnerTab {
  label: string;
  render: () => ReactNode;
  value: string;
}

interface NotificatorSectionProps {
  mode: Extract<
    ViewKeyType,
    | typeof ViewKey.NOTIFICATOR_CONTRACT_MANAGER
    | typeof ViewKey.NOTIFICATOR_NOTIFICATIONS
  >;
}

export function NotificatorSection({ mode }: NotificatorSectionProps) {
  const innerTabs: NotificatorInnerTab[] =
    mode === ViewKey.NOTIFICATOR_CONTRACT_MANAGER
      ? [
          {
            value: "failure-mention-rules",
            label: "Failure Mention Rules",
            render: () => <FailureMentionRulesPanel />,
          },
          {
            value: "notifications",
            label: "Notifications",
            render: () => <NotificationsPanel />,
          },
          {
            value: "products",
            label: "Products",
            render: () => <ProductsPanel />,
          },
          {
            value: "qaa-members",
            label: "QAA Members",
            render: () => <QaaMembersPanel />,
          },
          {
            value: "slack-channels",
            label: "Slack Channels",
            render: () => <SlackChannelsPanel />,
          },
          {
            value: "sub-products",
            label: "Sub-products",
            render: () => <SubProductsPanel />,
          },
          {
            value: "teams",
            label: "Teams",
            render: () => <TeamsPanel />,
          },
          {
            value: "users",
            label: "Users",
            render: () => <UsersPanel />,
          },
        ]
      : [
          {
            value: "events",
            label: "Events",
            render: () => <EventsPanel />,
          },
          {
            value: "fail-reasons",
            label: "Fail reasons",
            render: () => <FailReasonsPanel />,
          },
          {
            value: "history",
            label: "History",
            render: () => <HistoryPanel />,
          },
          {
            value: "recurrent-fail-notifications",
            label: "Recurrent fail notifications",
            render: () => <RecurrentFailsPanel />,
          },
        ];
  const defaultTab = innerTabs[0]?.value ?? null;
  const [activeTab, setActiveTab] = useState<string | null>(defaultTab);

  useEffect(() => {
    setActiveTab(defaultTab);
  }, [defaultTab]);

  const activeSection = innerTabs.find((tab) => tab.value === activeTab) ?? innerTabs[0];

  if (!activeSection) {
    return null;
  }

  return (
    <Stack gap="md">
      <Tabs
        onChange={(value) => {
          if (!value) {
            return;
          }

          setActiveTab(value);
        }}
        value={activeSection.value}
      >
        <Tabs.List>
          {innerTabs.map((tab) => (
            <Tabs.Tab key={tab.value} value={tab.value}>
              {tab.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs>
      {activeSection.render()}
    </Stack>
  );
}
