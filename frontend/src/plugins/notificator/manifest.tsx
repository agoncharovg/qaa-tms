import {
  CONTRACT_VERSION,
  IconName,
  PluginId,
  PluginOrigin,
  TabId,
  TabTitle,
  ViewKey,
} from "@/constants";
import { definePlugin } from "@/core/plugins/definePlugin";
import { PluginKind } from "@/core/plugins/types";

import { NotificatorSection } from "@/plugins/notificator/NotificatorSection";

const NOTIFICATOR_PLUGIN_ORDER = 27 as const;
const NOTIFICATOR_PLUGIN_ROUTE = "/notificator" as const;

const notificatorPlugin = definePlugin({
  contractVersion: CONTRACT_VERSION,
  id: PluginId.NOTIFICATOR,
  icon: IconName.NOTIFICATOR,
  kind: PluginKind.OPTIONAL,
  label: "Notificator",
  origin: PluginOrigin.BUILTIN,
  order: NOTIFICATOR_PLUGIN_ORDER,
  requiresAgent: true,
  route: NOTIFICATOR_PLUGIN_ROUTE,
  tabs: [
    {
      id: TabId.NOTIFICATOR_NOTIFICATIONS,
      title: TabTitle[TabId.NOTIFICATOR_NOTIFICATIONS],
      viewKey: ViewKey.NOTIFICATOR_NOTIFICATIONS,
      element: <NotificatorSection mode={ViewKey.NOTIFICATOR_NOTIFICATIONS} />,
    },
    {
      id: TabId.NOTIFICATOR_TEAMS,
      title: TabTitle[TabId.NOTIFICATOR_TEAMS],
      viewKey: ViewKey.NOTIFICATOR_TEAMS,
      element: <NotificatorSection mode={ViewKey.NOTIFICATOR_TEAMS} />,
    },
    {
      id: TabId.NOTIFICATOR_PRODUCTS,
      title: TabTitle[TabId.NOTIFICATOR_PRODUCTS],
      viewKey: ViewKey.NOTIFICATOR_PRODUCTS,
      element: <NotificatorSection mode={ViewKey.NOTIFICATOR_PRODUCTS} />,
    },
    {
      id: TabId.NOTIFICATOR_SUB_PRODUCTS,
      title: TabTitle[TabId.NOTIFICATOR_SUB_PRODUCTS],
      viewKey: ViewKey.NOTIFICATOR_SUB_PRODUCTS,
      element: <NotificatorSection mode={ViewKey.NOTIFICATOR_SUB_PRODUCTS} />,
    },
    {
      id: TabId.NOTIFICATOR_SLACK_CHANNELS,
      title: TabTitle[TabId.NOTIFICATOR_SLACK_CHANNELS],
      viewKey: ViewKey.NOTIFICATOR_SLACK_CHANNELS,
      element: <NotificatorSection mode={ViewKey.NOTIFICATOR_SLACK_CHANNELS} />,
    },
    {
      id: TabId.NOTIFICATOR_USERS,
      title: TabTitle[TabId.NOTIFICATOR_USERS],
      viewKey: ViewKey.NOTIFICATOR_USERS,
      element: <NotificatorSection mode={ViewKey.NOTIFICATOR_USERS} />,
    },
    {
      id: TabId.NOTIFICATOR_QAA_MEMBERS,
      title: TabTitle[TabId.NOTIFICATOR_QAA_MEMBERS],
      viewKey: ViewKey.NOTIFICATOR_QAA_MEMBERS,
      element: <NotificatorSection mode={ViewKey.NOTIFICATOR_QAA_MEMBERS} />,
    },
    {
      id: TabId.NOTIFICATOR_FAILURE_MENTION_RULES,
      title: TabTitle[TabId.NOTIFICATOR_FAILURE_MENTION_RULES],
      viewKey: ViewKey.NOTIFICATOR_FAILURE_MENTION_RULES,
      element: <NotificatorSection mode={ViewKey.NOTIFICATOR_FAILURE_MENTION_RULES} />,
    },
    {
      id: TabId.NOTIFICATOR_EVENTS,
      title: TabTitle[TabId.NOTIFICATOR_EVENTS],
      viewKey: ViewKey.NOTIFICATOR_EVENTS,
      element: <NotificatorSection mode={ViewKey.NOTIFICATOR_EVENTS} />,
    },
    {
      id: TabId.NOTIFICATOR_RECURRENT_FAILS,
      title: TabTitle[TabId.NOTIFICATOR_RECURRENT_FAILS],
      viewKey: ViewKey.NOTIFICATOR_RECURRENT_FAILS,
      element: <NotificatorSection mode={ViewKey.NOTIFICATOR_RECURRENT_FAILS} />,
    },
    {
      id: TabId.NOTIFICATOR_FAIL_REASONS,
      title: TabTitle[TabId.NOTIFICATOR_FAIL_REASONS],
      viewKey: ViewKey.NOTIFICATOR_FAIL_REASONS,
      element: <NotificatorSection mode={ViewKey.NOTIFICATOR_FAIL_REASONS} />,
    },
    {
      id: TabId.NOTIFICATOR_MUTE_STATUSES,
      title: TabTitle[TabId.NOTIFICATOR_MUTE_STATUSES],
      viewKey: ViewKey.NOTIFICATOR_MUTE_STATUSES,
      element: <NotificatorSection mode={ViewKey.NOTIFICATOR_MUTE_STATUSES} />,
    },
    {
      id: TabId.NOTIFICATOR_HISTORY,
      title: TabTitle[TabId.NOTIFICATOR_HISTORY],
      viewKey: ViewKey.NOTIFICATOR_HISTORY,
      element: <NotificatorSection mode={ViewKey.NOTIFICATOR_HISTORY} />,
    },
  ],
});

export default notificatorPlugin;
