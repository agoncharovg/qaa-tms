import type { DeployFlags, DeployRequest, OperationReplay } from "@/api/types";
import { MAX_DEPLOY_STAGE, MIN_DEPLOY_STAGE } from "@/constants";

export const DeployMode = {
  RAW: "raw",
  IAM: "iam",
  BILLING: "billing",
} as const;

export type DeployMode = (typeof DeployMode)[keyof typeof DeployMode];
export type ShortcutDeployMode = Exclude<DeployMode, "raw">;

export interface DeployImageRow {
  service: string;
  tag: string;
}

export interface ShortcutDeployDraft {
  clean: boolean;
  includeFrontend: boolean;
  pinnedService: string;
  tag: string;
}

export interface DeployDraft {
  mode: DeployMode;
  ns: string;
  servicesText: string;
  imageRows: DeployImageRow[];
  flags: {
    clean: boolean;
    full: boolean;
    dryRun: boolean;
    noSync: boolean;
    stageText: string;
  };
  shortcut: ShortcutDeployDraft;
}

interface ShortcutConfig {
  defaultNamespace: string;
  fullServices: string[];
  bumpServices: string[];
  pinnedServices: string[];
  explicitSemverServices: string[];
}

const EMPTY_IMAGE_ROW: DeployImageRow = {
  service: "",
  tag: "",
};

const SHORTCUT_CONFIGS: Record<ShortcutDeployMode, ShortcutConfig> = {
  billing: {
    bumpServices: ["billing"],
    defaultNamespace: "qaa-billing",
    explicitSemverServices: [],
    fullServices: ["infra", "iam-api", "access-control", "billing", "cdn-api", "platform-notifier", "iam-al-drb"],
    pinnedServices: ["billing"],
  },
  iam: {
    bumpServices: ["iam-api", "access-control", "platform-notifier"],
    defaultNamespace: "qaa-iam",
    explicitSemverServices: ["platform-notifier"],
    fullServices: ["infra", "iam-api", "access-control", "billing", "cdn-api", "platform-notifier", "iam-al-drb"],
    pinnedServices: ["iam-api", "access-control", "platform-notifier"],
  },
};

function createImageRows(images: Record<string, string>): DeployImageRow[] {
  const rows = Object.entries(images).map(([service, tag]) => ({
    service,
    tag,
  }));

  return rows.length > 0 ? rows : [{ ...EMPTY_IMAGE_ROW }];
}

function normalizeServices(rawValue: string): string[] {
  return rawValue
    .split(",")
    .map((service) => service.trim())
    .filter((service) => service.length > 0);
}

function normalizeImages(rows: DeployImageRow[]): Record<string, string> {
  return rows.reduce<Record<string, string>>((images, row) => {
    const service = row.service.trim();
    const tag = row.tag.trim();
    if (service.length > 0 && tag.length > 0) {
      images[service] = tag;
    }
    return images;
  }, {});
}

function normalizeStage(stageText: string): number | null {
  const trimmedValue = stageText.trim();
  if (trimmedValue.length === 0) {
    return null;
  }

  const parsedValue = Number.parseInt(trimmedValue, 10);
  if (
    Number.isNaN(parsedValue) ||
    parsedValue < MIN_DEPLOY_STAGE ||
    parsedValue > MAX_DEPLOY_STAGE
  ) {
    return null;
  }

  return parsedValue;
}

function toDraftFlags(flags: Record<string, unknown>): DeployDraft["flags"] {
  const stage = typeof flags.stage === "number" ? flags.stage : null;

  return {
    clean: flags.clean === true,
    dryRun: flags.dryRun === true,
    full: flags.full === true,
    noSync: flags.noSync === true,
    stageText: stage === null ? "" : String(stage),
  };
}

function createDefaultShortcutDraft(mode: ShortcutDeployMode): ShortcutDeployDraft {
  return {
    clean: false,
    includeFrontend: false,
    pinnedService: SHORTCUT_CONFIGS[mode].pinnedServices[0],
    tag: "latest",
  };
}

