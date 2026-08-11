import { CONTRACT_VERSION } from "@/constants";
import type { PluginManifest, PluginTab } from "@/core/plugins/types";

export { CONTRACT_VERSION } from "@/constants";

export const SUPPORTED_CONTRACT_VERSION_RANGE = {
  max: CONTRACT_VERSION,
  min: CONTRACT_VERSION,
} as const;

function hasOwnProperty(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function failPluginDefinition(message: string): never {
  throw new Error(`Plugin definition failed: ${message}`);
}

function validateTabRenderContract(pluginId: string, tab: PluginTab): void {
  const hasElement = hasOwnProperty(tab, "element");
  const hasMount = typeof (tab as { mount?: unknown }).mount === "function";

  if (hasElement && hasMount) {
    failPluginDefinition(
      `plugin "${pluginId}" tab "${tab.id}" must declare either element or mount, not both.`
    );
  }

  if (!hasElement && !hasMount) {
    failPluginDefinition(
      `plugin "${pluginId}" tab "${tab.id}" must declare exactly one render entry: element or mount.`
    );
  }
}

export function isSupportedContractVersion(version: number): boolean {
  return (
    Number.isInteger(version) &&
    version >= SUPPORTED_CONTRACT_VERSION_RANGE.min &&
    version <= SUPPORTED_CONTRACT_VERSION_RANGE.max
  );
}

export function definePlugin<T extends PluginManifest>(input: T): T {
  if (!hasOwnProperty(input, "contractVersion")) {
    failPluginDefinition(`plugin "${input.id}" is missing contractVersion.`);
  }

  if (!isSupportedContractVersion(input.contractVersion)) {
    failPluginDefinition(
      `plugin "${input.id}" contractVersion ${String(input.contractVersion)} is unsupported; supported range is ${SUPPORTED_CONTRACT_VERSION_RANGE.min}-${SUPPORTED_CONTRACT_VERSION_RANGE.max}.`
    );
  }

  const seenTabIds = new Set<string>();
  const seenViewKeys = new Set<string>();

  for (const tab of input.tabs) {
    validateTabRenderContract(input.id, tab);

    if (seenTabIds.has(tab.id)) {
      failPluginDefinition(`plugin "${input.id}" declares duplicate tab id "${tab.id}".`);
    }
    seenTabIds.add(tab.id);

    if (seenViewKeys.has(tab.viewKey)) {
      failPluginDefinition(
        `plugin "${input.id}" declares duplicate view key "${tab.viewKey}".`
      );
    }
    seenViewKeys.add(tab.viewKey);
  }

  return input;
}
