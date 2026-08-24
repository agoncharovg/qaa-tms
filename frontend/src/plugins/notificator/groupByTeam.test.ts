import { describe, expect, it } from "vitest";

import type { NotificatorNotificationConfig } from "@/api/types";
import { groupNotificationConfigsByTeam } from "@/plugins/notificator/groupByTeam";

const configs: NotificatorNotificationConfig[] = [
  {
    id: 2,
    product_team_id: 10,
    product_team: "platform",
    notification_type: "FAILED_PIPELINE",
    notification_type_label: "Failed pipeline",
    enabled: false,
    channels: [{ id: 2, channel_id: "C2", description: "ops" }],
    users: [],
  },
  {
    id: 1,
    product_team_id: 10,
    product_team: "platform",
    notification_type: "NEW_JIRA_TICKET",
    notification_type_label: "New JIRA ticket",
    enabled: true,
    channels: [
      { id: 1, channel_id: "C1", description: "alerts" },
      { id: 2, channel_id: "C2", description: "ops" },
    ],
    users: [{ id: 1, sam_account_name: "jdoe", user_principal_name: "jdoe@gcore.com" }],
  },
  {
    id: 3,
    product_team_id: 5,
    product_team: "alpha",
    notification_type: "NEW_JIRA_TICKET",
    notification_type_label: "New JIRA ticket",
    enabled: true,
    channels: [],
    users: [],
  },
];

describe("groupNotificationConfigsByTeam", () => {
  it("groups configs into one row per team with counts and sorted items", () => {
    const result = groupNotificationConfigsByTeam(configs);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      teamId: 5,
      teamName: "alpha",
      totalNotifications: 1,
      enabledCount: 1,
      distinctChannelCount: 0,
    });
    expect(result[1]).toMatchObject({
      teamId: 10,
      teamName: "platform",
      totalNotifications: 2,
      enabledCount: 1,
      distinctChannelCount: 2,
    });
    expect(result[1]?.items.map((item) => item.notification_type_label)).toEqual([
      "Failed pipeline",
      "New JIRA ticket",
    ]);
  });
});
