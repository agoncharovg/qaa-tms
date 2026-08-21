import { useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Group,
  Loader,
  SegmentedControl,
  Stack,
  Text,
} from "@mantine/core";
import { IconAlertCircle, IconExternalLink, IconRefresh } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";

import { discoverAgent } from "@/api/agentClient";
import { usePalette } from "@/app/theme/usePalette";
import { DEFAULT_SMOKE_FOLDER_PATH, QueryKey, SMOKE_REFRESH_OPTIONS_MS } from "@/constants";
import { countPipelineStatuses, countGrayStatuses } from "@/plugins/jenkins/treeUtils";
import { useAuthStore } from "@/store/authStore";
import { SmokeTimelineRow, SmokeTimelineRowValue } from "@/plugins/statistics/SmokeTimelineRow";
import {
  readStoredSmokeRefreshMs,
  writeStoredSmokeRefreshMs,
} from "@/plugins/statistics/smokeRefreshStorage";
import {
  collectSmokePipelines,
  computeSmokeAxisTicks,
  computeSmokeRows,
  computeSmokeWindow,
} from "@/plugins/statistics/smokeTimeline";
import { useSmokeFolder } from "@/plugins/statistics/useSmokeFolder";

const SmokePanelCopy = {
  COMPANION_REQUIRED: "Cache is warming up. Start the companion app to populate SMOKE.",
  ERROR_BODY: "The shared Jenkins cache could not read the SMOKE folder. Retry shortly.",
  ERROR_TITLE: "Could not load the SMOKE folder",
  EMPTY: "No pipelines found in this folder.",
  LOADING: "Loading SMOKE pipelines…",
  OPEN_JENKINS: "Open in Jenkins",
  REFRESH: "Refresh now",
  REFRESH_LABEL: "Auto-refresh",
  TITLE: "E2E preprod tests SMOKE",
  WARMING: "Warming shared SMOKE cache…",
} as const;

const SmokePanelValue = {
  AXIS_TICKS: 6,
  MINUTE_MS: 60000,
} as const;

function refreshOptions(): { label: string; value: string }[] {
  return SMOKE_REFRESH_OPTIONS_MS.map((ms) => ({
    label: `${String(ms / SmokePanelValue.MINUTE_MS)}m`,
    value: String(ms),
  }));
}

function folderBreadcrumb(folderPath: string): string {
  return folderPath
    .split("/")
    .filter((segment) => segment && segment !== "job")
    .join(" / ");
}

