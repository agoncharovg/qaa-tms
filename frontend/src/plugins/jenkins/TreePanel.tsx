import { useEffect, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Collapse,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconChevronDown,
  IconChevronRight,
  IconFolder,
  IconGitBranch,
  IconMaximize,
  IconMinimize,
  IconPin,
  IconPinnedOff,
  IconRefresh,
} from "@tabler/icons-react";

import { AgentRequestError } from "@/api/agentClient";
import type { JenkinsBuild, JenkinsNode } from "@/api/types";
import {
  JenkinsNodeKind,
  JenkinsStatusColor,
  JenkinsStatusLabel,
  PluginId,
  TabId,
} from "@/constants";
import { BuildHistoryLine, getBuildHistoryLineWidth } from "@/plugins/jenkins/BuildHistoryLine";
import { getBuildColor, getBuildLabel } from "@/plugins/jenkins/buildStatus";
import { useJenkinsStore } from "@/plugins/jenkins/jenkinsStore";
import { collectExpandableNodePaths } from "@/plugins/jenkins/treeUtils";
import { useJenkinsBuilds } from "@/plugins/jenkins/useJenkinsBuilds";
import { useJenkinsTree } from "@/plugins/jenkins/useJenkinsTree";
import { useAuthStore } from "@/store/authStore";
import { useUiStore } from "@/store/uiStoreCore";

interface TreePanelProps {
  agentPort: number;
}

interface TreeNodeRowProps {
  agentPort: number;
  depth: number;
  expandedPaths: string[];
  historyLimit: number | null;
  isActive: boolean;
  node: JenkinsNode;
  onPinToggle: (path: string) => void;
  onToggle: (path: string) => void;
  pinnedPaths: string[];
  signature: string | null;
  token: string | null;
}

const TreePanelCopy = {
  BUILDS_EMPTY: "No recent builds were returned.",
  EMPTY_BODY: "No Jenkins folders were returned for the configured .QAA/E2E scope.",
  EMPTY_TITLE: "No Jenkins data",
  ERROR_GENERIC: "Jenkins data request failed",
  ERROR_NOT_CONFIGURED_BODY:
    "Set AGENT_JENKINS_URL, AGENT_JENKINS_USERNAME, and AGENT_JENKINS_TOKEN in the companion app.",
  ERROR_NOT_CONFIGURED_TITLE: "Jenkins is not configured in the companion app",
  ERROR_UNREACHABLE_BODY: "Connect VPN and confirm Jenkins is reachable from this machine.",
  ERROR_UNREACHABLE_TITLE: "Jenkins is unreachable",
  EXPAND_ALL: "Expand all",
  COLLAPSE_ALL: "Collapse all",
  LOADING_BUILDS: "Loading recent builds.",
  LOADING_TREE: "Loading Jenkins tree.",
  NODE_KIND_FOLDER: "Folder",
  NODE_KIND_PIPELINE: "Pipeline",
  OPEN_ALLURE: "Open Allure report",
  PIN: "Pin to board",
  REFRESH: "Refresh",
  SUBTITLE:
    "Browse the live Jenkins tree for the configured .QAA/E2E roots, expand pipelines for recent builds, and pin folders or pipelines for the board.",
  TITLE: "Tree",
  UNPIN: "Unpin from board",
} as const;

const TreePanelValue = {
  INDENT_STEP_PX: 24,
  LEFT_BORDER_PX: 2,
  PIPELINE_META_GAP_PX: 8,
  PIN_SLOT_PX: 36,
  STATUS_SLOT_PX: 104,
} as const;

const RelativeTimeValue = {
  DAY_SECONDS: 86400,
  HOUR_SECONDS: 3600,
  MINUTE_SECONDS: 60,
  SECOND_MS: 1000,
} as const;

