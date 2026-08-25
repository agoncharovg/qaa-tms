import { useEffect, useState, type ReactNode } from "react";
import { Stack, Tabs } from "@mantine/core";

import { ViewKey, type ViewKey as ViewKeyType } from "@/constants";
import { CompanionGate } from "@/plugins/companion/CompanionGate";
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
import { useAuthStore } from "@/store/authStore";

interface NotificatorInnerTab {
  label: string;
  render: (port: number) => ReactNode;
  value: string;
}

interface NotificatorSectionProps {
  mode: Extract<
    ViewKeyType,
    | typeof ViewKey.NOTIFICATOR_CONTRACT_MANAGER
    | typeof ViewKey.NOTIFICATOR_NOTIFICATIONS
  >;
}

const NOTIFICATOR_SECTION_COPY = {
  AGENT_ERROR: "Notificator companion discovery failed",
  AGENT_LOADING: "Checking the local companion app before loading Notificator.",
} as const;

function NotificatorAgentSection({
  mode,
  port,
}: {
  mode: NotificatorSectionProps["mode"];
  port: number;
}) {
  const innerTabs: NotificatorInnerTab[] =
    mode === ViewKey.NOTIFICATOR_CONTRACT_MANAGER
      ? [
          {
            value: "failure-mention-rules",
            label: "Failure Mention Rules",
            render: (agentPort) => <FailureMentionRulesPanel agentPort={agentPort} />,
          },
          {
            value: "notifications",
            label: "Notifications",
            render: (agentPort) => <NotificationsPanel agentPort={agentPort} />,
          },
          {
            value: "products",
            label: "Products",
            render: (agentPort) => <ProductsPanel agentPort={agentPort} />,
          },
          {
            value: "qaa-members",
            label: "QAA Members",
            render: (agentPort) => <QaaMembersPanel agentPort={agentPort} />,
          },
          {
            value: "slack-channels",
            label: "Slack Channels",
            render: (agentPort) => <SlackChannelsPanel agentPort={agentPort} />,
          },
          {
            value: "sub-products",
            label: "Sub-products",
            render: (agentPort) => <SubProductsPanel agentPort={agentPort} />,
          },
          {
            value: "teams",
            label: "Teams",
            render: (agentPort) => <TeamsPanel agentPort={agentPort} />,
          },
          {
            value: "users",
            label: "Users",
            render: (agentPort) => <UsersPanel agentPort={agentPort} />,
          },
        ]
      : [
          {
            value: "events",
            label: "Events",
            render: (agentPort) => <EventsPanel agentPort={agentPort} />,
          },
          {
            value: "fail-reasons",
            label: "Fail reasons",
            render: (agentPort) => <FailReasonsPanel agentPort={agentPort} />,
          },
          {
            value: "history",
            label: "History",
            render: (agentPort) => <HistoryPanel agentPort={agentPort} />,
          },
          {
            value: "recurrent-fail-notifications",
            label: "Recurrent fail notifications",
            render: (agentPort) => <RecurrentFailsPanel agentPort={agentPort} />,
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
      {activeSection.render(port)}
    </Stack>
  );
}

export function NotificatorSection({ mode }: NotificatorSectionProps) {
  const token = useAuthStore((state) => state.token);

  return (
    <CompanionGate
      enabled={Boolean(token)}
      errorTitle={NOTIFICATOR_SECTION_COPY.AGENT_ERROR}
      loadingMessage={NOTIFICATOR_SECTION_COPY.AGENT_LOADING}
    >
      {({ agentPort }) => <NotificatorAgentSection mode={mode} port={agentPort} />}
    </CompanionGate>
  );
}

