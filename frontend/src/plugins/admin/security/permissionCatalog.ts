import type { SecurityPermission } from "@/api/types";

const DOMAIN_LABEL_OVERRIDES: Record<string, string> = {
  jenkins: "Jenkins",
  kuber: "Kuber",
  leonid: "Leonid",
  notificator: "Notificator",
  operations: "Operations",
  profile: "Profile",
  qaa: "QAA",
  security: "Security",
  server_settings: "Server settings",
  stagings: "Stagings",
  statistics: "Statistics",
  users: "Users",
};

const DOMAIN_ORDER = [
  "security",
  "users",
  "profile",
  "server_settings",
  "operations",
  "jenkins",
  "statistics",
  "stagings",
  "kuber",
  "qaa",
  "notificator",
  "leonid",
] as const;

export interface PermissionDomain {
  key: string;
  label: string;
  permissions: SecurityPermission[];
}

function humanizeDomainKey(domainKey: string): string {
  const override = DOMAIN_LABEL_OVERRIDES[domainKey];
  if (override) {
    return override;
  }

  return domainKey
    .split("_")
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function compareDomainKeys(left: string, right: string): number {
  const leftIndex = DOMAIN_ORDER.indexOf(left as (typeof DOMAIN_ORDER)[number]);
  const rightIndex = DOMAIN_ORDER.indexOf(right as (typeof DOMAIN_ORDER)[number]);

  if (leftIndex !== -1 || rightIndex !== -1) {
    if (leftIndex === -1) {
      return 1;
    }
    if (rightIndex === -1) {
      return -1;
    }
    return leftIndex - rightIndex;
  }

  return humanizeDomainKey(left).localeCompare(humanizeDomainKey(right));
}

export function buildPermissionDomains(
  permissions: SecurityPermission[]
): PermissionDomain[] {
  const grouped = new Map<string, SecurityPermission[]>();

  for (const permission of permissions) {
    const domainKey = permission.key.split(".", 1)[0] ?? "other";
    const items = grouped.get(domainKey);
    if (items) {
      items.push(permission);
      continue;
    }
    grouped.set(domainKey, [permission]);
  }

  return [...grouped.entries()]
    .map(([key, items]) => ({
      key,
      label: humanizeDomainKey(key),
      permissions: [...items].sort((left, right) => left.key.localeCompare(right.key)),
    }))
    .sort((left, right) => compareDomainKeys(left.key, right.key));
}

export function collectPermissionKeys(domains: PermissionDomain[]): string[] {
  return domains.flatMap((domain) => domain.permissions.map((permission) => permission.key));
}

export function collectDomainFirstKeys(domains: PermissionDomain[]): Set<string> {
  return new Set(
    domains
      .map((domain) => domain.permissions[0]?.key)
      .filter((key): key is string => Boolean(key))
  );
}

export function buildPermissionShortLabels(permissionKeys: string[]): Map<string, string> {
  const lastSegmentCounts = new Map<string, number>();
  for (const key of permissionKeys) {
    const lastSegment = key.split(".").at(-1) ?? key;
    lastSegmentCounts.set(lastSegment, (lastSegmentCounts.get(lastSegment) ?? 0) + 1);
  }

  return new Map(
    permissionKeys.map((key) => {
      const parts = key.split(".");
      const lastSegment = parts.at(-1) ?? key;
      if ((lastSegmentCounts.get(lastSegment) ?? 0) > 1 && parts.length >= 2) {
        return [key, `${parts.at(-2)}.${lastSegment}`];
      }
      return [key, lastSegment];
    })
  );
}
