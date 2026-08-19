import { memo, useCallback, useEffect, useRef, useState } from "react";
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
import type {
  JenkinsBuild,
  JenkinsFreezeRead,
  JenkinsFreezeSnapshotItem,
  JenkinsNode,
} from "@/api/types";
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
import {
  formatDuration,
  formatRelativeAge,
  formatRelativeAgeFromIso,
} from "@/plugins/jenkins/relativeTime";
import { buildJenkinsNodeKey, collectExpandableNodeKeys } from "@/plugins/jenkins/treeUtils";
import { useJenkinsBuilds } from "@/plugins/jenkins/useJenkinsBuilds";
import { useJenkinsFreezes } from "@/plugins/jenkins/useJenkinsFreezes";
import { useJenkinsTree } from "@/plugins/jenkins/useJenkinsTree";
import { useAuthStore } from "@/store/authStore";
import { useUiStore } from "@/store/uiStoreCore";

interface TreePanelProps {
  agentPort: number;
}

interface FreezeModalRequest {
  folderName: string;
  folderPath: string;
  initialMergeFreezeIds: string[];
}

interface ResumeModalRequest {
  folderName: string;
  folderPath: string;
  freeze: JenkinsFreezeRead;
  snapshot: JenkinsFreezeSnapshotItem[];
}

function normalizeJenkinsPath(path: string): string {
  return decodeURIComponent(path).replace(/^\/+|\/+$/g, "");
}

function isSameOrNestedPath(path: string, prefix: string): boolean {
  const normalizedPath = normalizeJenkinsPath(path);
  const normalizedPrefix = normalizeJenkinsPath(prefix);
  return normalizedPath === normalizedPrefix || normalizedPath.startsWith(`${normalizedPrefix}/`);
}

function filterSnapshotForFolder(
  snapshot: JenkinsFreezeSnapshotItem[],
  folderPath: string
): JenkinsFreezeSnapshotItem[] {
  return snapshot.filter((item) => isSameOrNestedPath(item.path, folderPath));
}

interface TreeNodeRowProps {
  activeFreezeForPath: (path: string) => JenkinsFreezeRead | null;
  agentPort: number;
  coveringActiveFreezes: (path: string) => JenkinsFreezeRead[];
  depth: number;
  expandedNodeKeys: string[];
  freezesByFolderPath: Map<string, JenkinsFreezeRead>;
  historyLimit: number | null;
  isActive: boolean;
  isLocked: boolean;
  isMutatingPath: (path: string) => boolean;
  node: JenkinsNode;
  nodeKey: string;
  onFreezeRequest: (folderPath: string, folderName: string) => void;
  onPinToggle: (path: string) => void;
  onResumeRequest: (freeze: JenkinsFreezeRead, folderPath: string, folderName: string) => void;
  onToggle: (nodeKey: string) => void;
  pinnedPaths: string[];
  signature: string | null;
  token: string | null;
}

interface JenkinsTreeRowsProps {
  activeFreezeForPath: (path: string) => JenkinsFreezeRead | null;
  agentPort: number;
  coveringActiveFreezes: (path: string) => JenkinsFreezeRead[];
  expandedNodeKeys: string[];
  freezesByFolderPath: Map<string, JenkinsFreezeRead>;
  historyLimit: number | null;
  isActive: boolean;
  isLocked: boolean;
  isMutatingPath: (path: string) => boolean;
  onFreezeRequest: (folderPath: string, folderName: string) => void;
  onPinToggle: (path: string) => void;
  onResumeRequest: (freeze: JenkinsFreezeRead, folderPath: string, folderName: string) => void;
  onToggle: (nodeKey: string) => void;
  pinnedPaths: string[];
  roots: JenkinsNode[];
  signature: string | null;
  token: string | null;
}

const TreePanelCopy = {
  BUILDS_EMPTY: "No recent builds were returned.",
  EMPTY_BODY: "No Jenkins folders were returned for the configured Jenkins scope.",
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
    "Browse the live Jenkins tree for the configured grouped scope, expand pipelines for recent builds, and pin folders or pipelines for the board.",
  TITLE: "Tree",
  UNPIN: "Unpin from board",
} as const;

