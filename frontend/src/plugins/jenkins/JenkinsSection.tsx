import { ViewKey, type ViewKey as ViewKeyType } from "@/constants";
import { BoardPanel } from "@/plugins/jenkins/BoardPanel";
import { TreePanel } from "@/plugins/jenkins/TreePanel";

interface JenkinsSectionProps {
  mode: Extract<ViewKeyType, typeof ViewKey.JENKINS_TREE | typeof ViewKey.JENKINS_BOARD>;
}

export function JenkinsSection({ mode }: JenkinsSectionProps) {
  return mode === ViewKey.JENKINS_BOARD ? <BoardPanel /> : <TreePanel />;
}