function buildShortcutRequest(draft: DeployDraft, mode: ShortcutDeployMode, namespaceExists: boolean): DeployRequest {
  const config = SHORTCUT_CONFIGS[mode];
  const pinnedService = draft.shortcut.pinnedService.trim();
  const tag = draft.shortcut.tag.trim();

  if (!config.pinnedServices.includes(pinnedService)) {
    throw new Error(`Unsupported ${mode} shortcut service: ${pinnedService || "empty"}.`);
  }
  if (tag.length === 0) {
    throw new Error("Shortcut deploys require an image tag.");
  }
  if (requiresExplicitSemver(mode, pinnedService) && tag === "latest") {
    throw new Error(`${pinnedService} needs an explicit semver tag.`);
  }

  const useFullDeploy = !namespaceExists || draft.shortcut.clean;
  const services = useFullDeploy
    ? draft.shortcut.includeFrontend
      ? [...config.fullServices, "frontend"]
      : [...config.fullServices]
    : [...config.bumpServices];

  return {
    flags: {
      clean: namespaceExists && draft.shortcut.clean,
      dryRun: false,
      full: false,
      noSync: false,
      stage: null,
    },
    images: {
      [pinnedService]: tag,
    },
    ns: draft.ns.trim(),
    services,
  };
}

export function isShortcutDeployMode(mode: DeployMode): mode is ShortcutDeployMode {
  return mode !== DeployMode.RAW;
}

export function getShortcutDefaultNamespace(mode: ShortcutDeployMode): string {
  return SHORTCUT_CONFIGS[mode].defaultNamespace;
}

export function getShortcutPinnedServices(mode: ShortcutDeployMode): string[] {
  return [...SHORTCUT_CONFIGS[mode].pinnedServices];
}

export function requiresExplicitSemver(mode: ShortcutDeployMode, service: string): boolean {
  return SHORTCUT_CONFIGS[mode].explicitSemverServices.includes(service);
}

export function isShortcutFullDeploy(namespaceExists: boolean, draft: ShortcutDeployDraft): boolean {
  return !namespaceExists || draft.clean;
}

export function createEmptyDeployDraft(): DeployDraft {
  return {
    flags: {
      clean: false,
      dryRun: false,
      full: false,
      noSync: false,
      stageText: "",
    },
    imageRows: [{ ...EMPTY_IMAGE_ROW }],
    mode: DeployMode.RAW,
    ns: "",
    servicesText: "",
    shortcut: createDefaultShortcutDraft(DeployMode.IAM),
  };
}

export function createDeployDraftFromReplay(replay: Pick<OperationReplay, "ns" | "recipe">): DeployDraft {
  return {
    flags: toDraftFlags(replay.recipe.flags),
    imageRows: createImageRows(replay.recipe.images),
    mode: DeployMode.RAW,
    ns: replay.ns ?? "",
    servicesText: replay.recipe.services.join(", "),
    shortcut: createDefaultShortcutDraft(DeployMode.IAM),
  };
}

export function buildDeployFlagsFromDraft(draft: DeployDraft): DeployFlags {
  return {
    clean: draft.flags.clean,
    dryRun: draft.flags.dryRun,
    full: draft.flags.full,
    noSync: draft.flags.noSync,
    stage: normalizeStage(draft.flags.stageText),
  };
}

export function buildDeployRequestFromDraft(
  draft: DeployDraft,
  options: {
    namespaceExists?: boolean;
  } = {}
): DeployRequest {
  if (isShortcutDeployMode(draft.mode)) {
    if (options.namespaceExists === undefined) {
      throw new Error("Shortcut deploys require the deployed namespace list.");
    }
    return buildShortcutRequest(draft, draft.mode, options.namespaceExists);
  }

  return {
    flags: buildDeployFlagsFromDraft(draft),
    images: normalizeImages(draft.imageRows),
    ns: draft.ns.trim(),
    services: normalizeServices(draft.servicesText),
  };
}
