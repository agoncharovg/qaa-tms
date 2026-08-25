import type {
  NotificatorChannel,
  NotificatorNamedEntity,
  NotificatorUser,
} from "@/api/types";

export function formatNullable(value: string | null | undefined, fallback = "-"): string {
  return value && value.trim().length > 0 ? value : fallback;
}

export function formatBoolean(value: boolean): string {
  return value ? "Yes" : "No";
}

export function formatNamedEntity(entity: NotificatorNamedEntity | null | undefined): string {
  return entity?.name ?? "-";
}

export function formatNamedEntities(
  entities: NotificatorNamedEntity[] | null | undefined,
  fallback = "-"
): string {
  if (!entities || entities.length === 0) {
    return fallback;
  }

  return entities.map((entity) => entity.name).join(", ");
}

export function formatUser(user: NotificatorUser | null | undefined): string {
  if (!user) {
    return "-";
  }

  const primary = user.sam_account_name ?? user.username ?? user.display_name ?? null;
  const secondary = user.user_principal_name ?? null;
  if (primary && secondary && primary !== secondary) {
    return `${primary} (${secondary})`;
  }

  return primary ?? secondary ?? `#${user.id}`;
}

export function formatUsers(
  users: NotificatorUser[] | null | undefined,
  fallback = "-"
): string {
  if (!users || users.length === 0) {
    return fallback;
  }

  return users.map((user) => formatUser(user)).join(", ");
}

export function formatChannels(
  channels: NotificatorChannel[] | null | undefined,
  fallback = "-"
): string {
  if (!channels || channels.length === 0) {
    return fallback;
  }

  return channels
    .map((channel) =>
      channel.description ? `${channel.description} (${channel.channel_id})` : channel.channel_id
    )
    .join(", ");
}
