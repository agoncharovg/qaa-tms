import { useEffect, useRef } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Divider,
  Group,
  Loader,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconHistory,
  IconPlayerStop,
  IconPlugConnectedX,
  IconPlus,
  IconRotateClockwise,
  IconTrash,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { agentClient, getPreflight } from "@/api/agentClient";
import {
  OperationStatus,
  OperationStatusLabel,
  QueryKey,
  SectionKey,
  TabId,
  type OperationStatus as OperationStatusType,
} from "@/constants";
import { buildDeployRequestFromDraft } from "@/features/stagings/deployDraft";
import { isTerminalJobStatus } from "@/features/stagings/liveJobState";
import { useAuthStore } from "@/store/authStore";
import { useStagingsStore } from "@/store/stagingsStore";
import { useUiStore } from "@/store/uiStore";

function getStatusColor(status: OperationStatusType): string {
  switch (status) {
    case OperationStatus.SUCCESS:
      return "teal";
    case OperationStatus.FAILED:
      return "red";
    case OperationStatus.ABORTED:
      return "yellow";
    case OperationStatus.RUNNING:
      return "blue";
    default:
      return "gray";
  }
}

export function DeployPanel() {
  const queryClient = useQueryClient();
  const token = useAuthStore((state) => state.token);
  const deployDraft = useStagingsStore((state) => state.deployDraft);
  const liveJob = useStagingsStore((state) => state.liveJob);
  const reduceLiveJob = useStagingsStore((state) => state.reduceLiveJob);
  const setDeployDraft = useStagingsStore((state) => state.setDeployDraft);
  const setSelectedOperationId = useStagingsStore((state) => state.setSelectedOperationId);
  const startLiveJob = useStagingsStore((state) => state.startLiveJob);
  const openTab = useUiStore((state) => state.openTab);
  const switchTab = useUiStore((state) => state.switchTab);
  const historyOpen = useUiStore((state) =>
    state.tabsBySection[SectionKey.STAGINGS].tabIds.includes(TabId.STAGINGS_HISTORY)
  );
  const streamAbortControllerRef = useRef<AbortController | null>(null);
  const currentJobStatusRef = useRef(liveJob?.status);
  const logViewportRef = useRef<HTMLDivElement | null>(null);

  const preflightQuery = useQuery({
    enabled: Boolean(token),
    queryFn: ({ signal }) => getPreflight(token ?? "", signal),
    queryKey: [QueryKey.AGENT_PREFLIGHT, token],
  });

  const agentPort = preflightQuery.data?.detected ? preflightQuery.data.port : null;
  const probedPorts =
    preflightQuery.data && !preflightQuery.data.detected ? preflightQuery.data.ports.join(", ") : "";
  const isJobRunning = liveJob ? !isTerminalJobStatus(liveJob.status) : false;

  const jobQuery = useQuery({
    enabled: Boolean(token && agentPort !== null && liveJob?.jobId),
    queryFn: ({ signal }) =>
      agentClient.getJob(agentPort ?? 0, token ?? "", liveJob?.jobId ?? "", signal),
    queryKey: [QueryKey.AGENT_JOB, agentPort, liveJob?.jobId],
    refetchInterval: (query) => {
      const status = query.state.data?.status ?? liveJob?.status;
      return status && isTerminalJobStatus(status) ? false : 2000;
    },
  });

  useEffect(() => {
    if (jobQuery.data) {
      reduceLiveJob({
        job: jobQuery.data,
        type: "hydrate",
      });

      if (isTerminalJobStatus(jobQuery.data.status)) {
        void queryClient.invalidateQueries({
          queryKey: [QueryKey.OPERATIONS],
        });
      }
    }
  }, [jobQuery.data, queryClient, reduceLiveJob]);

  useEffect(() => {
    currentJobStatusRef.current = liveJob?.status;
  }, [liveJob?.status]);

  useEffect(() => {
    const jobId = liveJob?.jobId;
    const currentStatus = currentJobStatusRef.current;
    if (!token || agentPort === null || !jobId || !currentStatus || isTerminalJobStatus(currentStatus)) {
      return;
    }

    const controller = new AbortController();
    streamAbortControllerRef.current?.abort();
    streamAbortControllerRef.current = controller;

    void agentClient
      .streamJob(
        agentPort,
        token,
        jobId,
        (message) => {
          if (message.event === "log") {
            reduceLiveJob({
              line: message.data.line,
              type: "append-line",
            });
            return;
          }

          reduceLiveJob({
            terminal: message.data,
            type: "terminal",
          });
          void queryClient.invalidateQueries({
            queryKey: [QueryKey.OPERATIONS],
          });
        },
        controller.signal
      )
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        reduceLiveJob({
          message: error instanceof Error ? error.message : "Live log stream failed.",
          type: "set-stream-error",
        });
      });

    return () => {
      controller.abort();
      if (streamAbortControllerRef.current === controller) {
        streamAbortControllerRef.current = null;
      }
    };
  }, [agentPort, liveJob?.jobId, queryClient, reduceLiveJob, token]);

  useEffect(() => {
    if (liveJob && isTerminalJobStatus(liveJob.status)) {
      streamAbortControllerRef.current?.abort();
    }
  }, [liveJob]);

  useEffect(() => {
    if (logViewportRef.current) {
      logViewportRef.current.scrollTop = logViewportRef.current.scrollHeight;
    }
  }, [liveJob?.lines.length]);

  const deployMutation = useMutation({
    mutationFn: async () => {
      if (!token || agentPort === null) {
        throw new Error("Companion app is not running.");
      }

      return agentClient.deploy(
        agentPort,
        token,
        buildDeployRequestFromDraft(deployDraft)
      );
    },
    onSuccess: (response) => {
      startLiveJob(response.jobId, response.opId);
      setSelectedOperationId(null);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      if (!token || agentPort === null || !liveJob) {
        throw new Error("No running job is available.");
      }

      return agentClient.cancelJob(agentPort, token, liveJob.jobId);
    },
    onMutate: () => {
      reduceLiveJob({
        type: "request-cancel",
      });
      streamAbortControllerRef.current?.abort();
    },
    onSuccess: (job) => {
      reduceLiveJob({
        job,
        type: "hydrate",
      });
    },
  });

  if (preflightQuery.isLoading) {
    return (
      <Stack align="center" gap="md" py="xl">
        <Loader size="lg" />
        <Text c="dimmed">Checking the local companion app before deploy.</Text>
      </Stack>
    );
  }

  if (preflightQuery.isError) {
    return (
      <Alert color="red" icon={<IconAlertCircle size={18} />} title="Deploy preparation failed">
        <Stack gap="sm">
          <Text>
            {preflightQuery.error instanceof Error
              ? preflightQuery.error.message
              : "Unable to reach the companion app."}
          </Text>
          <Group>
            <Button leftSection={<IconRotateClockwise size={16} />} onClick={() => void preflightQuery.refetch()}>
              Retry
            </Button>
          </Group>
        </Stack>
      </Alert>
    );
  }

  const companionUnavailable = !preflightQuery.data?.detected;

  return (
    <Stack gap="lg">
      <SimpleGrid cols={{ base: 1, lg: 2 }}>
        <Card padding="lg" radius="lg" withBorder>
          <Stack gap="lg">
            <div>
              <Title order={3}>Deploy namespace</Title>
              <Text c="dimmed" size="sm">
                Submit a fresh `staging deploy` recipe and stream the live job output from the local companion app.
              </Text>
            </div>

            {companionUnavailable ? (
              <Alert
                color="yellow"
                icon={<IconPlugConnectedX size={18} />}
                title="Companion app is not running"
              >
                <Stack gap="sm">
                  <Text>
                    Start the local companion app, then retry discovery before submitting a deploy.
                  </Text>
                  <Text c="dimmed" size="sm">
                    Probed ports: {probedPorts}
                  </Text>
                  <Group>
                    <Button
                      leftSection={<IconRotateClockwise size={16} />}
                      onClick={() => void preflightQuery.refetch()}
                      variant="light"
                    >
                      Retry
                    </Button>
                  </Group>
                </Stack>
              </Alert>
            ) : null}

            <form
              onSubmit={(event) => {
                event.preventDefault();
                void deployMutation.mutateAsync();
              }}
            >
              <Stack gap="md">
                <TextInput
                  disabled={companionUnavailable || isJobRunning}
                  label="Namespace"
                  onChange={(event) =>
                    setDeployDraft({
                      ...deployDraft,
                      ns: event.currentTarget.value,
                    })
                  }
                  placeholder="qa-example"
                  required
                  value={deployDraft.ns}
                />

                <TextInput
                  disabled={companionUnavailable || isJobRunning}
                  label="Services"
                  onChange={(event) =>
                    setDeployDraft({
                      ...deployDraft,
                      servicesText: event.currentTarget.value,
                    })
                  }
                  placeholder="gateway, iam-api, billing-api"
                  value={deployDraft.servicesText}
                />

                <Stack gap="xs">
                  <Group justify="space-between">
                    <Text fw={500} size="sm">
                      Image overrides
                    </Text>
                    <Button
                      disabled={companionUnavailable || isJobRunning}
                      leftSection={<IconPlus size={16} />}
                      onClick={() =>
                        setDeployDraft({
                          ...deployDraft,
                          imageRows: [...deployDraft.imageRows, { service: "", tag: "" }],
                        })
                      }
                      size="xs"
                      type="button"
                      variant="light"
                    >
                      Add override
                    </Button>
                  </Group>

                  {deployDraft.imageRows.map((row, index) => (
                    <Group align="flex-end" key={index} grow>
                      <TextInput
                        disabled={companionUnavailable || isJobRunning}
                        label={index === 0 ? "Service" : undefined}
                        onChange={(event) => {
                          const nextRows = [...deployDraft.imageRows];
                          nextRows[index] = {
                            ...row,
                            service: event.currentTarget.value,
                          };
                          setDeployDraft({
                            ...deployDraft,
                            imageRows: nextRows,
                          });
                        }}
                        placeholder="iam-api"
                        value={row.service}
                      />
                      <TextInput
                        disabled={companionUnavailable || isJobRunning}
                        label={index === 0 ? "Tag" : undefined}
                        onChange={(event) => {
                          const nextRows = [...deployDraft.imageRows];
                          nextRows[index] = {
                            ...row,
                            tag: event.currentTarget.value,
                          };
                          setDeployDraft({
                            ...deployDraft,
                            imageRows: nextRows,
                          });
                        }}
                        placeholder="latest"
                        value={row.tag}
                      />
                      <Button
                        disabled={companionUnavailable || isJobRunning || deployDraft.imageRows.length === 1}
                        leftSection={<IconTrash size={16} />}
                        onClick={() =>
                          setDeployDraft({
                            ...deployDraft,
                            imageRows: deployDraft.imageRows.filter((_, rowIndex) => rowIndex !== index),
                          })
                        }
                        type="button"
                        variant="subtle"
                      >
                        Remove
                      </Button>
                    </Group>
                  ))}
                </Stack>

                <SimpleGrid cols={{ base: 1, sm: 2 }}>
                  <Checkbox
                    checked={deployDraft.flags.full}
                    disabled={companionUnavailable || isJobRunning}
                    label="Full"
                    onChange={(event) =>
                      setDeployDraft({
                        ...deployDraft,
                        flags: {
                          ...deployDraft.flags,
                          full: event.currentTarget.checked,
                        },
                      })
                    }
                  />
                  <Checkbox
                    checked={deployDraft.flags.dryRun}
                    disabled={companionUnavailable || isJobRunning}
                    label="Dry run"
                    onChange={(event) =>
                      setDeployDraft({
                        ...deployDraft,
                        flags: {
                          ...deployDraft.flags,
                          dryRun: event.currentTarget.checked,
                        },
                      })
                    }
                  />
                  <Checkbox
                    checked={deployDraft.flags.noSync}
                    disabled={companionUnavailable || isJobRunning}
                    label="No sync"
                    onChange={(event) =>
                      setDeployDraft({
                        ...deployDraft,
                        flags: {
                          ...deployDraft.flags,
                          noSync: event.currentTarget.checked,
                        },
                      })
                    }
                  />
                  <TextInput
                    disabled={companionUnavailable || isJobRunning}
                    label="Stage"
                    max={7}
                    min={0}
                    onChange={(event) =>
                      setDeployDraft({
                        ...deployDraft,
                        flags: {
                          ...deployDraft.flags,
                          stageText: event.currentTarget.value,
                        },
                      })
                    }
                    placeholder="0-7"
                    type="number"
                    value={deployDraft.flags.stageText}
                  />
                </SimpleGrid>

                {deployMutation.isError ? (
                  <Alert color="red" icon={<IconAlertCircle size={18} />} title="Deploy request failed">
                    <Text>
                      {deployMutation.error instanceof Error
                        ? deployMutation.error.message
                        : "Unable to start the deploy job."}
                    </Text>
                  </Alert>
                ) : null}

                <Group justify="space-between">
                  <Text c="dimmed" size="sm">
                    The form sends the exact agent deploy recipe with camelCase flags.
                  </Text>
                  <Button
                    disabled={companionUnavailable || isJobRunning}
                    loading={deployMutation.isPending}
                    type="submit"
                  >
                    Deploy
                  </Button>
                </Group>
              </Stack>
            </form>
          </Stack>
        </Card>

        <Card padding="lg" radius="lg" withBorder>
          <Stack gap="md" h="100%">
            <Group justify="space-between">
              <div>
                <Title order={3}>Live job log</Title>
                <Text c="dimmed" size="sm">
                  Live output stays in memory for this browser session only.
                </Text>
              </div>

              {liveJob ? (
                <Badge color={getStatusColor(liveJob.status)} size="lg" variant="light">
                  {OperationStatusLabel[liveJob.status]}
                </Badge>
              ) : null}
            </Group>

            {!liveJob ? (
              <Stack align="center" gap="sm" justify="center" py="xl">
                <Text c="dimmed">Start a deploy to reveal the live log stream and cancellation controls.</Text>
              </Stack>
            ) : (
              <>
                <SimpleGrid cols={{ base: 1, sm: 2 }}>
                  <Paper p="md" radius="md" withBorder>
                    <Text c="dimmed" size="sm">
                      Job ID
                    </Text>
                    <Text ff="monospace" size="sm">
                      {liveJob.jobId}
                    </Text>
                  </Paper>
                  <Paper p="md" radius="md" withBorder>
                    <Text c="dimmed" size="sm">
                      Operation ID
                    </Text>
                    <Text ff="monospace" size="sm">
                      {liveJob.opId}
                    </Text>
                  </Paper>
                </SimpleGrid>

                <Group justify="space-between">
                  <Text c="dimmed" size="sm">
                    Exit code: {liveJob.exitCode ?? "pending"}
                  </Text>
                  <Group>
                    {isJobRunning ? (
                      <Button
                        color="yellow"
                        leftSection={<IconPlayerStop size={16} />}
                        loading={cancelMutation.isPending}
                        onClick={() => void cancelMutation.mutateAsync()}
                        variant="light"
                      >
                        Cancel
                      </Button>
                    ) : (
                      <Button
                        leftSection={<IconHistory size={16} />}
                        onClick={() => {
                          setSelectedOperationId(liveJob.opId);
                          if (historyOpen) {
                            switchTab(SectionKey.STAGINGS, TabId.STAGINGS_HISTORY);
                            return;
                          }

                          openTab(SectionKey.STAGINGS, TabId.STAGINGS_HISTORY);
                        }}
                        variant="light"
                      >
                        View in history
                      </Button>
                    )}
                  </Group>
                </Group>

                {liveJob.streamError ? (
                  <Alert color="yellow" icon={<IconAlertCircle size={18} />} title="Live stream interrupted">
                    <Text>{liveJob.streamError}</Text>
                    <Text c="dimmed" size="sm">
                      Job polling continues in the background until the terminal status arrives.
                    </Text>
                  </Alert>
                ) : null}

                <Divider />

                <Box
                  bg="rgba(2, 6, 12, 0.95)"
                  c="gray.1"
                  h={360}
                  p="md"
                  ref={logViewportRef}
                  style={{
                    border: "1px solid rgba(255, 255, 255, 0.08)",
                    borderRadius: "12px",
                    fontFamily: "monospace",
                    overflowY: "auto",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {liveJob.lines.length > 0 ? liveJob.lines.join("\n") : "Waiting for agent output..."}
                </Box>
              </>
            )}
          </Stack>
        </Card>
      </SimpleGrid>
    </Stack>
  );
}
