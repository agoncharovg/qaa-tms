import type { JenkinsNode } from "@/api/types";
import { JenkinsStatus, type JenkinsStatus as JenkinsStatusType } from "@/constants";

export interface JenkinsStatusCounts {
  disabled: number;
  failed: number;
  notbuilt: number;
  passed: number;
  running: number;
  stuck: number;
}

export function createEmptyJenkinsStatusCounts(): JenkinsStatusCounts {
  return {
    disabled: 0,
    failed: 0,
    notbuilt: 0,
    passed: 0,
    running: 0,
    stuck: 0,
  };
}

export function collectExpandableNodePaths(roots: JenkinsNode[]): string[] {
  return roots.flatMap((node) => collectNodePaths(node));
}

export function findNodeByPath(roots: JenkinsNode[], path: string): JenkinsNode | null {
  for (const root of roots) {
    if (root.path === path) {
      return root;
    }
    const found = findNodeByPath(root.children, path);
    if (found) {
      return found;
    }
  }
  return null;
}

export function flattenPipelines(node: JenkinsNode): JenkinsNode[] {
  if (node.kind === "pipeline") {
    return [node];
  }
  return node.children.flatMap((child) => flattenPipelines(child));
}

export function countPipelineStatuses(node: JenkinsNode): JenkinsStatusCounts {
  return flattenPipelines(node).reduce((counts, pipeline) => {
    switch (pipeline.status) {
      case JenkinsStatus.PASSED:
        counts.passed += 1;
        break;
      case JenkinsStatus.FAILED:
        counts.failed += 1;
        break;
      case JenkinsStatus.DISABLED:
        counts.disabled += 1;
        break;
      case JenkinsStatus.RUNNING:
        counts.running += 1;
        break;
      case JenkinsStatus.STUCK:
        counts.stuck += 1;
        break;
      case JenkinsStatus.NOTBUILT:
        counts.notbuilt += 1;
        break;
      default:
        break;
    }
    return counts;
  }, createEmptyJenkinsStatusCounts());
}

export function countGrayStatuses(counts: JenkinsStatusCounts): number {
  return counts.disabled + counts.notbuilt;
}

export function statusKey(status: JenkinsStatusType | null): string {
  return status ?? JenkinsStatus.NOTBUILT;
}

function collectNodePaths(node: JenkinsNode): string[] {
  return [node.path, ...node.children.flatMap((child) => collectNodePaths(child))];
}
