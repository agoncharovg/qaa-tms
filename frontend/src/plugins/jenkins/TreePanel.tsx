import { useEffect, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  Collapse,
  Group,
  Loader,
  Modal,
  Paper,
  Stack,
  Text,
  Textarea,
  ThemeIcon,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconChevronDown,
  IconChevronRight,
  IconClock,
  IconFolder,
  IconGitBranch,
  IconMaximize,
  IconMinimize,
  IconPin,
  IconPinnedOff,
  IconPlayerPlay,
  IconRefresh,
  IconSnowflake,
} from "@tabler/icons-react";

import { AgentRequestError } from "@/api/agentClient";
import type { JenkinsBuild, JenkinsFreezeRead, JenkinsNode } from "@/api/types";
import {
  JenkinsFreezeCopy,
  JenkinsNodeKind,
  JenkinsStatusColor,
  JenkinsStatusLabel,
  PluginId,
  TabId,
} from "@/constants";
import { BuildHistoryLine } from "@/plugins/jenkins/BuildHistoryLine";
import { getBuildColor, getBuildLabel } from "@/plugins/jenkins/buildStatus";
import { getBuildHistoryLineWidth } from "@/plugins/jenkins/buildHistoryLayout";
import { JenkinsFreezeBadge } from "@/plugins/jenkins/JenkinsFreezeBadge";
import { JenkinsResumeProgressModal } from "@/plugins/jenkins/JenkinsResumeProgressModal";
import { useJenkinsStore } from "@/plugins/jenkins/jenkinsStore";
import { formatRelativeAge, formatRelativeAgeFromIso } from "@/plugins/jenkins/relativeTime";
import { collectExpandableNodePaths } from "@/plugins/jenkins/treeUtils";
import { useJenkinsBuilds } from "@/plugins/jenkins/useJenkinsBuilds";
import { useJenkinsFreezes } from "@/plugins/jenkins/useJenkinsFreezes";
import { useJenkinsTree } from "@/plugins/jenkins/useJenkinsTree";
import { useAuthStore } from "@/store/authStore";
import { useUiStore } from "@/store/uiStoreCore";

interface TreePanelProps {
  agentPort: number;
}

interface FreezeModalState {
  folderName: string;
  folderPath: string;
  killBuilds: boolean;
  mergeFreezeIds: string[];
  reason: string;
}

interface TreeNodeRowProps {
  agentPort: number;
  coveringActiveFreezes: (path: string) => JenkinsFreezeRead[];
  depth: number;
  expandedPaths: string[];
  freezesByFolderPath: Map<string, JenkinsFreezeRead>;
  historyLimit: number | null;
  isActive: boolean;
  isLocked: boolean;
  isMutatingPath: (path: string) => boolean;
  node: JenkinsNode;
  onFreezeRequest: (folderPath: string, folderName: string) => void;
  onPinToggle: (path: string) => void;
  onResumeRequest: (freeze: JenkinsFreezeRead) => void;
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
  SCHEDULED: "Runs on a schedule",
  SUBTITLE:
    "Browse the live Jenkins tree for the configured .QAA/E2E roots, expand pipelines for recent builds, and pin folders or pipelines for the board.",
  TITLE: "Tree",
  UNPIN: "Unpin from board",
} as const;

const TreePanelValue = {
  FREEZE_SLOT_PX: 36,
  INDENT_STEP_PX: 24,
  LEFT_BORDER_PX: 2,
  PIPELINE_META_GAP_PX: 8,
  PIN_SLOT_PX: 36,
  STATUS_SLOT_PX: 104,
} as const;

const RelativeTimeValue = {
  MINUTE_SECONDS: 60,
  SECOND_MS: 1000,
} as const;