const TreePanelValue = {
  FREEZE_SLOT_PX: 36,
  FROZEN_BACKGROUND: "var(--mantine-color-cyan-light)",
  FROZEN_BORDER: "var(--mantine-color-cyan-light-color)",
  INDENT_STEP_PX: 24,
  LEFT_BORDER_PX: 2,
  PIPELINE_META_GAP_PX: 8,
  PIN_SLOT_PX: 36,
  STATUS_SLOT_PX: 104,
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
  const [expandedNodeKeys, setExpandedNodeKeys] = useState<string[]>([]);
  const [freezeModal, setFreezeModal] = useState<FreezeModalRequest | null>(null);
  const [resumeModal, setResumeModal] = useState<ResumeModalRequest | null>(null);
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

  // Auto-expand the roots once, when the tree first loads. Keyed on a ref (not on
  // expandedNodeKeys being empty) so "Collapse All" is not immediately undone.
  const didInitialExpandRef = useRef(false);
  useEffect(() => {
    if (didInitialExpandRef.current || treeState.roots.length === 0) {
      return;
    }
    didInitialExpandRef.current = true;
    setExpandedNodeKeys(treeState.roots.map((root) => buildJenkinsNodeKey(root)));
  }, [treeState.roots]);

  useEffect(() => {
    if (!freezesState.isLocked) {
      return;
    }
    setFreezeModal(null);
    setResumeModal(null);
  }, [freezesState.isLocked]);

  const openFreezeModal = useCallback(
    (folderPath: string, folderName: string): void => {
      const initialMergeFreezeIds = freezesState
        .absorbableActiveFreezes(folderPath)
        .filter((freeze) => freeze.createdBy === currentUser?.username)
        .map((freeze) => freeze.id);
      setFreezeModal({
        folderName,
        folderPath,
        initialMergeFreezeIds,
      });
    },
    [currentUser?.username, freezesState.absorbableActiveFreezes]
  );

  const openResumeModal = useCallback(
    (freeze: JenkinsFreezeRead, folderPath: string, folderName: string): void => {
      setResumeModal({
        freeze,
        folderName,
        folderPath,
        snapshot: filterSnapshotForFolder(freeze.snapshot, folderPath),
      });
    },
    []
  );

  const togglePinnedPath = useCallback(
    (path: string): void => {
      if (pinnedPaths.includes(path)) {
        unpin(path);
        return;
      }
      pin(path);
    },
    [pin, pinnedPaths, unpin]
  );

  const toggleNode = useCallback((nextNodeKey: string): void => {
    setExpandedNodeKeys((currentKeys) =>
      currentKeys.includes(nextNodeKey)
        ? currentKeys.filter((candidate) => candidate !== nextNodeKey)
        : [...currentKeys, nextNodeKey]
    );
  }, []);

  const expandAllNodes = useCallback(() => {
    setExpandedNodeKeys(collectExpandableNodeKeys(treeState.roots));
  }, [treeState.roots]);

  const collapseAllNodes = useCallback(() => {
    setExpandedNodeKeys([]);
  }, []);

  const submitResumeModal = useCallback(
    async (restartPipelines: boolean): Promise<void> => {
      if (!resumeModal) {
        return;
      }

      try {
        await freezesState.startResumeCampaign(
          resumeModal.freeze,
          resumeModal.snapshot,
          restartPipelines,
          resumeModal.folderPath
        );
        setResumeModal(null);
      } catch {
        // Keep the modal open so the operator can retry.
      }
    },
    [freezesState.startResumeCampaign, resumeModal]
  );

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
      {freezeModal ? (
        <FreezeFolderModal
          freeze={freezeModal}
          intersectingFreezes={freezesState.absorbableActiveFreezes(freezeModal.folderPath)}
          isLocked={freezesState.isLocked}
          isMutating={freezesState.isMutatingPath(freezeModal.folderPath)}
          onClose={() => setFreezeModal(null)}
          onSubmit={async ({ killBuilds, mergeFreezeIds, reason }) => {
            try {
              await freezesState.freezeFolder({
                folderName: freezeModal.folderName,
                folderPath: freezeModal.folderPath,
                killBuilds,
                mergeFreezeIds,
                reason,
              });
              setFreezeModal(null);
            } catch {
              // Keep the modal open so the operator can retry or adjust the request.
            }
          }}
        />
      ) : null}

      {resumeModal ? (
        <ResumeFolderModal
          isLocked={freezesState.isLocked}
          isMutating={freezesState.isMutatingPath(resumeModal.folderPath)}
          onClose={() => setResumeModal(null)}
          onSubmit={submitResumeModal}
          resume={resumeModal}
        />
      ) : null}

      <Stack gap="lg">
        <Group justify="space-between" wrap="wrap">
          <div>
            <Title order={3}>{TreePanelCopy.TITLE}</Title>
            <Text c="dimmed" size="sm">
              {TreePanelCopy.SUBTITLE}
            </Text>
          </div>
          <Group>
            <Button leftSection={<IconMaximize size={16} />} onClick={expandAllNodes} variant="light">
              {TreePanelCopy.EXPAND_ALL}
            </Button>
            <Button leftSection={<IconMinimize size={16} />} onClick={collapseAllNodes} variant="light">
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

        <JenkinsTreeRows
          activeFreezeForPath={freezesState.activeFreezeForPath}
          agentPort={agentPort}
          coveringActiveFreezes={freezesState.coveringActiveFreezes}
          expandedNodeKeys={expandedNodeKeys}
          freezesByFolderPath={freezesState.freezesByFolderPath}
          historyLimit={treeState.historyLimit}
          isActive={isActive}
          isLocked={freezesState.isLocked}
          isMutatingPath={freezesState.isMutatingPath}
          onFreezeRequest={openFreezeModal}
          onPinToggle={togglePinnedPath}
          onResumeRequest={openResumeModal}
          onToggle={toggleNode}
          pinnedPaths={pinnedPaths}
          roots={treeState.roots}
          signature={treeState.signature}
          token={token}
        />
      </Stack>
    </>
  );
}