function formatAxisTick(timestampMs: number): string {
  return new Date(timestampMs).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SmokePanel({
  folderPath = DEFAULT_SMOKE_FOLDER_PATH,
}: {
  folderPath?: string;
}) {
  const palette = usePalette();
  const token = useAuthStore((state) => state.token);
  const [refreshMs, setRefreshMs] = useState<number>(readStoredSmokeRefreshMs);
  const companionQuery = useQuery({
    enabled: true,
    queryFn: ({ signal }) => discoverAgent(signal),
    queryKey: [QueryKey.AGENT_DISCOVERY, token],
    refetchOnWindowFocus: false,
    retry: false,
  });
  const agentPort = companionQuery.data?.port ?? null;

  const { roots, error, isLoading, isRefreshing, isStale, refetch } = useSmokeFolder({
    agentPort,
    enabled: true,
    folderPath,
    refreshMs,
    token,
  });

  const now = Date.now();
  const pipelines = useMemo(() => collectSmokePipelines(roots), [roots]);
  const window = useMemo(() => computeSmokeWindow(now), [now]);
  const rows = useMemo(() => computeSmokeRows(pipelines, window, now), [pipelines, window, now]);
  const axisTicks = useMemo(
    () => computeSmokeAxisTicks(window, SmokePanelValue.AXIS_TICKS),
    [window]
  );
  const counts = useMemo(
    () =>
      roots.reduce(
        (accumulator, root) => {
          const rootCounts = countPipelineStatuses(root);
          return {
            passed: accumulator.passed + rootCounts.passed,
            failed: accumulator.failed + rootCounts.failed,
            running: accumulator.running + rootCounts.running,
            gray: accumulator.gray + countGrayStatuses(rootCounts) + rootCounts.stuck,
          };
        },
        { passed: 0, failed: 0, running: 0, gray: 0 }
      ),
    [roots]
  );
  const isColdCache = pipelines.length === 0 && isStale;
  const isWarmupPending =
    !error &&
    !isLoading &&
    isColdCache &&
    (companionQuery.isLoading || agentPort !== null || isRefreshing);
  const emptyMessage =
    isColdCache && agentPort === null && !companionQuery.isLoading
      ? SmokePanelCopy.COMPANION_REQUIRED
      : SmokePanelCopy.EMPTY;

  function openInBrowser(url: string): void {
    if (url) {
      globalThis.open(url, "_blank", "noopener,noreferrer");
    }
  }

  const folderUrl = useMemo(() => {
    const sample = pipelines.find((pipeline) => pipeline.url);
    if (!sample) {
      return null;
    }
    try {
      return `${new URL(sample.url).origin}/${folderPath}/`;
    } catch {
      return null;
    }
  }, [pipelines, folderPath]);

  return (
    <Stack gap="md">
      <Group align="flex-start" justify="space-between" wrap="wrap">
        <Stack gap={2}>
          <Group gap="xs">
            <Text fw={700} size="lg">
              {SmokePanelCopy.TITLE}
            </Text>
            {isRefreshing ? <Loader size="xs" /> : null}
          </Group>
          <Text c={palette.faint} size="xs">
            {folderBreadcrumb(folderPath)}
          </Text>
        </Stack>

        <Group gap="sm" wrap="wrap">
          <Group gap={6} wrap="nowrap">
            {counts.running > 0 ? (
              <Badge color="blue" variant="light">
                {counts.running} running
              </Badge>
            ) : null}
            <Badge color="green" variant="light">
              {counts.passed} OK
            </Badge>
            <Badge color="red" variant="light">
              {counts.failed} failed
            </Badge>
            {counts.gray > 0 ? (
              <Badge color="gray" variant="light">
                {counts.gray} other
              </Badge>
            ) : null}
          </Group>

          <Group gap={6} wrap="nowrap">
            <Text c={palette.faint} size="xs">
              {SmokePanelCopy.REFRESH_LABEL}
            </Text>
            <SegmentedControl
              data={refreshOptions()}
              onChange={(value) => {
                const nextRefreshMs = Number(value);
                writeStoredSmokeRefreshMs(nextRefreshMs);
                setRefreshMs(nextRefreshMs);
              }}
              size="xs"
              value={String(refreshMs)}
            />
          </Group>

          <Button
            leftSection={<IconRefresh size={16} />}
            onClick={() => void refetch()}
            size="xs"
            variant="light"
          >
            {SmokePanelCopy.REFRESH}
          </Button>

          {folderUrl ? (
            <Button
              leftSection={<IconExternalLink size={16} />}
              onClick={() => openInBrowser(folderUrl)}
              size="xs"
              variant="subtle"
            >
              {SmokePanelCopy.OPEN_JENKINS}
            </Button>
          ) : null}
        </Group>
      </Group>

      {error ? (
        <Alert color="red" icon={<IconAlertCircle size={18} />} title={SmokePanelCopy.ERROR_TITLE}>
          {error instanceof Error ? error.message : SmokePanelCopy.ERROR_BODY}
        </Alert>
      ) : null}

      {isLoading || isWarmupPending ? (
        <Group gap="sm" py="xl">
          <Loader size="sm" />
          <Text c={palette.faint}>
            {isLoading ? SmokePanelCopy.LOADING : SmokePanelCopy.WARMING}
          </Text>
        </Group>
      ) : null}

      {!isLoading && !isWarmupPending && !error && pipelines.length === 0 ? (
        <Text c={palette.faint}>{emptyMessage}</Text>
      ) : null}

      {rows.length > 0 ? (
        <Stack gap={8}>
          {rows.map((row) => (
            <SmokeTimelineRow key={row.pipeline.path} onOpenBuild={openInBrowser} row={row} />
          ))}

          <Box style={{ alignItems: "center", display: "flex", gap: 12, width: "100%" }}>
            <Box style={{ flex: "0 0 auto", width: SmokeTimelineRowValue.LABEL_WIDTH_PX }} />
            <Box style={{ flex: "1 1 auto", height: 16, position: "relative" }}>
              {axisTicks.map((tick) => (
                <Text
                  c={palette.faint}
                  key={tick.timestamp}
                  size="10px"
                  style={{
                    left: `${String(tick.leftPct)}%`,
                    position: "absolute",
                    transform:
                      tick.leftPct >= 100
                        ? "translateX(-100%)"
                        : tick.leftPct <= 0
                          ? "translateX(0)"
                          : "translateX(-50%)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {formatAxisTick(tick.timestamp)}
                </Text>
              ))}
            </Box>
          </Box>
        </Stack>
      ) : null}
    </Stack>
  );
}

