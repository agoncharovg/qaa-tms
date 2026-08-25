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

const SYNTHETIC_NODE_KEY_PREFIX = "synthetic" as const;

export function buildJenkinsNodeKey(node: JenkinsNode, parentKey = ""): string {
  if (node.path) {
    return node.path;
  }
  if (parentKey) {
    return `${parentKey}/${node.name}`;
  }
  return `${SYNTHETIC_NODE_KEY_PREFIX}/${node.name}`;
}

export function collectExpandableNodeKeys(roots: JenkinsNode[]): string[] {
  return roots.flatMap((node) => collectNodeKeys(node));
}

export function findNodeByPath(roots: JenkinsNode[], path: string): JenkinsNode | null {
  if (!path) {
    return null;
  }
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

// The "frozen" indicator follows the real Jenkins state, not the freeze DB records:
// a pipeline is frozen when it is disabled in Jenkins, and a folder is frozen when it
// holds at least one disabled pipeline. This keeps the tree honest even when pipelines
// are re-enabled directly in Jenkins or via a partial (nested) resume campaign.
export function hasDisabledPipeline(node: JenkinsNode): boolean {
  if (node.kind === "pipeline") {
    return node.status === JenkinsStatus.DISABLED;
  }
  return node.children.some((child) => hasDisabledPipeline(child));
}

// A folder can still be frozen as long as it holds at least one enabled (non-disabled)
// pipeline. This is deliberately independent of the "frozen" indicator: a folder that
// already contains a manually-disabled pipeline is still freezable for the rest of its
// subtree, so the freeze action must not be gated on hasDisabledPipeline.
export function hasFreezablePipeline(node: JenkinsNode): boolean {
  if (node.kind === "pipeline") {
    return node.status !== JenkinsStatus.DISABLED;
  }
  return node.children.some((child) => hasFreezablePipeline(child));
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

function collectNodeKeys(node: JenkinsNode, parentKey = ""): string[] {
  const nodeKey = buildJenkinsNodeKey(node, parentKey);
  return [nodeKey, ...node.children.flatMap((child) => collectNodeKeys(child, nodeKey))];
}