const JenkinsTreeRows = memo(function JenkinsTreeRows({
  activeFreezeForPath,
  agentPort,
  coveringActiveFreezes,
  expandedNodeKeys,
  freezesByFolderPath,
  historyLimit,
  isActive,
  isLocked,
  isMutatingPath,
  onFreezeRequest,
  onPinToggle,
  onResumeRequest,
  onToggle,
  pinnedPaths,
  roots,
  signature,
  token,
}: JenkinsTreeRowsProps) {
  return (
    <Stack gap="xs">
      {roots.map((node) => {
        const nodeKey = buildJenkinsNodeKey(node);
        return (
          <TreeNodeRow
            key={nodeKey}
            activeFreezeForPath={activeFreezeForPath}
            agentPort={agentPort}
            coveringActiveFreezes={coveringActiveFreezes}
            depth={0}
            expandedNodeKeys={expandedNodeKeys}
            freezesByFolderPath={freezesByFolderPath}
            historyLimit={historyLimit}
            isActive={isActive}
            isLocked={isLocked}
            isMutatingPath={isMutatingPath}
            node={node}
            nodeKey={nodeKey}
            onFreezeRequest={onFreezeRequest}
            onPinToggle={onPinToggle}
            onResumeRequest={onResumeRequest}
            onToggle={onToggle}
            pinnedPaths={pinnedPaths}
            signature={signature}
            token={token}
          />
        );
      })}
    </Stack>
  );
});

interface FreezeFolderModalProps {
  freeze: FreezeModalRequest;
  intersectingFreezes: JenkinsFreezeRead[];
  isLocked: boolean;
  isMutating: boolean;
  onClose: () => void;
  onSubmit: (args: {
    killBuilds: boolean;
    mergeFreezeIds: string[];
    reason: string;
  }) => Promise<void>;
}

