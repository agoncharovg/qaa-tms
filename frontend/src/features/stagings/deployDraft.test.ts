import { describe, expect, it } from "vitest";

import { buildDeployRequestFromDraft, createEmptyDeployDraft, DeployMode } from "@/features/stagings/deployDraft";

describe("deployDraft", () => {
  it("builds the raw deploy request including clean", () => {
    const draft = createEmptyDeployDraft();
    draft.ns = "qa-demo";
    draft.servicesText = "iam-api, billing";
    draft.imageRows = [{ service: "billing", tag: "0.881.1" }];
    draft.flags.clean = true;
    draft.flags.full = true;
    draft.flags.dryRun = true;
    draft.flags.noSync = true;
    draft.flags.stageText = "4";

    expect(buildDeployRequestFromDraft(draft)).toEqual({
      flags: {
        clean: true,
        dryRun: true,
        full: true,
        noSync: true,
        stage: 4,
      },
      images: {
        billing: "0.881.1",
      },
      ns: "qa-demo",
      services: ["iam-api", "billing"],
    });
  });

  it("builds the IAM shortcut bump request", () => {
    const draft = createEmptyDeployDraft();
    draft.mode = DeployMode.IAM;
    draft.ns = "qaa-iam";
    draft.shortcut.pinnedService = "iam-api";
    draft.shortcut.tag = "latest";

    expect(buildDeployRequestFromDraft(draft, { namespaceExists: true })).toEqual({
      flags: {
        clean: false,
        dryRun: false,
        full: false,
        noSync: false,
        stage: null,
      },
      images: {
        "iam-api": "latest",
      },
      ns: "qaa-iam",
      services: ["iam-api", "access-control", "platform-notifier"],
    });
  });

  it("builds the IAM shortcut clean request with frontend", () => {
    const draft = createEmptyDeployDraft();
    draft.mode = DeployMode.IAM;
    draft.ns = "qaa-iam";
    draft.shortcut.clean = true;
    draft.shortcut.includeFrontend = true;
    draft.shortcut.pinnedService = "access-control";
    draft.shortcut.tag = "1.2.3";

    expect(buildDeployRequestFromDraft(draft, { namespaceExists: true })).toEqual({
      flags: {
        clean: true,
        dryRun: false,
        full: false,
        noSync: false,
        stage: null,
      },
      images: {
        "access-control": "1.2.3",
      },
      ns: "qaa-iam",
      services: [
        "infra",
        "iam-api",
        "access-control",
        "billing",
        "cdn-api",
        "platform-notifier",
        "iam-al-drb",
        "frontend",
      ],
    });
  });

  it("rejects latest for platform-notifier", () => {
    const draft = createEmptyDeployDraft();
    draft.mode = DeployMode.IAM;
    draft.ns = "qaa-iam";
    draft.shortcut.pinnedService = "platform-notifier";
    draft.shortcut.tag = "latest";

    expect(() => buildDeployRequestFromDraft(draft, { namespaceExists: true })).toThrow(
      /explicit semver/i
    );
  });
});
