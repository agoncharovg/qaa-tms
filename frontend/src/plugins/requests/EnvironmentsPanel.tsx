import { useMemo, useState } from "react";
import {
  ActionIcon,
  Badge,
  Button,
  Checkbox,
  Group,
  Modal,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { agentClient } from "@/api/agentClient";
import type { RequestsEnvironment, RequestsEnvironmentVariable } from "@/api/types";
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
import { getErrorMessage, type RequestsNotice, useRequestsAgent } from "@/plugins/requests/requestsShared";
import { useAuthStore } from "@/store/authStore";

const REQUESTS_WRITE_PERMISSION = "requests.write";

type EnvironmentFormState = {
  id: string | null;
  isEdit: boolean;
  name: string;
  variables: RequestsEnvironmentVariable[];
};

function buildEmptyVariable(): RequestsEnvironmentVariable {
  return { enabled: true, key: "", value: "" };
}

function ensureVariableRows(rows: RequestsEnvironmentVariable[]): RequestsEnvironmentVariable[] {
  return rows.length > 0 ? rows : [buildEmptyVariable()];
}

function buildEmptyEnvironmentForm(): EnvironmentFormState {
  return {
    id: null,
    isEdit: false,
    name: "",
    variables: [buildEmptyVariable()],
  };
}

function buildFormFromEnvironment(environment: RequestsEnvironment): EnvironmentFormState {
  return {
    id: environment.id,
    isEdit: true,
    name: environment.name,
    variables: ensureVariableRows(environment.variables.map((variable) => ({ ...variable }))),
  };
}

function buildEnvironmentPayload(form: EnvironmentFormState): {
  name: string;
  variables: RequestsEnvironmentVariable[];
} {
  return {
    name: form.name.trim(),
    variables: form.variables.filter(
      (variable) => variable.key.trim().length > 0 || variable.value.trim().length > 0
    ),
  };
}

export function EnvironmentsPanel() {
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((state) => state.currentUser);
  const canWrite = hasPermission(currentUser, REQUESTS_WRITE_PERMISSION);
  const { agentPort, companionUnavailable, preflightQuery, probedPorts, token } = useRequestsAgent();
  const [notice, setNotice] = useState<RequestsNotice | null>(null);
  const [form, setForm] = useState<EnvironmentFormState>(() => buildEmptyEnvironmentForm());
  const [modalOpen, setModalOpen] = useState(false);

  const environmentsQuery = useQuery({
    enabled: Boolean(token && agentPort !== null),
    queryFn: ({ signal }) => agentClient.listEnvironments(agentPort ?? 0, token ?? "", signal),
    queryKey: [QueryKey.REQUESTS_ENVIRONMENTS, token, agentPort],
    refetchOnWindowFocus: false,
    retry: false,
  });

  const environments = useMemo(
    () => environmentsQuery.data?.environments ?? [],
    [environmentsQuery.data?.environments]
  );
  const activeId = environmentsQuery.data?.activeId ?? null;
  const environmentOptions = useMemo(
    () => [
      { label: "No environment", value: "__none__" },
      ...environments.map((environment) => ({
        label: environment.name,
        value: environment.id,
      })),
    ],
    [environments]
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!token || agentPort === null) {
        throw new Error("Authentication is required.");
      }

      const payload = buildEnvironmentPayload(form);
      if (form.isEdit && form.id) {
        return agentClient.updateEnvironment(agentPort, token, form.id, payload);
      }

      return agentClient.createEnvironment(agentPort, token, payload);
    },
    onError: (error) => {
      setNotice({ message: getErrorMessage(error, "Unable to save the environment."), status: "error" });
    },
    onSuccess: async () => {
      setModalOpen(false);
      setForm(buildEmptyEnvironmentForm());
      await queryClient.invalidateQueries({ queryKey: [QueryKey.REQUESTS_ENVIRONMENTS] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (environmentId: string) => {
      if (!token || agentPort === null) {
        throw new Error("Authentication is required.");
      }
      return agentClient.deleteEnvironment(agentPort, token, environmentId);
    },
    onError: (error) => {
      setNotice({ message: getErrorMessage(error, "Unable to delete the environment."), status: "error" });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [QueryKey.REQUESTS_ENVIRONMENTS] });
    },
  });

  const setActiveMutation = useMutation({
    mutationFn: async (environmentId: string | null) => {
      if (!token || agentPort === null) {
        throw new Error("Authentication is required.");
      }
      return agentClient.setActiveEnvironment(agentPort, token, environmentId);
    },
    onError: (error) => {
      setNotice({ message: getErrorMessage(error, "Unable to change the active environment."), status: "error" });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [QueryKey.REQUESTS_ENVIRONMENTS] });
    },
  });

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
          Read-only access. Environment create, edit, delete, and active selection controls are disabled.
        </Text>
      ) : null}
      <RequestsSurface
        description="The active environment resolves {{variables}} in request URL, headers, params, and body right before send or curl export."
        title="Environments"
      >
        <Stack gap="md">
          <Group align="flex-end" justify="space-between" wrap="wrap">
            <Select
              data={environmentOptions}
              disabled={!canWrite}
              label="Active environment"
              onChange={(value) => {
                void setActiveMutation.mutateAsync(value === "__none__" ? null : value ?? null);
              }}
              value={activeId ?? "__none__"}
              w={260}
            />
            {canWrite ? (
              <Button
                leftSection={<IconPlus size={16} />}
                onClick={() => {
                  setForm(buildEmptyEnvironmentForm());
                  setModalOpen(true);
                }}
              >
                New environment
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
                  <Table.Th>Variables</Table.Th>
                  <Table.Th>Updated</Table.Th>
                  <Table.Th></Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {environments.map((environment) => (
                  <Table.Tr key={environment.id}>
                    <Table.Td>
                      <Group gap="xs">
                        <Text>{environment.name}</Text>
                        {environment.id === activeId ? <Badge variant="light">Active</Badge> : null}
                      </Group>
                    </Table.Td>
                    <Table.Td>{environment.variables.length}</Table.Td>
                    <Table.Td>{environment.updatedAt}</Table.Td>
                    <Table.Td>
                      {canWrite ? (
                        <Group gap="xs" justify="flex-end">
                          <Button
                            onClick={() => {
                              setForm(buildFormFromEnvironment(environment));
                              setModalOpen(true);
                            }}
                            size="xs"
                            variant="light"
                          >
                            Edit
                          </Button>
                          <Button
                            color="red"
                            leftSection={<IconTrash size={16} />}
                            onClick={() => {
                              if (window.confirm(`Delete environment ${environment.name}?`)) {
                                void deleteMutation.mutateAsync(environment.id);
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
      </RequestsSurface>
      <Modal
        onClose={() => {
          setModalOpen(false);
          setForm(buildEmptyEnvironmentForm());
        }}
        opened={modalOpen}
        size="xl"
        title={form.isEdit ? "Edit environment" : "Create environment"}
      >
        <Stack gap="sm">
          <TextInput
            label="Name"
            onChange={(event) => setForm((current) => ({ ...current, name: event.currentTarget.value }))}
            value={form.name}
          />
          <Stack gap="sm">
            <Group justify="space-between">
              <Text fw={600}>Variables</Text>
              <Button
                leftSection={<IconPlus size={16} />}
                onClick={() =>
                  setForm((current) => ({ ...current, variables: [...current.variables, buildEmptyVariable()] }))
                }
                size="xs"
                variant="light"
              >
                Add variable
              </Button>
            </Group>
            <Table striped withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th style={{ width: 64 }}>Enabled</Table.Th>
                  <Table.Th style={{ width: "25%" }}>Key</Table.Th>
                  <Table.Th>Value</Table.Th>
                  <Table.Th style={{ width: 44 }}></Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {form.variables.map((variable, index) => (
                  <Table.Tr key={`variable-${index}`}>
                    <Table.Td>
                      <Checkbox
                        checked={variable.enabled}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            variables: current.variables.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, enabled: event.currentTarget.checked }
                                : item
                            ),
                          }))
                        }
                      />
                    </Table.Td>
                    <Table.Td>
                      <TextInput
                        aria-label={`Variable key ${index + 1}`}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            variables: current.variables.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, key: event.currentTarget.value } : item
                            ),
                          }))
                        }
                        value={variable.key}
                      />
                    </Table.Td>
                    <Table.Td>
                      <TextInput
                        aria-label={`Variable value ${index + 1}`}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            variables: current.variables.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, value: event.currentTarget.value } : item
                            ),
                          }))
                        }
                        value={variable.value}
                      />
                    </Table.Td>
                    <Table.Td>
                      <ActionIcon
                        aria-label={`Remove variable ${index + 1}`}
                        color="red"
                        onClick={() =>
                          setForm((current) => ({
                            ...current,
                            variables: ensureVariableRows(
                              current.variables.filter((_, itemIndex) => itemIndex !== index)
                            ),
                          }))
                        }
                        variant="light"
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Stack>
          <Group justify="flex-end">
            <Button
              onClick={() => {
                setModalOpen(false);
                setForm(buildEmptyEnvironmentForm());
              }}
              variant="default"
            >
              Cancel
            </Button>
            <Button loading={saveMutation.isPending} onClick={() => void saveMutation.mutateAsync()}>
              Save
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
