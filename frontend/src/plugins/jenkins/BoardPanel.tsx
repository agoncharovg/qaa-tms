import { useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Card,
  Group,
  Loader,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconAlertCircle, IconPinnedOff } from "@tabler/icons-react";

import { AgentRequestError } from "@/api/agentClient";
import {
  JenkinsStatusColor,
  JenkinsStatusLabel,
  PluginId,
  TabId,
} from "@/constants";
import { useJenkinsStore } from "@/plugins/jenkins/jenkinsStore";
import { countGrayStatuses, countPipelineStatuses, findNodeByPath, flattenPipelines } from "@/plugins/jenkins/treeUtils";
import { useJenkinsTree } from "@/plugins/jenkins/useJenkinsTree";
import { useAuthStore } from "@/store/authStore";
import { useUiStore } from "@/store/uiStoreCore";

interface BoardPanelProps {
  agentPort: number;
}

const BoardPanelCopy = {
  EMPTY_BODY: "Pin folders or pipelines from the Tree tab to build a focused status board.",
  EMPTY_TITLE: "Nothing is pinned",
  ERROR_GENERIC: "Jenkins data request failed",
  ERROR_NOT_CONFIGURED_BODY:
    "Set AGENT_JENKINS_URL, AGENT_JENKINS_USERNAME, and AGENT_JENKINS_TOKEN in the companion app.",
  ERROR_NOT_CONFIGURED_TITLE: "Jenkins is not configured in the companion app",
  ERROR_UNREACHABLE_BODY: "Connect VPN and confirm Jenkins is reachable from this machine.",
  ERROR_UNREACHABLE_TITLE: "Jenkins is unreachable",
  ITEM_MISSING: "This pinned item is no longer available inside the configured .QAA/E2E scope.",
  GRAY: "Gray",
  LOADING: "Loading pinned Jenkins folders.",
  PINNED_TITLE: "Pinned",
  RUNNING: "Running",
  STUCK: "Stuck",
  SUBTITLE:
    "Each pinned widget counts descendant pipelines recursively, including nested folders, or shows a single pinned pipeline directly.",
  SUCCESS: "Passed",
  FAILED: "Failed",
  UNPIN: "Unpin from board",
} as const;

