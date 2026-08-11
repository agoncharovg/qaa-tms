import { PluginKind, type PluginManifest, type PluginTab } from "@/core/plugins/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPluginTab(value: unknown): value is PluginTab {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.viewKey === "string" &&
    (value.adminOnly === undefined || typeof value.adminOnly === "boolean") &&
    "element" in value
  );
}

function isPluginManifest(value: unknown): value is PluginManifest {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    typeof value.route === "string" &&
    typeof value.order === "number" &&
    Number.isFinite(value.order) &&
    (value.kind === PluginKind.SYSTEM || value.kind === PluginKind.OPTIONAL) &&
    (value.adminOnly === undefined || typeof value.adminOnly === "boolean") &&
    (value.requiresAgent === undefined || typeof value.requiresAgent === "boolean") &&
    "icon" in value &&
    Array.isArray(value.tabs) &&
    value.tabs.every(isPluginTab)
  );
}

function sortPluginManifests(manifests: readonly PluginManifest[]): PluginManifest[] {
  return [...manifests].sort(
    (left, right) => left.order - right.order || left.id.localeCompare(right.id)
  );
}

function failDiscovery(message: string): never {
  throw new Error(`Plugin discovery failed: ${message}`);
}

function validateUniqueValue(
  seen: Set<string>,
  value: string,
  label: "plugin id" | "plugin route" | "tab id" | "view key"
): void {
  if (seen.has(value)) {
    failDiscovery(`duplicate ${label} "${value}".`);
  }

  seen.add(value);
}

function readDiscoveredManifest(modulePath: string, moduleValue: unknown): PluginManifest {
  if (!isRecord(moduleValue) || !("default" in moduleValue) || !isPluginManifest(moduleValue.default)) {
    throw new Error(
      `Plugin discovery failed for "${modulePath}": default export must be a PluginManifest.`
    );
  }

  return moduleValue.default;
}

export function validatePluginManifests(manifests: readonly unknown[]): PluginManifest[] {
  const normalized = manifests.map((manifest, index) => {
    if (!isPluginManifest(manifest)) {
      failDiscovery(`manifest at index ${index} does not satisfy the PluginManifest contract.`);
    }

    return manifest;
  });
  const sorted = sortPluginManifests(normalized);
  const seenPluginIds = new Set<string>();
  const seenRoutes = new Set<string>();
  const seenTabIds = new Set<string>();
  const seenViewKeys = new Set<string>();

  for (const plugin of sorted) {
    validateUniqueValue(seenPluginIds, plugin.id, "plugin id");
    validateUniqueValue(seenRoutes, plugin.route, "plugin route");

    if (plugin.tabs.length === 0) {
      failDiscovery(`plugin "${plugin.id}" must declare at least one tab.`);
    }

    if (plugin.kind === PluginKind.SYSTEM && plugin.tabs[0]?.adminOnly) {
      failDiscovery(`system plugin "${plugin.id}" cannot default to an admin-only tab.`);
    }

    for (const tab of plugin.tabs) {
      validateUniqueValue(seenTabIds, tab.id, "tab id");
      validateUniqueValue(seenViewKeys, tab.viewKey, "view key");
    }
  }

  return sorted;
}

const modules = import.meta.glob("./*/manifest.tsx", { eager: true });
const discoveredManifests = Object.entries(modules).map(([modulePath, moduleValue]) =>
  readDiscoveredManifest(modulePath, moduleValue)
);

export const PLUGINS: PluginManifest[] = validatePluginManifests(discoveredManifests);
