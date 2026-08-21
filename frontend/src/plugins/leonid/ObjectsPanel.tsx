import { useState } from "react";
import {
  Alert,
  Button,
  Group,
  Loader,
  Modal,
  NumberInput,
  Paper,
  Select,
  Stack,
  Switch,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { agentClient } from "@/api/agentClient";
import type {
  LeonidObjectDefinition,
  LeonidObjectDefinitionInput,
  LeonidObjectValue,
  LeonidObjectValueInput,
} from "@/api/types";
import { QueryKey } from "@/constants";
import { useAuthStore } from "@/store/authStore";

interface ObjectsPanelProps {
  agentPort: number;
}

interface DefinitionFormState {
  object_name: string;
  comment: string;
  enabled: boolean;
}

interface ValueFormState {
  object: string;
  environment: number | string;
  value: string;
  comment: string;
  enabled: boolean;
}

interface DeleteTarget {
  kind: "definition" | "value";
  id: number;
  label: string;
}

const EMPTY_DEFINITION_FORM: DefinitionFormState = {
  object_name: "",
  comment: "",
  enabled: true,
};

const EMPTY_VALUE_FORM: ValueFormState = {
  object: "",
  environment: 0,
  value: "",
  comment: "",
  enabled: true,
};

function formatError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function ObjectsPanel({ agentPort }: ObjectsPanelProps) {
  const token = useAuthStore((state) => state.token) ?? "";
  const queryClient = useQueryClient();

  const definitionsQuery = useQuery({
    queryFn: ({ signal }) => agentClient.listLeonidObjectDefinitions(agentPort, token, signal),
    queryKey: [QueryKey.LEONID_OBJECT_DEFINITIONS, agentPort, token],
  });
  const valuesQuery = useQuery({
    queryFn: ({ signal }) => agentClient.listLeonidObjectValues(agentPort, token, signal),
    queryKey: [QueryKey.LEONID_OBJECT_VALUES, agentPort, token],
  });

  const [definitionModalOpen, setDefinitionModalOpen] = useState(false);
  const [editingDefinitionId, setEditingDefinitionId] = useState<number | null>(null);
  const [definitionForm, setDefinitionForm] = useState<DefinitionFormState>(EMPTY_DEFINITION_FORM);

  const [valueModalOpen, setValueModalOpen] = useState(false);
  const [editingValueId, setEditingValueId] = useState<number | null>(null);
  const [valueForm, setValueForm] = useState<ValueFormState>(EMPTY_VALUE_FORM);

  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  const invalidateDefinitions = () =>
    queryClient.invalidateQueries({ queryKey: [QueryKey.LEONID_OBJECT_DEFINITIONS] });
  const invalidateValues = () => queryClient.invalidateQueries({ queryKey: [QueryKey.LEONID_OBJECT_VALUES] });

  const definitionMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number | null; payload: LeonidObjectDefinitionInput }) =>
      id === null
        ? agentClient.createLeonidObjectDefinition(agentPort, token, payload)
        : agentClient.updateLeonidObjectDefinition(agentPort, token, id, payload),
    onSuccess: async () => {
      await invalidateDefinitions();
      setDefinitionModalOpen(false);
    },
  });
  const valueMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number | null; payload: LeonidObjectValueInput }) =>
      id === null
        ? agentClient.createLeonidObjectValue(agentPort, token, payload)
        : agentClient.updateLeonidObjectValue(agentPort, token, id, payload),
    onSuccess: async () => {
      await invalidateValues();
      setValueModalOpen(false);
    },
  });
  const toggleDefinitionMutation = useMutation({
    mutationFn: (definition: LeonidObjectDefinition) =>
      agentClient.toggleLeonidObjectDefinition(agentPort, token, definition.id),
    onSuccess: invalidateDefinitions,
  });
  const toggleValueMutation = useMutation({
    mutationFn: (value: LeonidObjectValue) => agentClient.toggleLeonidObjectValue(agentPort, token, value.id),
    onSuccess: invalidateValues,
  });
  const deleteMutation = useMutation({
    mutationFn: (target: DeleteTarget) =>
      target.kind === "definition"
        ? agentClient.deleteLeonidObjectDefinition(agentPort, token, target.id)
        : agentClient.deleteLeonidObjectValue(agentPort, token, target.id),
    onSuccess: async (_data, target) => {
      await (target.kind === "definition" ? invalidateDefinitions() : invalidateValues());
      setDeleteTarget(null);
    },
  });

  function openCreateDefinition(): void {
    setEditingDefinitionId(null);
    setDefinitionForm(EMPTY_DEFINITION_FORM);
    setDefinitionModalOpen(true);
  }

  function openEditDefinition(definition: LeonidObjectDefinition): void {
    setEditingDefinitionId(definition.id);
    setDefinitionForm({
      object_name: definition.object_name,
      comment: definition.comment ?? "",
      enabled: definition.enabled,
    });
    setDefinitionModalOpen(true);
  }

  function submitDefinition(): void {
    definitionMutation.mutate({
      id: editingDefinitionId,
      payload: {
        object_name: definitionForm.object_name.trim(),
        comment: definitionForm.comment.trim() ? definitionForm.comment.trim() : null,
        enabled: definitionForm.enabled,
      },
    });
  }

  function openCreateValue(): void {
    setEditingValueId(null);
    setValueForm(EMPTY_VALUE_FORM);
    setValueModalOpen(true);
  }

  function openEditValue(value: LeonidObjectValue): void {
    setEditingValueId(value.id);
    setValueForm({
      object: String(value.object),
      environment: value.environment,
      value: value.value,
      comment: value.comment ?? "",
      enabled: value.enabled,
    });
    setValueModalOpen(true);
  }

  function submitValue(): void {
    valueMutation.mutate({
      id: editingValueId,
      payload: {
        object: Number(valueForm.object),
        environment: Number(valueForm.environment),
        value: valueForm.value.trim(),
        comment: valueForm.comment.trim() ? valueForm.comment.trim() : null,
        enabled: valueForm.enabled,
      },
    });
  }

  const definitionOptions = (definitionsQuery.data ?? []).map((item) => ({
    label: item.object_name,
    value: String(item.id),
  }));
  const definitionNameById = new Map(
    (definitionsQuery.data ?? []).map((item) => [item.id, item.object_name])
  );

  const error =
    definitionsQuery.error ??
    valuesQuery.error ??
    definitionMutation.error ??
    valueMutation.error ??
    toggleDefinitionMutation.error ??
    toggleValueMutation.error ??
    deleteMutation.error;
  const isLoading = definitionsQuery.isLoading || valuesQuery.isLoading;
  const definitionFormValid = definitionForm.object_name.trim().length > 0;
  const valueFormValid = valueForm.object !== "" && valueForm.value.trim().length > 0;

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Objects not to delete</Title>
        <Text c="dimmed">Manage protected object definitions and their per-environment values.</Text>
      </div>

      {error ? (
        <Alert color="red" title="Leonid objects failed">
          {formatError(error, "Unable to load or update Leonid objects.")}
        </Alert>
      ) : null}

      {isLoading ? (
        <Stack align="center" py="xl">
          <Loader />
          <Text c="dimmed">Loading Leonid objects.</Text>
        </Stack>
      ) : (
        <Tabs defaultValue="definitions">
          <Tabs.List>
            <Tabs.Tab value="definitions">Definitions</Tabs.Tab>
            <Tabs.Tab value="values">Values</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel keepMounted={false} pt="md" value="definitions">
          <Paper p="md" withBorder>
            <Stack gap="md">
              <Group justify="space-between">
                <Text fw={600}>Object definitions</Text>
                <Button aria-label="Add object definition" onClick={openCreateDefinition} size="xs">
                  Add object definition
                </Button>
              </Group>
              {(definitionsQuery.data ?? []).length > 0 ? (
                <Table highlightOnHover striped withTableBorder>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Object name</Table.Th>
                      <Table.Th>Comment</Table.Th>
                      <Table.Th>Enabled</Table.Th>
                      <Table.Th>Actions</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {(definitionsQuery.data ?? []).map((definition) => (
                      <Table.Tr key={definition.id}>
                        <Table.Td>{definition.object_name}</Table.Td>
                        <Table.Td>{definition.comment ?? "—"}</Table.Td>
                        <Table.Td>{definition.enabled ? "Yes" : "No"}</Table.Td>
                        <Table.Td>
                          <Group gap="xs">
                            <Button
                              aria-label={`Toggle object definition ${definition.object_name}`}
                              onClick={() => toggleDefinitionMutation.mutate(definition)}
                              size="xs"
                              variant="light"
                            >
                              {definition.enabled ? "Disable" : "Enable"}
                            </Button>
                            <Button
                              aria-label={`Edit object definition ${definition.object_name}`}
                              onClick={() => openEditDefinition(definition)}
                              size="xs"
                              variant="light"
                            >
                              Edit
                            </Button>
                            <Button
                              aria-label={`Delete object definition ${definition.object_name}`}
                              color="red"
                              onClick={() =>
                                setDeleteTarget({
                                  id: definition.id,
                                  kind: "definition",
                                  label: definition.object_name,
                                })
                              }
                              size="xs"
                              variant="light"
                            >
                              Delete
                            </Button>
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              ) : (
                <Text c="dimmed">No object definitions were returned.</Text>
              )}
            </Stack>
          </Paper>
          </Tabs.Panel>

          <Tabs.Panel keepMounted={false} pt="md" value="values">
          <Paper p="md" withBorder>
            <Stack gap="md">
              <Group justify="space-between">
                <Text fw={600}>Object values</Text>
                <Button aria-label="Add object value" onClick={openCreateValue} size="xs">
                  Add object value
                </Button>
              </Group>
              {(valuesQuery.data ?? []).length > 0 ? (
                <Table highlightOnHover striped withTableBorder>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Object</Table.Th>
                      <Table.Th>Environment</Table.Th>
                      <Table.Th>Value</Table.Th>
                      <Table.Th>Comment</Table.Th>
                      <Table.Th>Enabled</Table.Th>
                      <Table.Th>Actions</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {(valuesQuery.data ?? []).map((value) => (
                      <Table.Tr key={value.id}>
                        <Table.Td>{definitionNameById.get(value.object) ?? value.object}</Table.Td>
                        <Table.Td>{value.environment}</Table.Td>
                        <Table.Td>{value.value}</Table.Td>
                        <Table.Td>{value.comment ?? "—"}</Table.Td>
                        <Table.Td>{value.enabled ? "Yes" : "No"}</Table.Td>
                        <Table.Td>
                          <Group gap="xs">
                            <Button
                              aria-label={`Toggle object value ${value.value}`}
                              onClick={() => toggleValueMutation.mutate(value)}
                              size="xs"
                              variant="light"
                            >
                              {value.enabled ? "Disable" : "Enable"}
                            </Button>
                            <Button
                              aria-label={`Edit object value ${value.value}`}
                              onClick={() => openEditValue(value)}
                              size="xs"
                              variant="light"
                            >
                              Edit
                            </Button>
                            <Button
                              aria-label={`Delete object value ${value.value}`}
                              color="red"
                              onClick={() => setDeleteTarget({ id: value.id, kind: "value", label: value.value })}
                              size="xs"
                              variant="light"
                            >
                              Delete
                            </Button>
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              ) : (
                <Text c="dimmed">No object values were returned.</Text>
              )}
            </Stack>
          </Paper>
          </Tabs.Panel>
        </Tabs>
      )}

      <Modal
        onClose={() => setDefinitionModalOpen(false)}
        opened={definitionModalOpen}
        title={editingDefinitionId === null ? "Add object definition" : "Edit object definition"}
      >
        <Stack>
          <TextInput
            label="Object name"
            onChange={(event) =>
              setDefinitionForm((form) => ({ ...form, object_name: event.target.value }))
            }
            value={definitionForm.object_name}
          />
          <TextInput
            label="Comment"
            onChange={(event) => setDefinitionForm((form) => ({ ...form, comment: event.target.value }))}
            value={definitionForm.comment}
          />
          <Switch
            checked={definitionForm.enabled}
            label="Enabled"
            onChange={(event) =>
              setDefinitionForm((form) => ({ ...form, enabled: event.target.checked }))
            }
          />
          <Group justify="flex-end">
            <Button onClick={() => setDefinitionModalOpen(false)} variant="default">
              Cancel
            </Button>
            <Button
              disabled={!definitionFormValid}
              loading={definitionMutation.isPending}
              onClick={submitDefinition}
            >
              Save
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        onClose={() => setValueModalOpen(false)}
        opened={valueModalOpen}
        title={editingValueId === null ? "Add object value" : "Edit object value"}
      >
        <Stack>
          <Select
            data={definitionOptions}
            label="Object"
            onChange={(value) => setValueForm((form) => ({ ...form, object: value ?? "" }))}
            value={valueForm.object || null}
          />
          <NumberInput
            description="Environment id"
            label="Environment"
            onChange={(value) => setValueForm((form) => ({ ...form, environment: value }))}
            value={valueForm.environment}
          />
          <TextInput
            label="Value"
            onChange={(event) => setValueForm((form) => ({ ...form, value: event.target.value }))}
            value={valueForm.value}
          />
          <TextInput
            label="Comment"
            onChange={(event) => setValueForm((form) => ({ ...form, comment: event.target.value }))}
            value={valueForm.comment}
          />
          <Switch
            checked={valueForm.enabled}
            label="Enabled"
            onChange={(event) => setValueForm((form) => ({ ...form, enabled: event.target.checked }))}
          />
          <Group justify="flex-end">
            <Button onClick={() => setValueModalOpen(false)} variant="default">
              Cancel
            </Button>
            <Button disabled={!valueFormValid} loading={valueMutation.isPending} onClick={submitValue}>
              Save
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal onClose={() => setDeleteTarget(null)} opened={deleteTarget !== null} title="Confirm delete">
        <Stack>
          <Text>Delete {deleteTarget?.label}?</Text>
          <Group justify="flex-end">
            <Button onClick={() => setDeleteTarget(null)} variant="default">
              Cancel
            </Button>
            <Button
              color="red"
              loading={deleteMutation.isPending}
              onClick={() => {
                if (deleteTarget) {
                  deleteMutation.mutate(deleteTarget);
                }
              }}
            >
              Delete
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
