import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Button,
  Checkbox,
  Group,
  Menu,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
} from "@mantine/core";
import { IconDeviceFloppy, IconDots, IconEdit, IconPlus, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { agentClient } from "@/api/agentClient";
import type { RequestsEnvironmentsState, RequestsVariableRow } from "@/api/types";
import { QueryKey } from "@/constants";
import { hasPermission } from "@/plugins/permissions";
import {
  RequestsCompanionUnavailableAlert,
  RequestsEmptyCard,
  RequestsErrorAlert,
  RequestsLoadingState,
  RequestsNoticeAlert,
  RequestsSurface,
} from "@/plugins/requests/RequestsShared";
import {
  isVariableRowDirty,
  normalizeVariableRowValues,
} from "@/plugins/requests/EnvironmentsPanelState";
import { getErrorMessage, type RequestsNotice, useRequestsAgent } from "@/plugins/requests/requestsShared";
import { useAuthStore } from "@/store/authStore";

const REQUESTS_WRITE_PERMISSION = "requests.write";
type VariableTab = "variables" | "secrets";
type VariableDraftRow = RequestsVariableRow & { isNew?: boolean };

function buildDraftId(): string {
  return `draft-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
}

function buildDraftRows(state: RequestsEnvironmentsState | undefined): VariableDraftRow[] {
  return (state?.variables ?? []).map((row) => ({ ...row, isNew: false }));
}

function buildNewVariableRow(secret: boolean): VariableDraftRow {
  return {
    createdAt: "",
    enabled: true,
    id: buildDraftId(),
    isNew: true,
    key: "",
    secret,
    updatedAt: "",
    values: {},
  };
}

function syncDraftRows(
  nextState: RequestsEnvironmentsState | undefined,
  currentRows: VariableDraftRow[],
  options: { removeDraftId?: string } = {}
): VariableDraftRow[] {
  const unsavedRows = currentRows.filter(
    (row) => row.isNew && row.id !== options.removeDraftId
  );
  return [...buildDraftRows(nextState), ...unsavedRows];
}

function rowMatchesTab(row: VariableDraftRow, tab: VariableTab): boolean {
  return tab === "secrets" ? row.secret : !row.secret;
}

async function invalidateRequestsContentQueries(
  queryClient: ReturnType<typeof useQueryClient>
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: [QueryKey.REQUESTS_ITEMS] }),
    queryClient.invalidateQueries({ queryKey: [QueryKey.REQUESTS_ITEM] }),
    queryClient.invalidateQueries({ queryKey: [QueryKey.REQUESTS_CREDENTIALS] }),
  ]);
}

export function EnvironmentsPanel() {
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((state) => state.currentUser);
  const canWrite = hasPermission(currentUser, REQUESTS_WRITE_PERMISSION);
  const { agentPort, companionUnavailable, preflightQuery, probedPorts, token } = useRequestsAgent();
  const [notice, setNotice] = useState<RequestsNotice | null>(null);
  const [activeTab, setActiveTab] = useState<VariableTab>("variables");
  const [draftRows, setDraftRows] = useState<VariableDraftRow[]>([]);
  const [savingRowId, setSavingRowId] = useState<string | null>(null);

  const queryKey = [QueryKey.REQUESTS_ENVIRONMENTS, token, agentPort] as const;
  const environmentsQuery = useQuery({
    enabled: Boolean(token && agentPort !== null),
    queryFn: ({ signal }) => agentClient.getRequestsState(agentPort ?? 0, token ?? "", signal),
    queryKey,
    refetchOnWindowFocus: false,
    retry: false,
  });

  useEffect(() => {
    setDraftRows((current) => syncDraftRows(environmentsQuery.data, current));
  }, [environmentsQuery.data]);

  const environments = environmentsQuery.data?.environments ?? [];
  const savedRowsById = useMemo(
    () => new Map((environmentsQuery.data?.variables ?? []).map((row) => [row.id, row])),
    [environmentsQuery.data?.variables]
  );
  const visibleRows = useMemo(
    () => draftRows.filter((row) => rowMatchesTab(row, activeTab)),
    [activeTab, draftRows]
  );

  const applyState = (
    nextState: RequestsEnvironmentsState,
    options: { removeDraftId?: string } = {}
  ) => {
    queryClient.setQueryData(queryKey, nextState);
    setDraftRows((current) => syncDraftRows(nextState, current, options));
  };

  const createEnvironmentMutation = useMutation({
    mutationFn: async (name: string) => {
      if (!token || agentPort === null) {
        throw new Error("Authentication is required.");
      }
      return agentClient.createEnvironment(agentPort, token, { name });
    },
    onError: (error) => {
      setNotice({ message: getErrorMessage(error, "Unable to create the environment."), status: "error" });
    },
    onSuccess: (nextState) => applyState(nextState),
  });

  const updateEnvironmentMutation = useMutation({
    mutationFn: async (payload: { environmentId: string; name: string }) => {
      if (!token || agentPort === null) {
        throw new Error("Authentication is required.");
      }
      return agentClient.updateEnvironment(agentPort, token, payload.environmentId, { name: payload.name });
    },
    onError: (error) => {
      setNotice({ message: getErrorMessage(error, "Unable to rename the environment."), status: "error" });
    },
    onSuccess: (nextState) => applyState(nextState),
  });

  const deleteEnvironmentMutation = useMutation({
    mutationFn: async (environmentId: string) => {
      if (!token || agentPort === null) {
        throw new Error("Authentication is required.");
      }
      return agentClient.deleteEnvironment(agentPort, token, environmentId);
    },
    onError: (error) => {
      setNotice({ message: getErrorMessage(error, "Unable to delete the environment."), status: "error" });
    },
    onSuccess: (nextState) => applyState(nextState),
  });

  const saveVariableMutation = useMutation({
    mutationFn: async (row: VariableDraftRow) => {
      if (!token || agentPort === null) {
        throw new Error("Authentication is required.");
      }

      const payload = {
        enabled: row.enabled,
        key: row.key.trim(),
        secret: row.secret,
        values: normalizeVariableRowValues(row.values),
      };

      if (row.isNew) {
        return { nextState: await agentClient.createVariable(agentPort, token, payload), removeDraftId: row.id };
      }

      return { nextState: await agentClient.updateVariable(agentPort, token, row.id, payload) };
    },
    onMutate: (row) => {
      setSavingRowId(row.id);
      return { savedKey: savedRowsById.get(row.id)?.key };
    },
    onError: (error) => {
      setNotice({ message: getErrorMessage(error, "Unable to save the variable row."), status: "error" });
    },
    onSuccess: async ({ nextState, removeDraftId }, row, context) => {
      applyState(nextState, { removeDraftId });
      const oldKey = context?.savedKey?.trim();
      const newKey = row.key.trim();
      if (
        typeof nextState.renamedReferences === "number" &&
        nextState.renamedReferences > 0 &&
        oldKey &&
        oldKey !== newKey
      ) {
        setNotice({
          message: `Renamed {{${oldKey}}} → {{${newKey}}} in ${nextState.renamedReferences} places.`,
          status: "success",
        });
        await invalidateRequestsContentQueries(queryClient);
      }
    },
    onSettled: (_result, _error, row) => {
      setSavingRowId((current) => (current === row.id ? null : current));
    },
  });

  const deleteVariableMutation = useMutation({
    mutationFn: async (row: VariableDraftRow) => {
      if (row.isNew) {
        return { localOnly: true, removeDraftId: row.id } as const;
      }
      if (!token || agentPort === null) {
        throw new Error("Authentication is required.");
      }
      return { nextState: await agentClient.deleteVariable(agentPort, token, row.id), removeDraftId: row.id } as const;
    },
    onError: (error) => {
      setNotice({ message: getErrorMessage(error, "Unable to delete the variable row."), status: "error" });
    },
    onSuccess: (result) => {
      if ("localOnly" in result) {
        setDraftRows((current) => current.filter((row) => row.id !== result.removeDraftId));
        return;
      }
      applyState(result.nextState, { removeDraftId: result.removeDraftId });
    },
  });

  const updateDraftRow = (rowId: string, updater: (row: VariableDraftRow) => VariableDraftRow) => {
    setDraftRows((current) => current.map((row) => (row.id === rowId ? updater(row) : row)));
  };

  const applyToAllEnvironments = (row: VariableDraftRow, mode: "fill-empty" | "overwrite-all") => {
    const sourceValue =
      mode === "fill-empty"
        ? environments.map((environment) => row.values[environment.id] ?? "").find((value) => value.length > 0) ?? ""
        : row.values[environments[0]?.id ?? ""] ?? "";

    const nextValues = { ...row.values };
    for (const environment of environments) {
      if (mode === "fill-empty") {
        if ((nextValues[environment.id] ?? "").length === 0 && sourceValue.length > 0) {
          nextValues[environment.id] = sourceValue;
        }
        continue;
      }

      if (sourceValue.length > 0) {
        nextValues[environment.id] = sourceValue;
      } else {
        delete nextValues[environment.id];
      }
    }

    const nextRow = { ...row, values: nextValues };
    updateDraftRow(row.id, () => nextRow);
    void saveVariableMutation.mutateAsync(nextRow);
  };

  if (preflightQuery.isLoading) {
    return <RequestsLoadingState message="Checking the local companion app before loading environments." />;
  }

  if (companionUnavailable) {
    return (
      <RequestsCompanionUnavailableAlert
        onRetry={() => void preflightQuery.refetch()}
        probedPorts={probedPorts}
      />
    );
  }

  if (preflightQuery.isError) {
    return (
      <RequestsErrorAlert
        error={preflightQuery.error}
        fallback="Unable to detect the local companion app."
        onRetry={() => void preflightQuery.refetch()}
        title="Companion check failed"
      />
    );
  }

  if (environmentsQuery.isLoading) {
    return <RequestsLoadingState message="Loading environments from the companion app." />;
  }

  if (environmentsQuery.isError) {
    return (
      <RequestsErrorAlert
        error={environmentsQuery.error}
        fallback="Unable to load request environments."
        onRetry={() => void environmentsQuery.refetch()}
        title="Environments failed"
      />
    );
  }

  return (
    <Stack gap="md">
      <RequestsNoticeAlert notice={notice} />
      {!canWrite ? (
        <Text c="dimmed" size="sm">
          Read-only access. Environment and variable edit controls are disabled.
        </Text>
      ) : null}
      <RequestsSurface
        description="Variables define {{name}} values per environment; pick the active environment in the builder."
        title="Requests / Environments"
      >
        <Stack gap="lg">
          <Stack gap="sm">
            <Group justify="space-between">
              <Text fw={600}>Environments</Text>
              {canWrite ? (
                <Button
                  leftSection={<IconPlus size={16} />}
                  onClick={() => {
                    const name = window.prompt("Environment name", "");
                    if (!name?.trim()) {
                      return;
                    }
                    void createEnvironmentMutation.mutateAsync(name.trim());
                  }}
                  size="xs"
                  variant="light"
                >
                  Add environment
                </Button>
              ) : null}
            </Group>
            {environments.length === 0 ? (
              <RequestsEmptyCard body="No environments have been created yet." title="Environments" />
            ) : (
              <Table striped withTableBorder>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Name</Table.Th>
                    <Table.Th>Updated</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {environments.map((environment) => (
                    <Table.Tr key={environment.id}>
                      <Table.Td>{environment.name}</Table.Td>
                      <Table.Td>{environment.updatedAt}</Table.Td>
                      <Table.Td>
                        {canWrite ? (
                          <Group gap="xs" justify="flex-end">
                            <Button
                              leftSection={<IconEdit size={16} />}
                              onClick={() => {
                                const nextName = window.prompt("Rename environment", environment.name);
                                if (!nextName?.trim() || nextName.trim() === environment.name) {
                                  return;
                                }
                                void updateEnvironmentMutation.mutateAsync({
                                  environmentId: environment.id,
                                  name: nextName.trim(),
                                });
                              }}
                              size="xs"
                              variant="light"
                            >
                              Rename
                            </Button>
                            <Button
                              color="red"
                              leftSection={<IconTrash size={16} />}
                              onClick={() => {
                                if (window.confirm(`Delete environment ${environment.name}?`)) {
                                  void deleteEnvironmentMutation.mutateAsync(environment.id);
                                }
                              }}
                              size="xs"
                              variant="light"
                            >
                              Delete
                            </Button>
                          </Group>
                        ) : null}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </Stack>

          <Tabs value={activeTab} onChange={(value) => setActiveTab((value as VariableTab | null) ?? "variables")}>
            <Tabs.List>
              <Tabs.Tab value="variables">Variables</Tabs.Tab>
              <Tabs.Tab value="secrets">Secrets</Tabs.Tab>
            </Tabs.List>

            {(["variables", "secrets"] as VariableTab[]).map((tab) => (
              <Tabs.Panel key={tab} pt="md" value={tab}>
                <Stack gap="sm">
                  <Group justify="space-between">
                    <Text fw={600}>{tab === "secrets" ? "Secrets" : "Variables"}</Text>
                    {canWrite ? (
                      <Button
                        leftSection={<IconPlus size={16} />}
                        onClick={() => setDraftRows((current) => [...current, buildNewVariableRow(tab === "secrets")])}
                        size="xs"
                        variant="light"
                      >
                        Add variable
                      </Button>
                    ) : null}
                  </Group>
                  {visibleRows.length === 0 ? (
                    <RequestsEmptyCard
                      body={tab === "secrets" ? "No secret rows yet." : "No variable rows yet."}
                      title={tab === "secrets" ? "Secrets" : "Variables"}
                    />
                  ) : (
                    <Table striped withTableBorder>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th style={{ width: 80 }}>Enabled</Table.Th>
                          <Table.Th style={{ minWidth: 220 }}>Key</Table.Th>
                          {environments.map((environment) => (
                            <Table.Th key={environment.id} style={{ minWidth: 220 }}>
                              {environment.name}
                            </Table.Th>
                          ))}
                          <Table.Th style={{ width: 220 }} />
                        </Table.Tr>
                      </Table.Thead>
                        <Table.Tbody>
                        {visibleRows.map((row, index) => {
                          const rowDirty = isVariableRowDirty(row, savedRowsById.get(row.id));
                          const isSavingRow = saveVariableMutation.isPending && savingRowId === row.id;

                          return (
                            <Table.Tr key={row.id}>
                              <Table.Td>
                                <Checkbox
                                  checked={row.enabled}
                                  disabled={!canWrite}
                                  onChange={(event) => {
                                    const checked = event.currentTarget.checked;
                                    updateDraftRow(row.id, (current) => ({
                                      ...current,
                                      enabled: checked,
                                    }));
                                  }}
                                />
                              </Table.Td>
                              <Table.Td>
                                <TextInput
                                  aria-label={`Variable key ${index + 1}`}
                                  disabled={!canWrite}
                                  onChange={(event) => {
                                    const value = event.currentTarget.value;
                                    updateDraftRow(row.id, (current) => ({ ...current, key: value }));
                                  }}
                                  value={row.key}
                                />
                              </Table.Td>
                              {environments.map((environment) => (
                                <Table.Td key={environment.id}>
                                  <TextInput
                                    aria-label={`${environment.name} value ${index + 1}`}
                                    disabled={!canWrite}
                                    onChange={(event) => {
                                      const value = event.currentTarget.value;
                                      updateDraftRow(row.id, (current) => ({
                                        ...current,
                                        values: value.length > 0
                                          ? { ...current.values, [environment.id]: value }
                                          : Object.fromEntries(
                                              Object.entries(current.values).filter(
                                                ([key]) => key !== environment.id
                                              )
                                            ),
                                      }));
                                    }}
                                    value={row.values[environment.id] ?? ""}
                                  />
                                </Table.Td>
                              ))}
                              <Table.Td>
                                {canWrite ? (
                                  <Group gap="xs" justify="flex-end" wrap="nowrap">
                                    <Button
                                      disabled={!rowDirty || isSavingRow}
                                      leftSection={<IconDeviceFloppy size={16} />}
                                      loading={isSavingRow}
                                      onClick={() => void saveVariableMutation.mutateAsync(row)}
                                      size="xs"
                                      variant="light"
                                    >
                                      Save
                                    </Button>
                                    <Menu withinPortal>
                                      <Menu.Target>
                                        <ActionIcon
                                          aria-label={`Apply ${row.key || index + 1} to all environments`}
                                          variant="light"
                                        >
                                          <IconDots size={16} />
                                        </ActionIcon>
                                      </Menu.Target>
                                      <Menu.Dropdown>
                                        <Menu.Item onClick={() => applyToAllEnvironments(row, "fill-empty")}>
                                          Fill empty cells from first non-empty
                                        </Menu.Item>
                                        <Menu.Item onClick={() => applyToAllEnvironments(row, "overwrite-all")}>
                                          Overwrite all with first cell
                                        </Menu.Item>
                                      </Menu.Dropdown>
                                    </Menu>
                                    <ActionIcon
                                      aria-label={`Delete variable ${index + 1}`}
                                      color="red"
                                      onClick={() => void deleteVariableMutation.mutateAsync(row)}
                                      variant="light"
                                    >
                                      <IconTrash size={16} />
                                    </ActionIcon>
                                  </Group>
                                ) : null}
                              </Table.Td>
                            </Table.Tr>
                          );
                        })}
                        </Table.Tbody>
                    </Table>
                  )}
                </Stack>
              </Tabs.Panel>
            ))}
          </Tabs>
        </Stack>
      </RequestsSurface>
    </Stack>
  );
}