export function TreePanel({ agentPort }: TreePanelProps) {
  const token = useAuthStore((state) => state.token);
  const currentUser = useAuthStore((state) => state.currentUser);
  const pinnedPaths = useJenkinsStore((state) => state.pinnedPaths);
  const pin = useJenkinsStore((state) => state.pin);
  const unpin = useJenkinsStore((state) => state.unpin);
  const isActive = useUiStore(
    (state) => state.tabsByPlugin[PluginId.JENKINS].activeTabId === TabId.JENKINS_TREE
  );
  const [expandedPaths, setExpandedPaths] = useState<string[]>([]);
  const [freezeModal, setFreezeModal] = useState<FreezeModalState | null>(null);
  const [resumeModal, setResumeModal] = useState<JenkinsFreezeRead | null>(null);
  const treeState = useJenkinsTree({
    agentPort,
    enabled: true,
    isActive,
    token,
  });
  const freezesState = useJenkinsFreezes({
    agentPort,
    enabled: true,
    isActive,
    signature: treeState.signature,
    token,
  });

  useEffect(() => {
    if (expandedPaths.length > 0 || treeState.roots.length === 0) {
      return;
    }
    setExpandedPaths(treeState.roots.map((root) => root.path));
  }, [expandedPaths.length, treeState.roots]);

  useEffect(() => {
    if (!freezesState.isLocked) {
      return;
    }
    setFreezeModal(null);
    setResumeModal(null);
  }, [freezesState.isLocked]);

  const intersectingFreezes = freezeModal
    ? freezesState.absorbableActiveFreezes(freezeModal.folderPath)
    : [];
  const freezeReason = freezeModal?.reason.trim() ?? "";

  function openFreezeModal(folderPath: string, folderName: string): void {
    const mergeFreezeIds = freezesState
      .absorbableActiveFreezes(folderPath)
      .filter((freeze) => freeze.createdBy === currentUser?.username)
      .map((freeze) => freeze.id);
    setFreezeModal({
      folderName,
      folderPath,
      killBuilds: false,
      mergeFreezeIds,
      reason: "",
    });
  }

  async function submitFreezeModal(): Promise<void> {
    if (!freezeModal || freezeReason.length === 0) {
      return;
    }

    try {
      await freezesState.freezeFolder({
        folderName: freezeModal.folderName,
        folderPath: freezeModal.folderPath,
        killBuilds: freezeModal.killBuilds,
        mergeFreezeIds: freezeModal.mergeFreezeIds,
        reason: freezeReason,
      });
      setFreezeModal(null);
    } catch {
      // Keep the modal open so the operator can retry or adjust the request.
    }
  }

  const resumeRestorable = resumeModal?.snapshot.filter((item) => !item.wasDisabled) ?? [];
  const resumeBuildCount = resumeRestorable.filter((item) => !item.scheduled).length;
  const resumeScheduledCount = resumeRestorable.length - resumeBuildCount;

  async function submitResumeModal(): Promise<void> {
    if (!resumeModal) {
      return;
    }

    try {
      await freezesState.startResumeCampaign(resumeModal);
      setResumeModal(null);
    } catch {
      // Keep the modal open so the operator can retry.
    }
  }

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
    <>
      <JenkinsResumeProgressModal
        onCancel={() => {
          void freezesState.cancelResumeRun();
        }}
        onClose={freezesState.closeResumeRunSummary}
        run={freezesState.visibleResumeRun}
      />
      <Modal
        centered
        opened={freezeModal !== null}
        onClose={() => setFreezeModal(null)}
        title={JenkinsFreezeCopy.FREEZE_TITLE}
      >
        <Stack gap="md">
          <Textarea
            autosize
            error={freezeReason.length > 0 ? null : JenkinsFreezeCopy.FREEZE_REASON_REQUIRED}
            label={JenkinsFreezeCopy.FREEZE_REASON_LABEL}
            minRows={3}
            onChange={(event) => {
              const { value } = event.currentTarget;
              setFreezeModal((current) => (current ? { ...current, reason: value } : current));
            }}
            placeholder={JenkinsFreezeCopy.FREEZE_REASON_PLACEHOLDER}
            value={freezeModal?.reason ?? ""}
          />
          <Checkbox
            checked={freezeModal?.killBuilds ?? false}
            label={JenkinsFreezeCopy.FREEZE_KILL_BUILDS}
            onChange={(event) => {
              const { checked } = event.currentTarget;
              setFreezeModal((current) =>
                current ? { ...current, killBuilds: checked } : current
              );
            }}
          />
          {intersectingFreezes.length > 0 ? (
            <Stack gap="xs">
              <Text fw={600} size="sm">
                {JenkinsFreezeCopy.FREEZE_MERGE_TITLE}
              </Text>
              <Text c="dimmed" size="sm">
                {JenkinsFreezeCopy.FREEZE_MERGE_DESCRIPTION}
              </Text>
              {intersectingFreezes.map((freeze) => (
                <Checkbox
                  checked={freezeModal?.mergeFreezeIds.includes(freeze.id) ?? false}
                  key={freeze.id}
                  label={`${freeze.folderName} · ${freeze.createdBy} · ${formatRelativeAgeFromIso(
                    freeze.createdAt
                  )}`}
                  onChange={(event) => {
                    const { checked } = event.currentTarget;
                    setFreezeModal((current) => {
                      if (!current) {
                        return current;
                      }
                      return {
                        ...current,
                        mergeFreezeIds: checked
                          ? [...current.mergeFreezeIds, freeze.id]
                          : current.mergeFreezeIds.filter((id) => id !== freeze.id),
                      };
                    });
                  }}
                />
              ))}
            </Stack>
          ) : null}
          <Group justify="flex-end">
            <Button onClick={() => setFreezeModal(null)} variant="default">
              {JenkinsFreezeCopy.FREEZE_CANCEL}
            </Button>
            <Button
              disabled={freezesState.isLocked}
              loading={freezeModal ? freezesState.isMutatingPath(freezeModal.folderPath) : false}
              onClick={() => void submitFreezeModal()}
            >
              {JenkinsFreezeCopy.FREEZE_CONFIRM}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        centered
        onClose={() => setResumeModal(null)}
        opened={resumeModal !== null}
        title={JenkinsFreezeCopy.RESUME_CONFIRM_TITLE}
      >
        <Stack gap="md">
          <Text size="sm">
            {JenkinsFreezeCopy.RESUME_CONFIRM_MESSAGE.replace(
              "{restore}",
              String(resumeRestorable.length)
            )
              .replace("{folder}", resumeModal?.folderName ?? "")
              .replace("{build}", String(resumeBuildCount))
              .replace("{scheduled}", String(resumeScheduledCount))}
          </Text>
          <Group justify="flex-end">
            <Button onClick={() => setResumeModal(null)} variant="default">
              {JenkinsFreezeCopy.FREEZE_CANCEL}
            </Button>
            <Button
              color="green"
              disabled={freezesState.isLocked}
              loading={resumeModal ? freezesState.isMutatingPath(resumeModal.folderPath) : false}
              onClick={() => void submitResumeModal()}
            >
              {JenkinsFreezeCopy.RESUME_CONFIRM}
            </Button>
          </Group>
        </Stack>
      </Modal>

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
              coveringActiveFreezes={freezesState.coveringActiveFreezes}
              depth={0}
              expandedPaths={expandedPaths}
              freezesByFolderPath={freezesState.freezesByFolderPath}
              historyLimit={treeState.historyLimit}
              isActive={isActive}
              isLocked={freezesState.isLocked}
              isMutatingPath={freezesState.isMutatingPath}
              node={node}
              onFreezeRequest={openFreezeModal}
              onPinToggle={(path) => {
                if (pinnedPaths.includes(path)) {
                  unpin(path);
                  return;
                }
                pin(path);
              }}
              onResumeRequest={setResumeModal}
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
    </>
  );
}