export function BoardPanel({ agentPort }: BoardPanelProps) {
  const token = useAuthStore((state) => state.token);
  const pinnedPaths = useJenkinsStore((state) => state.pinnedPaths);
  const unpin = useJenkinsStore((state) => state.unpin);
  const isActive = useUiStore((state) => state.tabsByPlugin[PluginId.JENKINS].activeTabId === TabId.JENKINS_BOARD);
  const [expandedPaths, setExpandedPaths] = useState<string[]>([]);
  const treeState = useJenkinsTree({
    agentPort,
    enabled: pinnedPaths.length > 0,
    isActive,
    token,
  });

  if (pinnedPaths.length === 0) {
    return (
      <Paper p="xl" radius="lg" withBorder>
        <Stack gap="sm">
          <Title order={3}>{BoardPanelCopy.EMPTY_TITLE}</Title>
          <Text c="dimmed">{BoardPanelCopy.EMPTY_BODY}</Text>
        </Stack>
      </Paper>
    );
  }

  if (treeState.isLoading) {
    return (
      <Stack align="center" gap="md" py="xl">
        <Loader size="lg" />
        <Text c="dimmed">{BoardPanelCopy.LOADING}</Text>
      </Stack>
    );
  }

  if (treeState.error && treeState.roots.length === 0) {
    return renderBoardError(treeState.error);
  }

  return (
    <Stack gap="lg">
      <div>
        <Title order={3}>{BoardPanelCopy.PINNED_TITLE}</Title>
        <Text c="dimmed" size="sm">
          {BoardPanelCopy.SUBTITLE}
        </Text>
      </div>

      <SimpleGrid cols={{ base: 1, lg: 2 }}>
        {pinnedPaths.map((path) => {
          const pinnedNode = findNodeByPath(treeState.roots, path);
          const expanded = expandedPaths.includes(path);

          if (!pinnedNode) {
            return (
              <Card key={path} padding="lg" radius="lg" withBorder>
                <Stack gap="sm">
                  <Group justify="space-between">
                    <Text fw={600}>{path}</Text>
                    <ActionIcon aria-label={BoardPanelCopy.UNPIN} onClick={() => unpin(path)} variant="light">
                      <IconPinnedOff size={16} />
                    </ActionIcon>
                  </Group>
                  <Text c="dimmed" size="sm">{BoardPanelCopy.ITEM_MISSING}</Text>
                </Stack>
              </Card>
            );
          }

          const counts = countPipelineStatuses(pinnedNode);
          const pipelines = flattenPipelines(pinnedNode);

          return (
            <Card
              key={pinnedNode.path}
              onClick={() => {
                setExpandedPaths((currentPaths) =>
                  currentPaths.includes(pinnedNode.path)
                    ? currentPaths.filter((candidate) => candidate !== pinnedNode.path)
                    : [...currentPaths, pinnedNode.path]
                );
              }}
              onDoubleClick={() => openExternal(pinnedNode.url)}
              padding="lg"
              radius="lg"
              style={{ cursor: "pointer" }}
              withBorder
            >
              <Stack gap="md">
                <Group justify="space-between" wrap="nowrap">
                  <div>
                    <Text fw={600}>{pinnedNode.name}</Text>
                    <Text c="dimmed" size="sm">{pinnedNode.path}</Text>
                  </div>
                  <ActionIcon
                    aria-label={BoardPanelCopy.UNPIN}
                    onClick={(event) => {
                      event.stopPropagation();
                      unpin(pinnedNode.path);
                    }}
                    variant="light"
                  >
                    <IconPinnedOff size={16} />
                  </ActionIcon>
                </Group>
                <Group gap="xs">
                  <Badge color="green" variant="light">
                    {BoardPanelCopy.SUCCESS + " " + String(counts.passed)}
                  </Badge>
                  <Badge color="red" variant="light">
                    {BoardPanelCopy.FAILED + " " + String(counts.failed)}
                  </Badge>
                  <Badge color="gray" variant="light">
                    {BoardPanelCopy.GRAY + " " + String(countGrayStatuses(counts))}
                  </Badge>
                  <Badge color="yellow" variant="light">
                    {BoardPanelCopy.STUCK + " " + String(counts.stuck)}
                  </Badge>
                  <Badge color="blue" variant="light">
                    {BoardPanelCopy.RUNNING + " " + String(counts.running)}
                  </Badge>
                </Group>
                {expanded ? (
                  <Stack gap="xs">
                    {pipelines.map((pipeline) => (
                      <Group justify="space-between" key={pipeline.path} wrap="nowrap">
                        <Text size="sm">{pipeline.name}</Text>
                        {pipeline.status ? (
                          <Badge color={JenkinsStatusColor[pipeline.status]} variant="light">
                            {JenkinsStatusLabel[pipeline.status]}
                          </Badge>
                        ) : null}
                      </Group>
                    ))}
                  </Stack>
                ) : null}
              </Stack>
            </Card>
          );
        })}
      </SimpleGrid>
    </Stack>
  );
}

function renderBoardError(error: unknown) {
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
      body: BoardPanelCopy.ERROR_NOT_CONFIGURED_BODY,
      title: BoardPanelCopy.ERROR_NOT_CONFIGURED_TITLE,
    };
  }
  if (error instanceof AgentRequestError && error.status === 502) {
    return {
      body: BoardPanelCopy.ERROR_UNREACHABLE_BODY,
      title: BoardPanelCopy.ERROR_UNREACHABLE_TITLE,
    };
  }
  return {
    body: error instanceof Error ? error.message : BoardPanelCopy.ERROR_GENERIC,
    title: BoardPanelCopy.ERROR_GENERIC,
  };
}

function openExternal(url: string): void {
  window.open(url, "_blank", "noopener");
}