function FreezeFolderModal({
  freeze,
  intersectingFreezes,
  isLocked,
  isMutating,
  onClose,
  onSubmit,
}: FreezeFolderModalProps) {
  const [reason, setReason] = useState("");
  const [killBuilds, setKillBuilds] = useState(false);
  const [mergeFreezeIds, setMergeFreezeIds] = useState<string[]>(freeze.initialMergeFreezeIds);
  const trimmedReason = reason.trim();

  return (
    <Modal centered opened onClose={onClose} title={JenkinsFreezeCopy.FREEZE_TITLE}>
      <Stack gap="md">
        <Textarea
          autosize
          error={trimmedReason.length > 0 ? null : JenkinsFreezeCopy.FREEZE_REASON_REQUIRED}
          label={JenkinsFreezeCopy.FREEZE_REASON_LABEL}
          minRows={3}
          onChange={(event) => setReason(event.currentTarget.value)}
          placeholder={JenkinsFreezeCopy.FREEZE_REASON_PLACEHOLDER}
          value={reason}
        />
        <Checkbox
          checked={killBuilds}
          label={JenkinsFreezeCopy.FREEZE_KILL_BUILDS}
          onChange={(event) => setKillBuilds(event.currentTarget.checked)}
        />
        {intersectingFreezes.length > 0 ? (
          <Stack gap="xs">
            <Text fw={600} size="sm">
              {JenkinsFreezeCopy.FREEZE_MERGE_TITLE}
            </Text>
            <Text c="dimmed" size="sm">
              {JenkinsFreezeCopy.FREEZE_MERGE_DESCRIPTION}
            </Text>
            {intersectingFreezes.map((intersectingFreeze) => (
              <Checkbox
                checked={mergeFreezeIds.includes(intersectingFreeze.id)}
                key={intersectingFreeze.id}
                label={`${intersectingFreeze.folderName} · ${intersectingFreeze.createdBy} · ${formatRelativeAgeFromIso(
                  intersectingFreeze.createdAt
                )}`}
                onChange={(event) => {
                  const { checked } = event.currentTarget;
                  setMergeFreezeIds((currentIds) =>
                    checked
                      ? [...currentIds, intersectingFreeze.id]
                      : currentIds.filter((id) => id !== intersectingFreeze.id)
                  );
                }}
              />
            ))}
          </Stack>
        ) : null}
        <Group justify="flex-end">
          <Button onClick={onClose} variant="default">
            {JenkinsFreezeCopy.FREEZE_CANCEL}
          </Button>
          <Button
            disabled={isLocked}
            loading={isMutating}
            onClick={() => {
              if (trimmedReason.length === 0) {
                return;
              }

              const availableFreezeIds = new Set(
                intersectingFreezes.map((intersectingFreeze) => intersectingFreeze.id)
              );
              void onSubmit({
                killBuilds,
                mergeFreezeIds: mergeFreezeIds.filter((id) => availableFreezeIds.has(id)),
                reason: trimmedReason,
              });
            }}
          >
            {JenkinsFreezeCopy.FREEZE_CONFIRM}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

interface ResumeFolderModalProps {
  isLocked: boolean;
  isMutating: boolean;
  onClose: () => void;
  onSubmit: (restartPipelines: boolean) => Promise<void>;
  resume: ResumeModalRequest;
}

function ResumeFolderModal({ isLocked, isMutating, onClose, onSubmit, resume }: ResumeFolderModalProps) {
  const [restartPipelines, setRestartPipelines] = useState(true);
  const restorableItems = resume.snapshot.filter((item) => !item.wasDisabled);
  const resumeBuildCount = restorableItems.filter((item) => !item.scheduled).length;
  const resumeScheduledCount = restorableItems.length - resumeBuildCount;

  return (
    <Modal centered opened onClose={onClose} title={JenkinsFreezeCopy.RESUME_CONFIRM_TITLE}>
      <Stack gap="md">
        <Text size="sm">
          {JenkinsFreezeCopy.RESUME_CONFIRM_MESSAGE.replace("{restore}", String(restorableItems.length))
            .replace("{folder}", resume.folderName)
            .replace("{build}", String(resumeBuildCount))
            .replace("{scheduled}", String(resumeScheduledCount))}
        </Text>
        <Checkbox
          checked={restartPipelines}
          label={JenkinsFreezeCopy.RESUME_RESTART_PIPELINES}
          onChange={(event) => setRestartPipelines(event.currentTarget.checked)}
        />
        <Group justify="flex-end">
          <Button onClick={onClose} variant="default">
            {JenkinsFreezeCopy.FREEZE_CANCEL}
          </Button>
          <Button
            color="green"
            disabled={isLocked}
            loading={isMutating}
            onClick={() => void onSubmit(restartPipelines)}
          >
            {JenkinsFreezeCopy.RESUME_CONFIRM}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function TreeNodeRow({
  activeFreezeForPath,
  agentPort,
  coveringActiveFreezes,
  depth,
  expandedNodeKeys,
  freezesByFolderPath,
  historyLimit,
  isActive,
  isLocked,
  isMutatingPath,
  node,
  nodeKey,
  onFreezeRequest,
  onPinToggle,
  onResumeRequest,
  onToggle,
  pinnedPaths,
  signature,
  token,
}: TreeNodeRowProps) {
  const expanded = expandedNodeKeys.includes(nodeKey);
  const pinned = Boolean(node.path) && pinnedPaths.includes(node.path);
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
  const freezableNode = Boolean(node.path) && !node.synthetic;
  const actionableFolder = node.kind === JenkinsNodeKind.FOLDER && !node.synthetic;
  const exactFreeze = actionableFolder ? freezesByFolderPath.get(normalizeJenkinsPath(node.path)) ?? null : null;
  const resumeFreeze = actionableFolder ? activeFreezeForPath(node.path) : null;
  const coveringFreezes = freezableNode ? coveringActiveFreezes(node.path) : [];
  const frozen = coveringFreezes.length > 0;
  const loadingFreezeState = actionableFolder && isMutatingPath(resumeFreeze?.folderPath ?? node.path);

  return (
    <Stack gap="xs">
      <Paper
        data-frozen={frozen || undefined}
        onClick={() => onToggle(nodeKey)}
        onDoubleClick={() => openExternal(node.url)}
        p="sm"
        radius="md"
        style={{
          backgroundColor: frozen ? TreePanelValue.FROZEN_BACKGROUND : undefined,
          borderColor: frozen ? TreePanelValue.FROZEN_BORDER : undefined,
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
            {actionableFolder ? (
              <Tooltip label={resumeFreeze ? JenkinsFreezeCopy.RESUME_ACTION : JenkinsFreezeCopy.FREEZE_ACTION}>
                <ActionIcon
                  aria-label={resumeFreeze ? JenkinsFreezeCopy.RESUME_ACTION : JenkinsFreezeCopy.FREEZE_ACTION}
                  color={resumeFreeze ? "green" : "cyan"}
                  disabled={isLocked}
                  loading={loadingFreezeState}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (resumeFreeze) {
                      onResumeRequest(resumeFreeze, node.path, node.name);
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
                  {resumeFreeze ? <IconPlayerPlay size={16} /> : <IconSnowflake size={16} />}
                </ActionIcon>
              </Tooltip>
            ) : null}
            {!node.synthetic ? (
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
            ) : null}
          </Group>
        </Group>
      </Paper>

      {node.kind === JenkinsNodeKind.FOLDER ? (
        <Collapse in={expanded}>
          <Stack gap="xs">
            {node.children.map((child) => {
              const childNodeKey = buildJenkinsNodeKey(child, nodeKey);
              return (
                <TreeNodeRow
                  key={childNodeKey}
                  activeFreezeForPath={activeFreezeForPath}
                  agentPort={agentPort}
                  coveringActiveFreezes={coveringActiveFreezes}
                  depth={depth + 1}
                  expandedNodeKeys={expandedNodeKeys}
                  freezesByFolderPath={freezesByFolderPath}
                  historyLimit={historyLimit}
                  isActive={isActive}
                  isLocked={isLocked}
                  isMutatingPath={isMutatingPath}
                  node={child}
                  nodeKey={childNodeKey}
                  onFreezeRequest={onFreezeRequest}
                  onPinToggle={onPinToggle}
                  onResumeRequest={onResumeRequest}
                  onToggle={onToggle}
                  pinnedPaths={pinnedPaths}
                  signature={signature}
                  token={token}
                />
              );
            })}
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

function openExternal(url: string): void {
  if (!url) {
    return;
  }
  window.open(url, "_blank", "noopener");
}
