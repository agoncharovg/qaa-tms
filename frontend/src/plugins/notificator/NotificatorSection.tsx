import { CompanionGate } from "@/plugins/companion/CompanionGate";
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
  MuteStatusesPanel,
  QaaMembersPanel,
  RecurrentFailsPanel,
  TeamsPanel,
  UsersPanel,
} from "@/plugins/notificator/ReadOnlyPanels";
import { useAuthStore } from "@/store/authStore";

interface NotificatorSectionProps {
  mode: Extract<
    ViewKeyType,
    | typeof ViewKey.NOTIFICATOR_NOTIFICATIONS
    | typeof ViewKey.NOTIFICATOR_TEAMS
    | typeof ViewKey.NOTIFICATOR_PRODUCTS
    | typeof ViewKey.NOTIFICATOR_SUB_PRODUCTS
    | typeof ViewKey.NOTIFICATOR_SLACK_CHANNELS
    | typeof ViewKey.NOTIFICATOR_USERS
    | typeof ViewKey.NOTIFICATOR_QAA_MEMBERS
    | typeof ViewKey.NOTIFICATOR_FAILURE_MENTION_RULES
    | typeof ViewKey.NOTIFICATOR_EVENTS
    | typeof ViewKey.NOTIFICATOR_RECURRENT_FAILS
    | typeof ViewKey.NOTIFICATOR_FAIL_REASONS
    | typeof ViewKey.NOTIFICATOR_MUTE_STATUSES
    | typeof ViewKey.NOTIFICATOR_HISTORY
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
  if (mode === ViewKey.NOTIFICATOR_TEAMS) {
    return <TeamsPanel agentPort={port} />;
  }

  if (mode === ViewKey.NOTIFICATOR_PRODUCTS) {
    return <ProductsPanel agentPort={port} />;
  }

  if (mode === ViewKey.NOTIFICATOR_SUB_PRODUCTS) {
    return <SubProductsPanel agentPort={port} />;
  }

  if (mode === ViewKey.NOTIFICATOR_SLACK_CHANNELS) {
    return <SlackChannelsPanel agentPort={port} />;
  }

  if (mode === ViewKey.NOTIFICATOR_USERS) {
    return <UsersPanel agentPort={port} />;
  }

  if (mode === ViewKey.NOTIFICATOR_QAA_MEMBERS) {
    return <QaaMembersPanel agentPort={port} />;
  }

  if (mode === ViewKey.NOTIFICATOR_FAILURE_MENTION_RULES) {
    return <FailureMentionRulesPanel agentPort={port} />;
  }

  if (mode === ViewKey.NOTIFICATOR_EVENTS) {
    return <EventsPanel agentPort={port} />;
  }

  if (mode === ViewKey.NOTIFICATOR_RECURRENT_FAILS) {
    return <RecurrentFailsPanel agentPort={port} />;
  }

  if (mode === ViewKey.NOTIFICATOR_FAIL_REASONS) {
    return <FailReasonsPanel agentPort={port} />;
  }

  if (mode === ViewKey.NOTIFICATOR_MUTE_STATUSES) {
    return <MuteStatusesPanel agentPort={port} />;
  }

  if (mode === ViewKey.NOTIFICATOR_HISTORY) {
    return <HistoryPanel agentPort={port} />;
  }

  return <NotificationsPanel agentPort={port} />;
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
