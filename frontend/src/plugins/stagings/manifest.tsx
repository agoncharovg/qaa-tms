import { type PluginManifest } from "@/core/plugins/types";
import { StagingsSection } from "@/plugins/stagings/StagingsSection";
import { ViewKey } from "@/constants";
import { stagingsPluginSpec } from "@/plugins/catalog";

export const stagingsPlugin: PluginManifest = {
  ...stagingsPluginSpec,
  tabs: [
    {
      ...stagingsPluginSpec.tabs[0],
      element: <StagingsSection mode={ViewKey.STAGINGS_PREFLIGHT} />,
    },
    {
      ...stagingsPluginSpec.tabs[1],
      element: <StagingsSection mode={ViewKey.STAGINGS_DEPLOY} />,
    },
    {
      ...stagingsPluginSpec.tabs[2],
      element: <StagingsSection mode={ViewKey.STAGINGS_HISTORY} />,
    },
    {
      ...stagingsPluginSpec.tabs[3],
      element: <StagingsSection mode={ViewKey.STAGINGS_NAMESPACES} />,
    },
    {
      ...stagingsPluginSpec.tabs[4],
      element: <StagingsSection mode={ViewKey.STAGINGS_SYNC} />,
    },
    {
      ...stagingsPluginSpec.tabs[5],
      element: <StagingsSection mode={ViewKey.STAGINGS_E2E} />,
    },
  ],
};
