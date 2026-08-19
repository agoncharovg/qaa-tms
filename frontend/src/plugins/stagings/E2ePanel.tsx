import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Autocomplete,
  Button,
  Card,
  Group,
  Loader,
  MultiSelect,
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
  IconRotateClockwise,
} from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { agentClient, getPreflight } from "@/api/agentClient";
import type { E2eRunRequest } from "@/api/types";
import { PRODUCT_OPTIONS, QueryKey, PluginId, TabId, type Product } from "@/constants";
import { LiveJobPanel } from "@/plugins/stagings/LiveJobPanel";
import { useTransientLiveJob } from "@/plugins/stagings/useTransientLiveJob";
import { useAuthStore } from "@/store/authStore";
import { useStagingsStore } from "@/store/stagingsStore";
import { useUiStore } from "@/store/uiStoreCore";

const DEFAULT_E2E_IMAGE = "latest";
const DEFAULT_E2E_THREADS = "5";

interface E2eFormState {
  ns: string;
  product: Product;
  image: string;
  mark: string;
  marks: string;
  threads: string;
}

function normalizeThreads(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const parsed = Number.parseInt(trimmed, 10);
  return parsed >= 1 ? parsed : null;
}

function normalizeOptionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function buildE2eRunRequest(formState: E2eFormState, suites: string[]): E2eRunRequest {
  const threads = normalizeThreads(formState.threads);
  if (threads === null) {
    throw new Error("Threads must be a positive integer.");
  }

  const image = normalizeOptionalText(formState.image);
  const mark = normalizeOptionalText(formState.mark);
  const marks = normalizeOptionalText(formState.marks);

  return {
    ns: formState.ns.trim(),
    product: formState.product,
    suites,
    ...(image === undefined ? {} : { image }),
    ...(mark === undefined ? {} : { mark }),
    ...(marks === undefined ? {} : { marks }),
    ...(threads === undefined ? {} : { threads }),
  };
}

