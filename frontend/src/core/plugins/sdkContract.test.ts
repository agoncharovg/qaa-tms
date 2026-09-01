import { describe, expect, it } from "vitest";
import type {
  AgentAccess as SdkAgentAccess,
  HostApi as SdkHostApi,
  LocalPluginModule as SdkLocalPluginModule,
  MountContext as SdkMountContext,
  ThemeTokens as SdkThemeTokens,
} from "@qaa-tms/plugin-sdk";
import {
  CONTRACT_VERSION as sdkContractVersion,
  isSupportedContractVersion as sdkIsSupportedContractVersion,
} from "@qaa-tms/plugin-sdk";

import {
  CONTRACT_VERSION as frontendContractVersion,
  isSupportedContractVersion as frontendIsSupportedContractVersion,
} from "@/core/plugins/definePlugin";
import type {
  AgentAccess as FrontendAgentAccess,
  HostApi as FrontendHostApi,
  MountContext as FrontendMountContext,
  ThemeTokens as FrontendThemeTokens,
} from "@/core/plugins/host";
import type { LocalPluginModule as FrontendLocalPluginModule } from "@/plugins/localPlugins";

type Assert<T extends true> = T;

type IsAssignable<Left, Right> = [Left] extends [Right] ? true : false;

describe("plugin sdk contract drift guard", () => {
  it("keeps runtime contract helpers in sync with the frontend host", () => {
    const structuralAssignments = [
      true as Assert<IsAssignable<SdkAgentAccess, FrontendAgentAccess>>,
      true as Assert<IsAssignable<FrontendAgentAccess, SdkAgentAccess>>,
      true as Assert<IsAssignable<SdkThemeTokens, FrontendThemeTokens>>,
      true as Assert<IsAssignable<FrontendThemeTokens, SdkThemeTokens>>,
      true as Assert<IsAssignable<SdkHostApi, FrontendHostApi>>,
      true as Assert<IsAssignable<FrontendHostApi, SdkHostApi>>,
      true as Assert<IsAssignable<SdkMountContext, FrontendMountContext>>,
      true as Assert<IsAssignable<FrontendMountContext, SdkMountContext>>,
      true as Assert<IsAssignable<SdkLocalPluginModule, FrontendLocalPluginModule>>,
      true as Assert<IsAssignable<FrontendLocalPluginModule, SdkLocalPluginModule>>,
    ];

    expect(structuralAssignments).toHaveLength(10);
    expect(sdkContractVersion).toBe(frontendContractVersion);
    expect(sdkIsSupportedContractVersion(frontendContractVersion)).toBe(
      frontendIsSupportedContractVersion(frontendContractVersion)
    );
    expect(sdkIsSupportedContractVersion(frontendContractVersion - 1)).toBe(
      frontendIsSupportedContractVersion(frontendContractVersion - 1)
    );
    expect(sdkIsSupportedContractVersion(frontendContractVersion + 1)).toBe(
      frontendIsSupportedContractVersion(frontendContractVersion + 1)
    );
  });
});
