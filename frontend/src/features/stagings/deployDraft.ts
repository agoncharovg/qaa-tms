import type { DeployFlags, DeployRequest, OperationReplay } from "@/api/types";
import { MAX_DEPLOY_STAGE, MIN_DEPLOY_STAGE } from "@/constants";

export interface DeployImageRow {
  service: string;
  tag: string;
}

export interface DeployDraft {
  ns: string;
  servicesText: string;
  imageRows: DeployImageRow[];
  flags: {
    full: boolean;
    dryRun: boolean;
    noSync: boolean;
    stageText: string;
  };
}

const EMPTY_IMAGE_ROW: DeployImageRow = {
  service: "",
  tag: "",
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
    dryRun: flags.dryRun === true,
    full: flags.full === true,
    noSync: flags.noSync === true,
    stageText: stage === null ? "" : String(stage),
  };
}

export function createEmptyDeployDraft(): DeployDraft {
  return {
    flags: {
      dryRun: false,
      full: false,
      noSync: false,
      stageText: "",
    },
    imageRows: [{ ...EMPTY_IMAGE_ROW }],
    ns: "",
    servicesText: "",
  };
}

export function createDeployDraftFromReplay(replay: Pick<OperationReplay, "ns" | "recipe">): DeployDraft {
  return {
    flags: toDraftFlags(replay.recipe.flags),
    imageRows: createImageRows(replay.recipe.images),
    ns: replay.ns ?? "",
    servicesText: replay.recipe.services.join(", "),
  };
}

export function buildDeployFlagsFromDraft(draft: DeployDraft): DeployFlags {
  return {
    dryRun: draft.flags.dryRun,
    full: draft.flags.full,
    noSync: draft.flags.noSync,
    stage: normalizeStage(draft.flags.stageText),
  };
}

export function buildDeployRequestFromDraft(draft: DeployDraft): DeployRequest {
  return {
    flags: buildDeployFlagsFromDraft(draft),
    images: normalizeImages(draft.imageRows),
    ns: draft.ns.trim(),
    services: normalizeServices(draft.servicesText),
  };
}