export function TreePanel({ agentPort }: TreePanelProps) {
  const token = useAuthStore((state) => state.token);
  const pinnedPaths = useJenkinsStore((state) => state.pinnedPaths);
  const pin = useJenkinsStore((state) => state.pin);
  const unpin = useJenkinsStore((state) => state.unpin);
  const isActive = useUiStore((state) => state.tabsByPlugin[PluginId.JENKINS].activeTabId === TabId.JENKINS_TREE);
  const [expandedPaths, setExpandedPaths] = useState<string[]>([]);
  const treeState = useJenkinsTree({
    agentPort,
    enabled: true,
    isActive,
    token,
  });

  useEffect(() => {
    if (expandedPaths.length > 0 || treeState.roots.length === 0) {
      return;
    }
    setExpandedPaths(treeState.roots.map((root) => root.path));
  }, [expandedPaths.length, treeState.roots]);

  if (treeState.isLoading) {
    return (
      <Stack align="center" gap="md" py="xl">
        <Loader size="lg" />
        <Text c="dimmed">{TreePanelCopy.LOADING_TREE}</Text>
      </Stack>
    );
  }

  if (treeState.error && treeState.roots.length === 0) {
    return renderTreeError(treeState.error);
  }

  if (treeState.roots.length === 0) {
    return (
      <Paper p="xl" radius="lg" withBorder>
        <Stack gap="sm">
          <Title order={3}>{TreePanelCopy.EMPTY_TITLE}</Title>
          <Text c="dimmed">{TreePanelCopy.EMPTY_BODY}</Text>
        </Stack>
      </Paper>
    );
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between" wrap="wrap">
        <div>
          <Title order={3}>{TreePanelCopy.TITLE}</Title>
          <Text c="dimmed" size="sm">
            {TreePanelCopy.SUBTITLE}
          </Text>
        </div>
        <Group>
          <Button
            leftSection={<IconMaximize size={16} />}
            onClick={() => setExpandedPaths(collectExpandableNodePaths(treeState.roots))}
            variant="light"
          >
            {TreePanelCopy.EXPAND_ALL}
          </Button>
          <Button
            leftSection={<IconMinimize size={16} />}
            onClick={() => setExpandedPaths([])}
            variant="light"
          >
            {TreePanelCopy.COLLAPSE_ALL}
          </Button>
          <Button
            leftSection={<IconRefresh size={16} />}
            loading={treeState.isRefreshing}
            onClick={() => void treeState.refetch()}
          >
            {TreePanelCopy.REFRESH}
          </Button>
        </Group>
      </Group>

      <Stack gap="xs">
        {treeState.roots.map((node) => (
          <TreeNodeRow
            key={node.path}
            agentPort={agentPort}
            depth={0}
            expandedPaths={expandedPaths}
            historyLimit={treeState.historyLimit}
            isActive={isActive}
            node={node}
            onPinToggle={(path) => {
              if (pinnedPaths.includes(path)) {
                unpin(path);
                return;
              }
              pin(path);
            }}
            onToggle={(path) => {
              setExpandedPaths((currentPaths) =>
                currentPaths.includes(path)
                  ? currentPaths.filter((candidate) => candidate !== path)
                  : [...currentPaths, path]
              );
            }}
            pinnedPaths={pinnedPaths}
            signature={treeState.signature}
            token={token}
          />
        ))}
      </Stack>
    </Stack>
  );
}