export function E2ePanel() {
  const token = useAuthStore((state) => state.token);
  const setSelectedOperationId = useStagingsStore((state) => state.setSelectedOperationId);
  const openTab = useUiStore((state) => state.openTab);
  const switchTab = useUiStore((state) => state.switchTab);
  const historyOpen = useUiStore((state) =>
    state.tabsByPlugin[PluginId.STAGINGS].tabIds.includes(TabId.STAGINGS_HISTORY)
  );
  const [formState, setFormState] = useState<E2eFormState>({
    ns: "",
    product: PRODUCT_OPTIONS[0],
    image: DEFAULT_E2E_IMAGE,
    mark: "",
    marks: "",
    threads: DEFAULT_E2E_THREADS,
  });
  const [selectedSuites, setSelectedSuites] = useState<string[]>([]);

  const preflightQuery = useQuery({
    enabled: Boolean(token),
    queryFn: ({ signal }) => getPreflight(token ?? "", signal),
    queryKey: [QueryKey.AGENT_PREFLIGHT, token],
    refetchOnWindowFocus: false,
    retry: false,
  });

  const agentPort = preflightQuery.data?.detected ? preflightQuery.data.port : null;
  const probedPorts =
    preflightQuery.data && !preflightQuery.data.detected ? preflightQuery.data.ports.join(", ") : "";
  const companionUnavailable = !preflightQuery.data?.detected;
  const { cancelMutation, isJobRunning, liveJob, logViewportRef, startLiveJob } = useTransientLiveJob(
    agentPort,
    token
  );

  const suitesQuery = useQuery({
    enabled: Boolean(token && agentPort !== null),
    queryFn: ({ signal }) =>
      agentClient.getE2eSuites(agentPort ?? 0, token ?? "", formState.product, signal),
    queryKey: [QueryKey.AGENT_E2E_SUITES, token, agentPort, formState.product],
    refetchOnWindowFocus: false,
    retry: false,
  });

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

  const suiteOptions = useMemo(
    () =>
      (suitesQuery.data?.suites ?? []).map((suite) => ({
        label: suite.name,
        value: suite.name,
      })),
    [suitesQuery.data?.suites]
  );

  const suiteMarksByName = useMemo(
    () => new Map((suitesQuery.data?.suites ?? []).map((suite) => [suite.name, suite.marks])),
    [suitesQuery.data?.suites]
  );

  useEffect(() => {
    setSelectedSuites([]);
  }, [formState.product]);

  const e2eMutation = useMutation({
    mutationFn: async () => {
      if (!token || agentPort === null) {
        throw new Error("Companion app is not running.");
      }

      return agentClient.e2eRun(agentPort, token, buildE2eRunRequest(formState, selectedSuites));
    },
    onSuccess: (response) => {
      startLiveJob(response.jobId, response.opId);
      setSelectedOperationId(null);
    },
  });

  const parsedThreads = useMemo(() => normalizeThreads(formState.threads), [formState.threads]);
  const hasMarksOverride = formState.marks.trim().length > 0;
  const runDisabled =
    companionUnavailable ||
    isJobRunning ||
    formState.ns.trim().length === 0 ||
    (selectedSuites.length === 0 && !hasMarksOverride) ||
    parsedThreads === null ||
    suitesQuery.isLoading ||
    suitesQuery.isError;

  if (preflightQuery.isLoading) {
    return (
      <Stack align="center" gap="md" py="xl">
        <Loader size="lg" />
        <Text c="dimmed">Checking the local companion app before loading E2E suites.</Text>
      </Stack>
    );
  }

  if (preflightQuery.isError) {
    return (
      <Alert color="red" icon={<IconAlertCircle size={18} />} title="E2E preparation failed">
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

  return (
    <Stack gap="lg">
      <SimpleGrid cols={{ base: 1, lg: 2 }}>
        <Card padding="lg" radius="lg" withBorder>
          <Stack gap="lg">
            <div>
              <Title order={3}>Run E2E suites</Title>
              <Text c="dimmed" size="sm">
                Pick a product, search named suites from the registry, and trigger `staging e2e-run` through the companion app.
              </Text>
            </div>

            {companionUnavailable ? (
              <Alert color="yellow" icon={<IconPlugConnectedX size={18} />} title="Companion app is not running">
                <Stack gap="sm">
                  <Text>Start the local companion app, then retry discovery before running E2E suites.</Text>
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

            <Alert color="yellow" icon={<IconInfoCircle size={18} />} title="Cancel caveat">
              <Text size="sm">
                Cancel stops the local watcher only. The already-triggered remote Jenkins build keeps running.
              </Text>
            </Alert>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                void e2eMutation.mutateAsync();
              }}
            >
              <Stack gap="md">
                <NativeSelect
                  data={PRODUCT_OPTIONS.map((product) => ({ label: product, value: product }))}
                  disabled={companionUnavailable || isJobRunning}
                  label="Product"
                  onChange={(event) => {
                    const { value } = event.currentTarget;
                    setFormState((current) => ({
                      ...current,
                      product: value as Product,
                    }));
                  }}
                  value={formState.product}
                />

                {suitesQuery.isLoading ? (
                  <Group gap="sm">
                    <Loader size="sm" />
                    <Text c="dimmed" size="sm">
                      Loading suite registry for {formState.product}.
                    </Text>
                  </Group>
                ) : suitesQuery.isError ? (
                  <Alert color="red" icon={<IconAlertCircle size={18} />} title="Suite registry failed">
                    <Text>
                      {suitesQuery.error instanceof Error
                        ? suitesQuery.error.message
                        : "Unable to load the suite registry."}
                    </Text>
                  </Alert>
                ) : (
                  <Stack gap="xs">
                    <MultiSelect
                      clearable
                      data={suiteOptions}
                      description="Search the suite registry from `staging e2e-run --list-suites`. Leave this empty only when you provide Pytest -m below."
                      disabled={companionUnavailable || isJobRunning || !suiteOptions.length}
                      hidePickedOptions
                      label="Named suites"
                      maxDropdownHeight={280}
                      nothingFoundMessage="No suite matches the current search."
                      onChange={setSelectedSuites}
                      placeholder={suiteOptions.length ? "Select one or more suites" : "No suites available"}
                      renderOption={({ option }) => {
                        const marks = suiteMarksByName.get(option.value);
                        return (
                          <Stack gap={0}>
                            <Text fw={500} size="sm">
                              {option.label}
                            </Text>
                            {marks ? (
                              <Text c="dimmed" size="xs">
                                {marks}
                              </Text>
                            ) : null}
                          </Stack>
                        );
                      }}
                      searchable
                      value={selectedSuites}
                    />
                    {!suiteOptions.length ? (
                      <Alert color="gray" icon={<IconInfoCircle size={18} />} title="No suites returned">
                        <Text size="sm">The registry returned no named suites for {formState.product}.</Text>
                      </Alert>
                    ) : null}
                  </Stack>
                )}

                <Autocomplete
                  data={namespaceSuggestions}
                  description="Suggestions include only deployed cluster namespaces, but you can still type any namespace manually."
                  disabled={companionUnavailable || isJobRunning}
                  label="Namespace"
                  limit={10}
                  onChange={(value) => {
                    setFormState((current) => ({
                      ...current,
                      ns: value,
                    }));
                  }}
                  placeholder="qaa-demo"
                  required
                  value={formState.ns}
                />

                <SimpleGrid cols={{ base: 1, sm: 2 }}>
                  <TextInput
                    description="Passed as --image for the qaa-e2e runner. Defaults to latest."
                    disabled={companionUnavailable || isJobRunning}
                    label="qaa-e2e image tag"
                    onChange={(event) => {
                      const { value } = event.currentTarget;
                      setFormState((current) => ({
                        ...current,
                        image: value,
                      }));
                    }}
                    placeholder={DEFAULT_E2E_IMAGE}
                    value={formState.image}
                  />

                  <TextInput
                    description="Optional xdist thread count passed as --threads. Current staging default: 5."
                    disabled={companionUnavailable || isJobRunning}
                    error={parsedThreads === null ? "Threads must be a positive integer." : null}
                    inputMode="numeric"
                    label="Threads"
                    onChange={(event) => {
                      const { value } = event.currentTarget;
                      setFormState((current) => ({
                        ...current,
                        threads: value,
                      }));
                    }}
                    placeholder={DEFAULT_E2E_THREADS}
                    type="number"
                    value={formState.threads}
                  />
                </SimpleGrid>

                <Stack gap="md">
                  <TextInput
                    description="Optional pytest -k expression passed as --mark."
                    disabled={companionUnavailable || isJobRunning}
                    label="Pytest -k"
                    onChange={(event) => {
                      const { value } = event.currentTarget;
                      setFormState((current) => ({
                        ...current,
                        mark: value,
                      }));
                    }}
                    placeholder="auth and not slow"
                    value={formState.mark}
                  />

                  <TextInput
                    description="Optional pytest -m expression passed as --marks. When set, it overrides the named suite selection in staging."
                    disabled={companionUnavailable || isJobRunning}
                    label="Pytest -m"
                    onChange={(event) => {
                      const { value } = event.currentTarget;
                      setFormState((current) => ({
                        ...current,
                        marks: value,
                      }));
                    }}
                    placeholder="product_iam and smoke"
                    value={formState.marks}
                  />
                </Stack>

                {e2eMutation.isError ? (
                  <Alert color="red" icon={<IconAlertCircle size={18} />} title="E2E request failed">
                    <Text>
                      {e2eMutation.error instanceof Error
                        ? e2eMutation.error.message
                        : "Unable to start the E2E job."}
                    </Text>
                  </Alert>
                ) : null}

                <Group justify="space-between">
                  <Text c="dimmed" size="sm">
                    The form sends <code>{`{ ns, product, suites[], image?, mark?, marks?, threads? }`}</code> to the agent.
                  </Text>
                  <Button disabled={runDisabled} loading={e2eMutation.isPending} type="submit">
                    Run E2E
                  </Button>
                </Group>
              </Stack>
            </form>
          </Stack>
        </Card>

        <Card padding="lg" radius="lg" withBorder>
          <LiveJobPanel
            cancelPending={cancelMutation.isPending}
            emptyMessage="Run E2E suites to reveal the live log stream and cancellation controls."
            liveJob={liveJob}
            logViewportRef={logViewportRef}
            onCancel={() => void cancelMutation.mutateAsync()}
            onViewHistory={
              liveJob
                ? () => {
                    setSelectedOperationId(liveJob.opId);
                    if (historyOpen) {
                      switchTab(PluginId.STAGINGS, TabId.STAGINGS_HISTORY);
                      return;
                    }

                    openTab(PluginId.STAGINGS, TabId.STAGINGS_HISTORY);
                  }
                : undefined
            }
            title="Live E2E job"
          />
        </Card>
      </SimpleGrid>
    </Stack>
  );
}
