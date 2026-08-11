import {
  ViewKey,
  type ViewKey as ViewKeyType,
} from "@/constants";
import { AdminPanel } from "@/plugins/qaa-generator/AdminPanel";
import { GeneratePanel } from "@/plugins/qaa-generator/GeneratePanel";
import { LivePanel } from "@/plugins/qaa-generator/LivePanel";
import { RunsPanel } from "@/plugins/qaa-generator/RunsPanel";

interface QaaGeneratorSectionProps {
  mode: Extract<
    ViewKeyType,
    | typeof ViewKey.QAA_GENERATE
    | typeof ViewKey.QAA_LIVE
    | typeof ViewKey.QAA_RUNS
    | typeof ViewKey.QAA_ADMIN
  >;
}

export function QaaGeneratorSection({ mode }: QaaGeneratorSectionProps) {
  if (mode === ViewKey.QAA_LIVE) {
    return <LivePanel />;
  }

  if (mode === ViewKey.QAA_RUNS) {
    return <RunsPanel />;
  }

  if (mode === ViewKey.QAA_ADMIN) {
    return <AdminPanel />;
  }

  return <GeneratePanel />;
}
