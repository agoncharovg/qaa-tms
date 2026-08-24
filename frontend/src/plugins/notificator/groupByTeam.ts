import type { NotificatorNotificationConfig } from "@/api/types";

export interface NotificatorTeamGroup {
  teamId: number;
  teamName: string;
  items: NotificatorNotificationConfig[];
  totalNotifications: number;
  enabledCount: number;
  distinctChannelCount: number;
}

export function groupNotificationConfigsByTeam(
  configs: NotificatorNotificationConfig[]
): NotificatorTeamGroup[] {
  const grouped = new Map<
    number,
    NotificatorTeamGroup & { channelIds: Set<string> }
  >();

  for (const config of configs) {
    const existing = grouped.get(config.product_team_id);
    if (existing) {
      existing.items.push(config);
      existing.totalNotifications += 1;
      if (config.enabled) {
        existing.enabledCount += 1;
      }
      for (const channel of config.channels) {
        existing.channelIds.add(channel.channel_id);
      }
      continue;
    }

    grouped.set(config.product_team_id, {
      teamId: config.product_team_id,
      teamName: config.product_team,
      items: [config],
      totalNotifications: 1,
      enabledCount: config.enabled ? 1 : 0,
      distinctChannelCount: 0,
      channelIds: new Set(config.channels.map((channel) => channel.channel_id)),
    });
  }

  return [...grouped.values()]
    .map((group) => ({
      teamId: group.teamId,
      teamName: group.teamName,
      items: [...group.items].sort((left, right) =>
        left.notification_type_label.localeCompare(right.notification_type_label)
      ),
      totalNotifications: group.totalNotifications,
      enabledCount: group.enabledCount,
      distinctChannelCount: group.channelIds.size,
    }))
    .sort((left, right) => left.teamName.localeCompare(right.teamName) || left.teamId - right.teamId);
}
