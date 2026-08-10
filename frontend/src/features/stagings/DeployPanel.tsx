import { useEffect, useMemo, useRef } from "react";
import {
  Alert,
  Autocomplete,
  Button,
  Card,
  Checkbox,
  Group,
  Loader,
  NativeSelect,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconInfoCircle,
  IconPlugConnectedX,
  IconPlus,
  IconRotateClockwise,
  IconTrash,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { agentClient, getPreflight } from "@/api/agentClient";
import { QueryKey, SectionKey, TabId } from "@/constants";
import {
  buildDeployRequestFromDraft,
  DeployMode,
  getShortcutDefaultNamespace,
  getShortcutPinnedServices,
  isShortcutDeployMode,
  isShortcutFullDeploy,
  requiresExplicitSemver,
  type ShortcutDeployMode,
} from "@/features/stagings/deployDraft";
import { LiveJobPanel } from "@/features/stagings/LiveJobPanel";
import { isTerminalJobStatus } from "@/features/stagings/liveJobState";
import { useAuthStore } from "@/store/authStore";
import { useStagingsStore } from "@/store/stagingsStore";
import { useUiStore } from "@/store/uiStore";

const DEPLOY_MODE_OPTIONS = [
  { label: "Raw staging deploy", value: DeployMode.RAW },
  { label: "IAM shortcut", value: DeployMode.IAM },
  { label: "Billing shortcut", value: DeployMode.BILLING },
] as const;

const SHORTCUT_TITLES: Record<ShortcutDeployMode, string> = {
  billing: "Billing shortcut",
  iam: "IAM shortcut",
};

const SHORTCUT_DESCRIPTIONS: Record<ShortcutDeployMode, string> = {
  billing:
    "Mirrors the deploy half of `staging billing`: pick a namespace, choose whether to recreate it, pin one service tag, and optionally add frontend only on a full deploy.",
  iam:
    "Mirrors the deploy half of `staging iam`: pick a namespace, choose whether to recreate it, pin one service tag, and optionally add frontend only on a full deploy.",
};

function normalizeShortcutTag(mode: ShortcutDeployMode, service: string, currentTag: string): string {
  const trimmedTag = currentTag.trim();
  if (requiresExplicitSemver(mode, service)) {
    return trimmedTag === "latest" ? "" : currentTag;
  }

  return trimmedTag.length === 0 ? "latest" : currentTag;
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
  const shortcutMode = isShortcutDeployMode(deployDraft.mode);
  const shortcutProfile = shortcutMode ? deployDraft.mode : null;
  const activeShortcutMode = (shortcutProfile ?? DeployMode.IAM) as ShortcutDeployMode;

  const namespacesQuery = useQuery({
    enabled: Boolean(token && agentPort !== null),
    queryFn: ({ signal }) => agentClient.listNamespaces(agentPort ?? 0, token ?? "", signal),
    queryKey: [QueryKey.AGENT_NAMESPACES, token, agentPort],
    refetchOnWindowFocus: false,
    retry: false,
  });

  const namespaceSuggestions = useMemo(() => {
    const entries = (namespacesQuery.data?.clusterNamespaces ?? []).map((entry) => entry.name);
    return [...new Set(entries)].sort((left, right) => left.localeCompare(right));
  }, [namespacesQuery.data?.clusterNamespaces]);

  const namespaceExists = useMemo(() => {
    if (!shortcutMode || !namespacesQuery.data) {
      return undefined;
    }

    const trimmedNamespace = deployDraft.ns.trim();
    if (trimmedNamespace.length === 0) {
      return false;
    }

    return namespacesQuery.data.clusterNamespaces.some((entry) => entry.name === trimmedNamespace);
  }, [deployDraft.ns, namespacesQuery.data, shortcutMode]);

  const shortcutPinnedServices = useMemo(
    () => (shortcutMode ? getShortcutPinnedServices(activeShortcutMode) : []),
    [activeShortcutMode, shortcutMode]
  );

  const shortcutNeedsExplicitSemver =
    shortcutMode && requiresExplicitSemver(activeShortcutMode, deployDraft.shortcut.pinnedService);
  const shortcutFullDeploy =
    shortcutMode && namespaceExists !== undefined
      ? isShortcutFullDeploy(namespaceExists, deployDraft.shortcut)
      : false;

  const deployPreview = useMemo(() => {
    try {
      return {
        error: null as string | null,
        request: buildDeployRequestFromDraft(
          deployDraft,
          shortcutMode
            ? {
                namespaceExists,
              }
            : undefined
        ),
      };
    } catch (error: unknown) {
      return {
        error: error instanceof Error ? error.message : "Unable to build the deploy request.",
        request: null,
      };
    }
  }, [deployDraft, namespaceExists, shortcutMode]);

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
      if (!deployPreview.request) {
        throw new Error(deployPreview.error ?? "Unable to build the deploy request.");
      }

      return agentClient.deploy(agentPort, token, deployPreview.request);
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
  const submitDisabled =
    companionUnavailable ||
    isJobRunning ||
    deployDraft.ns.trim().length === 0 ||
    (shortcutMode && (namespacesQuery.isLoading || namespacesQuery.isError || deployPreview.request === null));

  return (
    <Stack gap="lg">
      <SimpleGrid cols={{ base: 1, lg: 2 }}>
        <Card padding="lg" radius="lg" withBorder>
          <Stack gap="lg">
            <div>
              <Title order={3}>Deploy namespace</Title>
              <Text c="dimmed" size="sm">
                Submit a fresh `staging deploy` recipe or use an IAM/Billing shortcut that expands into the same deploy command.
              </Text>
            </div>

            {companionUnavailable ? (
              <Alert color="yellow" icon={<IconPlugConnectedX size={18} />} title="Companion app is not running">
                <Stack gap="sm">
                  <Text>Start the local companion app, then retry discovery before submitting a deploy.</Text>
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
                <NativeSelect
                  data={DEPLOY_MODE_OPTIONS}
                  disabled={companionUnavailable || isJobRunning}
                  label="Deploy mode"
                  onChange={(event) => {
                    const nextMode = event.currentTarget.value as typeof deployDraft.mode;
                    if (nextMode === deployDraft.mode) {
                      return;
                    }

                    if (!isShortcutDeployMode(nextMode)) {
                      setDeployDraft({
                        ...deployDraft,
                        mode: nextMode,
                      });
                      return;
                    }

                    const nextPinnedServices = getShortcutPinnedServices(nextMode);
                    const nextPinnedService = nextPinnedServices.includes(deployDraft.shortcut.pinnedService)
                      ? deployDraft.shortcut.pinnedService
                      : nextPinnedServices[0];

                    setDeployDraft({
                      ...deployDraft,
                      mode: nextMode,
                      ns: deployDraft.ns.trim().length > 0 ? deployDraft.ns : getShortcutDefaultNamespace(nextMode),
                      shortcut: {
                        ...deployDraft.shortcut,
                        pinnedService: nextPinnedService,
                        tag: normalizeShortcutTag(nextMode, nextPinnedService, deployDraft.shortcut.tag),
                      },
                    });
                  }}
                  value={deployDraft.mode}
                />

                <Autocomplete
                  data={namespaceSuggestions}
                  disabled={companionUnavailable || isJobRunning}
                  description="Suggestions include deployed cluster namespaces only, but you can still type any namespace manually."
                  label="Namespace"
                  onChange={(value) =>
                    setDeployDraft({
                      ...deployDraft,
                      ns: value,
                    })
                  }
                  placeholder={shortcutMode ? getShortcutDefaultNamespace(activeShortcutMode) : "qa-example"}
                  required
                  value={deployDraft.ns}
                />

                {shortcutMode ? (
                  <>
                    <Alert color="blue" icon={<IconInfoCircle size={18} />} title={SHORTCUT_TITLES[activeShortcutMode]}>
                      <Text size="sm">{SHORTCUT_DESCRIPTIONS[activeShortcutMode]}</Text>
                    </Alert>

                    {namespacesQuery.isLoading ? (
                      <Group gap="sm">
                        <Loader size="sm" />
                        <Text c="dimmed" size="sm">
                          Loading deployed namespaces to decide between bump and full deploy.
                        </Text>
                      </Group>
                    ) : null}

                    {namespacesQuery.isError ? (
                      <Alert color="red" icon={<IconAlertCircle size={18} />} title="Namespace lookup failed">
                        <Text>
                          {namespacesQuery.error instanceof Error
                            ? namespacesQuery.error.message
                            : "Unable to load deployed namespaces for the shortcut mode."}
                        </Text>
                      </Alert>
                    ) : null}

                    {!namespacesQuery.isLoading && !namespacesQuery.isError && deployDraft.ns.trim().length > 0 ? (
                      <Alert color="blue" icon={<IconInfoCircle size={18} />} title="Namespace strategy">
                        <Text size="sm">
                          {namespaceExists
                            ? deployDraft.shortcut.clean
                              ? "Namespace exists in the cluster, so this shortcut will delete it and redeploy from scratch with --clean."
                              : "Namespace exists in the cluster, so this shortcut will update it in place and pin only the selected service tag."
                            : "Namespace is not deployed in the cluster, so this shortcut will run the full product-focused deploy."}
                        </Text>
                      </Alert>
                    ) : null}

                    {namespaceExists ? (
                      <Checkbox
                        checked={deployDraft.shortcut.clean}
                        disabled={companionUnavailable || isJobRunning}
                        label="Recreate from scratch (--clean)"
                        onChange={(event) =>
                          setDeployDraft({
                            ...deployDraft,
                            shortcut: {
                              ...deployDraft.shortcut,
                              clean: event.currentTarget.checked,
                            },
                          })
                        }
                      />
                    ) : null}

                    <NativeSelect
                      data={shortcutPinnedServices.map((service) => ({ label: service, value: service }))}
                      disabled={companionUnavailable || isJobRunning}
                      label="Pinned service"
                      onChange={(event) => {
                        const nextPinnedService = event.currentTarget.value;
                        setDeployDraft({
                          ...deployDraft,
                          shortcut: {
                            ...deployDraft.shortcut,
                            pinnedService: nextPinnedService,
                            tag: normalizeShortcutTag(activeShortcutMode, nextPinnedService, deployDraft.shortcut.tag),
                          },
                        });
                      }}
                      value={deployDraft.shortcut.pinnedService}
                    />

                    <TextInput
                      description={
                        shortcutNeedsExplicitSemver
                          ? "platform-notifier does not support `latest` here; enter an explicit semver tag such as 1.108.0."
                          : "`latest` matches the CLI wizard default."
                      }
                      disabled={companionUnavailable || isJobRunning}
                      label="Image tag"
                      onChange={(event) =>
                        setDeployDraft({
                          ...deployDraft,
                          shortcut: {
                            ...deployDraft.shortcut,
                            tag: event.currentTarget.value,
                          },
                        })
                      }
                      placeholder={shortcutNeedsExplicitSemver ? "1.108.0" : "latest"}
                      required
                      value={deployDraft.shortcut.tag}
                    />

                    {shortcutFullDeploy ? (
                      <Checkbox
                        checked={deployDraft.shortcut.includeFrontend}
                        disabled={companionUnavailable || isJobRunning}
                        label="Also deploy frontend (fe-auth, fe-portal, fe-product)"
                        onChange={(event) =>
                          setDeployDraft({
                            ...deployDraft,
                            shortcut: {
                              ...deployDraft.shortcut,
                              includeFrontend: event.currentTarget.checked,
                            },
                          })
                        }
                      />
                    ) : null}

                    {namespaceExists === true && !deployDraft.shortcut.clean ? (
                      <Text c="dimmed" size="sm">
                        Frontend can be added only during a fresh or clean deploy, matching the CLI wizard.
                      </Text>
                    ) : null}

                    {deployPreview.request ? (
                      <Alert color="blue" icon={<IconInfoCircle size={18} />} title="Shortcut preview">
                        <Stack gap={4}>
                          <Text size="sm">Services: {deployPreview.request.services.join(", ")}</Text>
                          <Text size="sm">
                            Image override:{" "}
                            {Object.entries(deployPreview.request.images)
                              .map(([service, tag]) => `${service}=${tag}`)
                              .join(", ")}
                          </Text>
                          <Text size="sm">
                            Flags:{" "}
                            {deployPreview.request.flags.clean ? "--clean" : "none"}
                          </Text>
                        </Stack>
                      </Alert>
                    ) : null}

                    {deployPreview.error && !namespacesQuery.isLoading && !namespacesQuery.isError ? (
                      <Alert color="red" icon={<IconAlertCircle size={18} />} title="Shortcut is incomplete">
                        <Text>{deployPreview.error}</Text>
                      </Alert>
                    ) : null}
                  </>
                ) : (
                  <>
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
                        checked={deployDraft.flags.clean}
                        disabled={companionUnavailable || isJobRunning}
                        label="Clean"
                        onChange={(event) =>
                          setDeployDraft({
                            ...deployDraft,
                            flags: {
                              ...deployDraft.flags,
                              clean: event.currentTarget.checked,
                            },
                          })
                        }
                      />
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
                  </>
                )}

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
                    {shortcutMode
                      ? "The shortcut still submits a regular agent deploy recipe, but fills in the product-specific service set for you."
                      : "The form sends the exact agent deploy recipe with camelCase flags."}
                  </Text>
                  <Button disabled={submitDisabled} loading={deployMutation.isPending} type="submit">
                    Deploy
                  </Button>
                </Group>
              </Stack>
            </form>
          </Stack>
        </Card>

        <Card padding="lg" radius="lg" withBorder>
          <LiveJobPanel
            cancelPending={cancelMutation.isPending}
            emptyMessage="Start a deploy to reveal the live log stream and cancellation controls."
            liveJob={liveJob}
            logViewportRef={logViewportRef}
            onCancel={() => void cancelMutation.mutateAsync()}
            onViewHistory={
              liveJob
                ? () => {
                    setSelectedOperationId(liveJob.opId);
                    if (historyOpen) {
                      switchTab(SectionKey.STAGINGS, TabId.STAGINGS_HISTORY);
                      return;
                    }

                    openTab(SectionKey.STAGINGS, TabId.STAGINGS_HISTORY);
                  }
                : undefined
            }
          />
        </Card>
      </SimpleGrid>
    </Stack>
  );
}
