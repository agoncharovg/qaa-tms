import { ViewKey, type ViewKey as ViewKeyType } from "@/constants";
import { ObjectsPanel } from "@/plugins/leonid/ObjectsPanel";
import { PipelineConfigsPanel } from "@/plugins/leonid/PipelineConfigsPanel";
import { SharedResourcesPanel } from "@/plugins/leonid/SharedResourcesPanel";

interface LeonidSectionProps {
  mode: Extract<
    ViewKeyType,
    typeof ViewKey.LEONID_SHARED_RESOURCES
      | typeof ViewKey.LEONID_OBJECTS
      | typeof ViewKey.LEONID_PIPELINE_CONFIGS
  >;
}

export function LeonidSection({ mode }: LeonidSectionProps) {
  if (mode === ViewKey.LEONID_OBJECTS) {
    return <ObjectsPanel />;
  }

  if (mode === ViewKey.LEONID_PIPELINE_CONFIGS) {
    return <PipelineConfigsPanel />;
  }

  return <SharedResourcesPanel />;
}
