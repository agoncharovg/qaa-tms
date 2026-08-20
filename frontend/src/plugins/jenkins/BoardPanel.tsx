import { useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
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
import type { JenkinsRootGroup } from "@/api/types";
import {
  JenkinsNodeKind,
  JenkinsStatusColor,
  JenkinsStatusLabel,
  PluginId,
  TabId,
} from "@/constants";
import { BuildHistoryLine } from "@/plugins/jenkins/BuildHistoryLine";
import { getBuildHistoryLineWidth } from "@/plugins/jenkins/buildHistoryLayout";
import { JenkinsFreezeBadge } from "@/plugins/jenkins/JenkinsFreezeBadge";
import { JenkinsResumeProgressModal } from "@/plugins/jenkins/JenkinsResumeProgressModal";
import { useJenkinsStore } from "@/plugins/jenkins/jenkinsStore";
import { countGrayStatuses, countPipelineStatuses, findNodeByPath, flattenPipelines } from "@/plugins/jenkins/treeUtils";
import { useJenkinsFreezes } from "@/plugins/jenkins/useJenkinsFreezes";
import { useJenkinsTree } from "@/plugins/jenkins/useJenkinsTree";
import { useAuthStore } from "@/store/authStore";
import { useUiStore } from "@/store/uiStoreCore";

interface PinnedSection {
  key: string;
  label: string | null;
  paths: string[];
}

interface PinnedSectionDefinition {
  folder: string;
  groupPath: string;
  key: string;
  label: string;
}

const BoardPanelCopy = {
  EMPTY_BODY: "Pin folders or pipelines from the Tree tab to build a focused status board.",
  EMPTY_TITLE: "Nothing is pinned",
  ERROR_GENERIC: "Jenkins data request failed",
  ERROR_NOT_CONFIGURED_BODY:
    "Ask an administrator to configure the shared Jenkins read-only credentials on the backend.",
  ERROR_NOT_CONFIGURED_TITLE: "Shared Jenkins read access is not configured",
  ERROR_UNREACHABLE_BODY: "Confirm Jenkins is reachable from the backend environment.",
  ERROR_UNREACHABLE_TITLE: "Jenkins is unreachable",
  ITEM_MISSING: "This pinned item is no longer available inside the configured Jenkins scope.",
  GRAY: "Gray",
  LOADING: "Loading pinned Jenkins folders.",
  OTHER_TITLE: "Other",
  PINNED_TITLE: "Pinned",
  RUNNING: "Running",
  STUCK: "Stuck",
  SUBTITLE:
    "Each pinned widget counts descendant pipelines recursively, including nested folders, or shows a single pinned pipeline directly.",
  SUCCESS: "Passed",
  FAILED: "Failed",
  UNPIN: "Unpin from board",
} as const;

const BoardPanelValue = {
  FROZEN_BACKGROUND: "var(--mantine-color-cyan-light)",
  FROZEN_BORDER: "var(--mantine-color-cyan-light-color)",
  PIPELINE_META_GAP_PX: 8,
  STATUS_SLOT_PX: 104,
} as const;

export function BoardPanel() {
  const token = useAuthStore((state) => state.token);
  const pinnedPaths = useJenkinsStore((state) => state.pinnedPaths);
  const unpin = useJenkinsStore((state) => state.unpin);
  const isActive = useUiStore((state) => state.tabsByPlugin[PluginId.JENKINS].activeTabId === TabId.JENKINS_BOARD);
  const [expandedPaths, setExpandedPaths] = useState<string[]>([]);
  const treeState = useJenkinsTree({
    agentPort: null,
    enabled: true,
    isActive,
    token,
  });
  const freezesState = useJenkinsFreezes({
    agentPort: null,
    enabled: true,
    isActive,
    signature: treeState.signature,
    token,
  });

  if (pinnedPaths.length === 0) {
    return (
      <>
        <JenkinsResumeProgressModal
          onCancel={() => {
            void freezesState.cancelResumeRun();
          }}
          onClose={freezesState.closeResumeRunSummary}
          run={freezesState.visibleResumeRun}
        />
        <Paper p="xl" radius="lg" withBorder>
          <Stack gap="sm">
            <Title order={3}>{BoardPanelCopy.EMPTY_TITLE}</Title>
            <Text c="dimmed">{BoardPanelCopy.EMPTY_BODY}</Text>
          </Stack>
        </Paper>
      </>
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

  const pinnedSections = buildPinnedSections(pinnedPaths, treeState.rootFolders, treeState.rootGroups);

  const renderPinnedCard = (path: string) => {
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
            <Text c="dimmed" size="sm">
              {BoardPanelCopy.ITEM_MISSING}
            </Text>
          </Stack>
        </Card>
      );
    }

    const counts = countPipelineStatuses(pinnedNode);
    const pipelines = flattenPipelines(pinnedNode);
    const buildHistoryWidth = getBuildHistoryLineWidth(treeState.historyLimit);
    const coveringFreezes = pinnedNode.path ? freezesState.coveringActiveFreezes(pinnedNode.path) : [];
    const frozen = coveringFreezes.length > 0;

    return (
      <Card
        data-frozen={frozen || undefined}
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
        style={{
          backgroundColor: frozen ? BoardPanelValue.FROZEN_BACKGROUND : undefined,
          borderColor: frozen ? BoardPanelValue.FROZEN_BORDER : undefined,
          cursor: "pointer",
        }}
        withBorder
      >
        <Stack gap="md">
          <Group justify="space-between" wrap="nowrap">
            <div>
              <Text fw={600}>{pinnedNode.name}</Text>
              <Text c="dimmed" size="sm">
                {pinnedNode.path}
              </Text>
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
          {pinnedNode.kind === JenkinsNodeKind.FOLDER && coveringFreezes.length > 0 ? (
            <JenkinsFreezeBadge freezes={coveringFreezes} />
          ) : null}
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
                  <Text size="sm" style={{ flex: 1, minWidth: 0 }} truncate="end">
                    {pipeline.name}
                  </Text>
                  <Group
                    gap={BoardPanelValue.PIPELINE_META_GAP_PX}
                    style={{
                      flexShrink: 0,
                      justifyContent: "flex-end",
                      width:
                        buildHistoryWidth +
                        BoardPanelValue.PIPELINE_META_GAP_PX +
                        BoardPanelValue.STATUS_SLOT_PX,
                    }}
                    wrap="nowrap"
                  >
                    <Box
                      style={{
                        display: "flex",
                        justifyContent: "flex-start",
                        width: buildHistoryWidth,
                      }}
                    >
                      {pipeline.builds.length > 0 ? (
                        <BuildHistoryLine
                          builds={[...pipeline.builds].reverse()}
                          slotCount={treeState.historyLimit}
                        />
                      ) : null}
                    </Box>
                    <Box
                      style={{
                        display: "flex",
                        justifyContent: "flex-end",
                        width: BoardPanelValue.STATUS_SLOT_PX,
                      }}
                    >
                      {pipeline.status ? (
                        <Badge color={JenkinsStatusColor[pipeline.status]} variant="light">
                          {JenkinsStatusLabel[pipeline.status]}
                        </Badge>
                      ) : null}
                    </Box>
                  </Group>
                </Group>
              ))}
            </Stack>
          ) : null}
        </Stack>
      </Card>
    );
  };

  return (
    <>
      <JenkinsResumeProgressModal
        onCancel={() => {
          void freezesState.cancelResumeRun();
        }}
        onClose={freezesState.closeResumeRunSummary}
        run={freezesState.visibleResumeRun}
      />
      <Stack gap="lg">
        <div>
          <Title order={3}>{BoardPanelCopy.PINNED_TITLE}</Title>
          <Text c="dimmed" size="sm">
            {BoardPanelCopy.SUBTITLE}
          </Text>
        </div>

        <Stack gap="xl">
          {pinnedSections.map((section) => (
            <section key={section.key}>
              <Stack gap="sm">
                {section.label ? <Title order={4}>{section.label}</Title> : null}
                <SimpleGrid cols={{ base: 1, lg: 2 }}>{section.paths.map((path) => renderPinnedCard(path))}</SimpleGrid>
              </Stack>
            </section>
          ))}
        </Stack>
      </Stack>
    </>
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

function buildPinnedSections(
  pinnedPaths: string[],
  rootFolders: string[],
  rootGroups: JenkinsRootGroup[]
): PinnedSection[] {
  if (rootFolders.length === 0 || rootGroups.length === 0) {
    return [{ key: "all", label: null, paths: [...pinnedPaths] }];
  }

  const definitions = rootFolders.flatMap((folder) =>
    rootGroups.map((group) => ({
      folder,
      groupPath: group.path,
      key: `${folder}:${group.path}`,
      label: `${folder} / ${group.label}`,
    }))
  );
  const pathsBySection = new Map<string, string[]>();
  const uncategorizedPaths: string[] = [];

  for (const path of pinnedPaths) {
    const definition = definitions.find((candidate) => matchesPinnedSection(path, candidate));
    if (!definition) {
      uncategorizedPaths.push(path);
      continue;
    }

    const currentPaths = pathsBySection.get(definition.key) ?? [];
    currentPaths.push(path);
    pathsBySection.set(definition.key, currentPaths);
  }

  const sections = definitions.flatMap((definition) => {
    const paths = pathsBySection.get(definition.key);
    return paths && paths.length > 0 ? [{ key: definition.key, label: definition.label, paths }] : [];
  });

  if (uncategorizedPaths.length > 0) {
    sections.push({ key: "other", label: BoardPanelCopy.OTHER_TITLE, paths: uncategorizedPaths });
  }

  return sections.length > 0 ? sections : [{ key: "all", label: null, paths: [...pinnedPaths] }];
}

function matchesPinnedSection(path: string, definition: PinnedSectionDefinition): boolean {
  const prefix = `${definition.groupPath}/job/${definition.folder}`;
  return path === prefix || path.startsWith(`${prefix}/`);
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
  if (!url) {
    return;
  }
  window.open(url, "_blank", "noopener");
}