function TreeNodeRow({
  agentPort,
  depth,
  expandedPaths,
  historyLimit,
  isActive,
  node,
  onPinToggle,
  onToggle,
  pinnedPaths,
  signature,
  token,
}: TreeNodeRowProps) {
  const expanded = expandedPaths.includes(node.path);
  const pinned = pinnedPaths.includes(node.path);
  const buildHistoryWidth = getBuildHistoryLineWidth(historyLimit);
  const buildsState = useJenkinsBuilds({
    agentPort,
    enabled: expanded && isActive && node.kind === JenkinsNodeKind.PIPELINE,
    path: node.path,
    signature,
    token,
  });
  const buildHistory = [...node.builds].reverse();
  const expandedBuilds = buildsState.fetchedAt ? buildsState.builds : node.builds;

  return (
    <Stack gap="xs">
      <Paper
        onClick={() => onToggle(node.path)}
        onDoubleClick={() => openExternal(node.url)}
        p="sm"
        radius="md"
        style={{
          cursor: "pointer",
          marginLeft: depth * TreePanelValue.INDENT_STEP_PX,
        }}
        withBorder
      >
        <Group justify="space-between" wrap="nowrap">
          <Group gap="sm" style={{ flex: 1, minWidth: 0 }} wrap="nowrap">
            <ActionIcon aria-label={expanded ? TreePanelCopy.COLLAPSE_ALL : TreePanelCopy.EXPAND_ALL} variant="subtle">
              {expanded ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
            </ActionIcon>
            <Tooltip
              label={
                node.kind === JenkinsNodeKind.FOLDER
                  ? TreePanelCopy.NODE_KIND_FOLDER
                  : TreePanelCopy.NODE_KIND_PIPELINE
              }
            >
              <ThemeIcon
                aria-label={
                  node.kind === JenkinsNodeKind.FOLDER
                    ? TreePanelCopy.NODE_KIND_FOLDER
                    : TreePanelCopy.NODE_KIND_PIPELINE
                }
                color={node.kind === JenkinsNodeKind.FOLDER ? "gray" : "cyan"}
                radius="xl"
                role="img"
                size="md"
                variant="light"
              >
                {node.kind === JenkinsNodeKind.FOLDER ? (
                  <IconFolder size={14} />
                ) : (
                  <IconGitBranch size={14} />
                )}
              </ThemeIcon>
            </Tooltip>
            <Text fw={500} truncate="end">{node.name}</Text>
          </Group>
          <Group
            gap={TreePanelValue.PIPELINE_META_GAP_PX}
            style={{
              flexShrink: 0,
              justifyContent: node.kind === JenkinsNodeKind.PIPELINE ? "flex-end" : undefined,
              width:
                node.kind === JenkinsNodeKind.PIPELINE
                  ? buildHistoryWidth +
                    TreePanelValue.PIPELINE_META_GAP_PX +
                    TreePanelValue.STATUS_SLOT_PX +
                    TreePanelValue.PIPELINE_META_GAP_PX +
                    TreePanelValue.PIN_SLOT_PX
                  : undefined,
            }}
            wrap="nowrap"
          >
            {node.kind === JenkinsNodeKind.PIPELINE ? (
              <Box style={{ display: "flex", justifyContent: "flex-start", width: buildHistoryWidth }}>
                {buildHistory.length > 0 ? (
                  <BuildHistoryLine builds={buildHistory} slotCount={historyLimit} />
                ) : null}
              </Box>
            ) : null}
            {node.kind === JenkinsNodeKind.PIPELINE ? (
              <Box style={{ display: "flex", justifyContent: "flex-end", width: TreePanelValue.STATUS_SLOT_PX }}>
                {node.status ? (
                  <Badge color={JenkinsStatusColor[node.status]} variant="light">
                    {JenkinsStatusLabel[node.status]}
                  </Badge>
                ) : null}
              </Box>
            ) : null}
            <Tooltip label={pinned ? TreePanelCopy.UNPIN : TreePanelCopy.PIN}>
              <ActionIcon
                aria-label={pinned ? TreePanelCopy.UNPIN : TreePanelCopy.PIN}
                color={pinned ? "yellow" : "gray"}
                onClick={(event) => {
                  event.stopPropagation();
                  onPinToggle(node.path);
                }}
                style={{
                  flex: "0 0 auto",
                  width: TreePanelValue.PIN_SLOT_PX,
                }}
                variant="light"
              >
                {pinned ? <IconPinnedOff size={16} /> : <IconPin size={16} />}
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      </Paper>

      {node.kind === JenkinsNodeKind.FOLDER ? (
        <Collapse in={expanded}>
          <Stack gap="xs">
            {node.children.map((child) => (
              <TreeNodeRow
                key={child.path}
                agentPort={agentPort}
                depth={depth + 1}
                expandedPaths={expandedPaths}
                historyLimit={historyLimit}
                isActive={isActive}
                node={child}
                onPinToggle={onPinToggle}
                onToggle={onToggle}
                pinnedPaths={pinnedPaths}
                signature={signature}
                token={token}
              />
            ))}
          </Stack>
        </Collapse>
      ) : (
        <Collapse in={expanded}>
          <Paper
            p="sm"
            radius="md"
            style={{
              borderLeft: String(TreePanelValue.LEFT_BORDER_PX) + "px solid var(--mantine-color-dark-4)",
              marginLeft: (depth + 1) * TreePanelValue.INDENT_STEP_PX,
            }}
            withBorder
          >
            {buildsState.isLoading && expandedBuilds.length === 0 ? (
              <Group gap="sm">
                <Loader size="sm" />
                <Text c="dimmed" size="sm">{TreePanelCopy.LOADING_BUILDS}</Text>
              </Group>
            ) : null}
            {buildsState.error && expandedBuilds.length === 0 ? (
              <Text c="red" size="sm">
                {buildsState.error instanceof Error ? buildsState.error.message : TreePanelCopy.ERROR_GENERIC}
              </Text>
            ) : null}
            {expandedBuilds.length === 0 && !buildsState.isLoading && !buildsState.isRefreshing ? (
              <Text c="dimmed" size="sm">{TreePanelCopy.BUILDS_EMPTY}</Text>
            ) : null}
            {expandedBuilds.length > 0 ? (
              <Stack gap="xs">
                {expandedBuilds.map((build) => (
                  <BuildRow build={build} key={build.url} />
                ))}
              </Stack>
            ) : null}
          </Paper>
        </Collapse>
      )}
    </Stack>
  );
}

function BuildRow({ build }: { build: JenkinsBuild }) {
  return (
    <Tooltip label={TreePanelCopy.OPEN_ALLURE}>
      <Paper
        onDoubleClick={() => openExternal(build.allureUrl)}
        p="xs"
        radius="sm"
        style={{ cursor: "pointer" }}
        withBorder
      >
        <Group justify="space-between" wrap="wrap">
          <Group gap="sm">
            <Text fw={500}>{"#" + String(build.number)}</Text>
            <Badge color={getBuildColor(build)} variant="light">
              {getBuildLabel(build)}
            </Badge>
          </Group>
          <Group gap="xs">
            <Text c="dimmed" size="sm">
              {formatRelativeAge(build.timestamp)}
            </Text>
            <Text c="dimmed" size="sm">
              {formatDuration(build.durationMs)}
            </Text>
          </Group>
        </Group>
      </Paper>
    </Tooltip>
  );
}

function renderTreeError(error: unknown) {
  const presentation = getErrorPresentation(error);
  return (
    <Alert color="red" icon={<IconAlertCircle size={18} />} title={presentation.title}>
      <Text>{presentation.body}</Text>
    </Alert>
  );
}

function getErrorPresentation(error: unknown): { body: string; title: string } {
  if (error instanceof AgentRequestError && error.status === 503) {
    return {
      body: TreePanelCopy.ERROR_NOT_CONFIGURED_BODY,
      title: TreePanelCopy.ERROR_NOT_CONFIGURED_TITLE,
    };
  }
  if (error instanceof AgentRequestError && error.status === 502) {
    return {
      body: TreePanelCopy.ERROR_UNREACHABLE_BODY,
      title: TreePanelCopy.ERROR_UNREACHABLE_TITLE,
    };
  }
  return {
    body: error instanceof Error ? error.message : TreePanelCopy.ERROR_GENERIC,
    title: TreePanelCopy.ERROR_GENERIC,
  };
}

function formatRelativeAge(timestamp: number): string {
  const diffSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / RelativeTimeValue.SECOND_MS));
  if (diffSeconds >= RelativeTimeValue.DAY_SECONDS) {
    return String(Math.floor(diffSeconds / RelativeTimeValue.DAY_SECONDS)) + "d ago";
  }
  if (diffSeconds >= RelativeTimeValue.HOUR_SECONDS) {
    return String(Math.floor(diffSeconds / RelativeTimeValue.HOUR_SECONDS)) + "h ago";
  }
  if (diffSeconds >= RelativeTimeValue.MINUTE_SECONDS) {
    return String(Math.floor(diffSeconds / RelativeTimeValue.MINUTE_SECONDS)) + "m ago";
  }
  return String(diffSeconds) + "s ago";
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / RelativeTimeValue.SECOND_MS));
  const minutes = Math.floor(totalSeconds / RelativeTimeValue.MINUTE_SECONDS);
  const seconds = totalSeconds % RelativeTimeValue.MINUTE_SECONDS;
  if (minutes === 0) {
    return String(seconds) + "s";
  }
  return String(minutes) + "m " + String(seconds) + "s";
}

function openExternal(url: string): void {
  window.open(url, "_blank", "noopener");
}