function TreeNodeRow({
  agentPort,
  coveringActiveFreezes,
  depth,
  expandedPaths,
  freezesByFolderPath,
  historyLimit,
  isActive,
  isLocked,
  isMutatingPath,
  node,
  onFreezeRequest,
  onPinToggle,
  onResumeRequest,
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
  const scheduledPipeline = node.kind === JenkinsNodeKind.PIPELINE && node.scheduled;
  const kindIconLabel =
    node.kind === JenkinsNodeKind.FOLDER
      ? TreePanelCopy.NODE_KIND_FOLDER
      : scheduledPipeline
        ? TreePanelCopy.SCHEDULED
        : TreePanelCopy.NODE_KIND_PIPELINE;
  const kindIconColor =
    node.kind === JenkinsNodeKind.FOLDER ? "gray" : scheduledPipeline ? "grape" : "cyan";
  const exactFreeze =
    node.kind === JenkinsNodeKind.FOLDER ? freezesByFolderPath.get(node.path) ?? null : null;
  const coveringFreezes =
    node.kind === JenkinsNodeKind.FOLDER ? coveringActiveFreezes(node.path) : [];
  const loadingFreezeState = node.kind === JenkinsNodeKind.FOLDER && isMutatingPath(node.path);

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
            <ActionIcon
              aria-label={expanded ? TreePanelCopy.COLLAPSE_ALL : TreePanelCopy.EXPAND_ALL}
              variant="subtle"
            >
              {expanded ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
            </ActionIcon>
            <Tooltip label={kindIconLabel}>
              <ThemeIcon
                aria-label={kindIconLabel}
                color={kindIconColor}
                radius="xl"
                role="img"
                size="md"
                variant="light"
              >
                {node.kind === JenkinsNodeKind.FOLDER ? (
                  <IconFolder size={14} />
                ) : scheduledPipeline ? (
                  <IconClock size={14} />
                ) : (
                  <IconGitBranch size={14} />
                )}
              </ThemeIcon>
            </Tooltip>
            <Text fw={500} truncate="end">
              {node.name}
            </Text>
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
            {node.kind === JenkinsNodeKind.FOLDER && coveringFreezes.length > 0 ? (
              <JenkinsFreezeBadge freezes={coveringFreezes} />
            ) : null}
            {node.kind === JenkinsNodeKind.FOLDER ? (
              <Tooltip label={exactFreeze ? JenkinsFreezeCopy.RESUME_ACTION : JenkinsFreezeCopy.FREEZE_ACTION}>
                <ActionIcon
                  aria-label={exactFreeze ? JenkinsFreezeCopy.RESUME_ACTION : JenkinsFreezeCopy.FREEZE_ACTION}
                  color={exactFreeze ? "green" : "cyan"}
                  disabled={isLocked}
                  loading={loadingFreezeState}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (exactFreeze) {
                      onResumeRequest(exactFreeze);
                      return;
                    }
                    onFreezeRequest(node.path, node.name);
                  }}
                  style={{
                    flex: "0 0 auto",
                    width: TreePanelValue.FREEZE_SLOT_PX,
                  }}
                  variant="light"
                >
                  {exactFreeze ? <IconPlayerPlay size={16} /> : <IconSnowflake size={16} />}
                </ActionIcon>
              </Tooltip>
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
                coveringActiveFreezes={coveringActiveFreezes}
                depth={depth + 1}
                expandedPaths={expandedPaths}
                freezesByFolderPath={freezesByFolderPath}
                historyLimit={historyLimit}
                isActive={isActive}
                isLocked={isLocked}
                isMutatingPath={isMutatingPath}
                node={child}
                onFreezeRequest={onFreezeRequest}
                onPinToggle={onPinToggle}
                onResumeRequest={onResumeRequest}
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
              borderLeft: `${TreePanelValue.LEFT_BORDER_PX}px solid var(--mantine-color-dark-4)`,
              marginLeft: (depth + 1) * TreePanelValue.INDENT_STEP_PX,
            }}
            withBorder
          >
            {buildsState.isLoading && expandedBuilds.length === 0 ? (
              <Group gap="sm">
                <Loader size="sm" />
                <Text c="dimmed" size="sm">
                  {TreePanelCopy.LOADING_BUILDS}
                </Text>
              </Group>
            ) : null}
            {buildsState.error && expandedBuilds.length === 0 ? (
              <Text c="red" size="sm">
                {buildsState.error instanceof Error ? buildsState.error.message : TreePanelCopy.ERROR_GENERIC}
              </Text>
            ) : null}
            {expandedBuilds.length === 0 && !buildsState.isLoading && !buildsState.isRefreshing ? (
              <Text c="dimmed" size="sm">
                {TreePanelCopy.BUILDS_EMPTY}
              </Text>
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
            <Text fw={500}>{`#${String(build.number)}`}</Text>
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

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / RelativeTimeValue.SECOND_MS));
  const minutes = Math.floor(totalSeconds / RelativeTimeValue.MINUTE_SECONDS);
  const seconds = totalSeconds % RelativeTimeValue.MINUTE_SECONDS;
  if (minutes === 0) {
    return `${seconds}s`;
  }
  return `${minutes}m ${seconds}s`;
}

function openExternal(url: string): void {
  window.open(url, "_blank", "noopener");
}
