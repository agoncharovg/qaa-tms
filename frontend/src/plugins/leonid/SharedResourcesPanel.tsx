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
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { agentClient } from "@/api/agentClient";
import type {
  LeonidSharedResource,
  LeonidSharedResourceInput,
  LeonidSharedResourceLimit,
  LeonidSharedResourceLimitInput,
} from "@/api/types";
import { QueryKey } from "@/constants";
import { useAuthStore } from "@/store/authStore";

interface SharedResourcesPanelProps {
  agentPort: number;
}

interface LimitFormState {
  resource_name: string;
  limit_type: string;
  limit_value: number | string;
  reset_date: string;
}

interface ResourceFormState {
  resource_limit: string;
  value: string;
  count: number | string;
  enabled: boolean;
}

interface DeleteTarget {
  kind: "limit" | "resource";
  id: number;
  label: string;
}

const EMPTY_LIMIT_FORM: LimitFormState = {
  resource_name: "",
  limit_type: "",
  limit_value: 0,
  reset_date: "",
};

const EMPTY_RESOURCE_FORM: ResourceFormState = {
  resource_limit: "",
  value: "",
  count: 0,
  enabled: true,
};

function formatError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function SharedResourcesPanel({ agentPort }: SharedResourcesPanelProps) {
  const token = useAuthStore((state) => state.token) ?? "";
  const queryClient = useQueryClient();

  const limitTypesQuery = useQuery({
    queryFn: ({ signal }) => agentClient.listLeonidSharedResourceLimitTypes(agentPort, token, signal),
    queryKey: [QueryKey.LEONID_SHARED_RESOURCE_LIMIT_TYPES, agentPort, token],
  });
  const limitsQuery = useQuery({
    queryFn: ({ signal }) => agentClient.listLeonidSharedResourceLimits(agentPort, token, signal),
    queryKey: [QueryKey.LEONID_SHARED_RESOURCE_LIMITS, agentPort, token],
  });
  const resourcesQuery = useQuery({
    queryFn: ({ signal }) => agentClient.listLeonidSharedResources(agentPort, token, signal),
    queryKey: [QueryKey.LEONID_SHARED_RESOURCES, agentPort, token],
  });

  const [limitModalOpen, setLimitModalOpen] = useState(false);
  const [editingLimitId, setEditingLimitId] = useState<number | null>(null);
  const [limitForm, setLimitForm] = useState<LimitFormState>(EMPTY_LIMIT_FORM);

  const [resourceModalOpen, setResourceModalOpen] = useState(false);
  const [editingResourceId, setEditingResourceId] = useState<number | null>(null);
  const [resourceForm, setResourceForm] = useState<ResourceFormState>(EMPTY_RESOURCE_FORM);

  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  const invalidateLimits = () =>
    queryClient.invalidateQueries({ queryKey: [QueryKey.LEONID_SHARED_RESOURCE_LIMITS] });
  const invalidateResources = () =>
    queryClient.invalidateQueries({ queryKey: [QueryKey.LEONID_SHARED_RESOURCES] });

  const limitMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number | null; payload: LeonidSharedResourceLimitInput }) =>
      id === null
        ? agentClient.createLeonidSharedResourceLimit(agentPort, token, payload)
        : agentClient.updateLeonidSharedResourceLimit(agentPort, token, id, payload),
    onSuccess: async () => {
      await invalidateLimits();
      setLimitModalOpen(false);
    },
  });
  const resourceMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number | null; payload: LeonidSharedResourceInput }) =>
      id === null
        ? agentClient.createLeonidSharedResource(agentPort, token, payload)
        : agentClient.updateLeonidSharedResource(agentPort, token, id, payload),
    onSuccess: async () => {
      await invalidateResources();
      setResourceModalOpen(false);
    },
  });
  const toggleResourceMutation = useMutation({
    mutationFn: (resource: LeonidSharedResource) =>
      agentClient.toggleLeonidSharedResource(agentPort, token, resource.id),
    onSuccess: invalidateResources,
  });
  const deleteMutation = useMutation({
    mutationFn: (target: DeleteTarget) =>
      target.kind === "limit"
        ? agentClient.deleteLeonidSharedResourceLimit(agentPort, token, target.id)
        : agentClient.deleteLeonidSharedResource(agentPort, token, target.id),
    onSuccess: async (_data, target) => {
      await (target.kind === "limit" ? invalidateLimits() : invalidateResources());
      setDeleteTarget(null);
    },
  });

  function openCreateLimit(): void {
    setEditingLimitId(null);
    setLimitForm(EMPTY_LIMIT_FORM);
    setLimitModalOpen(true);
  }

  function openEditLimit(limit: LeonidSharedResourceLimit): void {
    setEditingLimitId(limit.id);
    setLimitForm({
      resource_name: limit.resource_name,
      limit_type: String(limit.limit_type),
      limit_value: limit.limit_value,
      reset_date: limit.reset_date ?? "",
    });
    setLimitModalOpen(true);
  }

  function submitLimit(): void {
    limitMutation.mutate({
      id: editingLimitId,
      payload: {
        resource_name: limitForm.resource_name.trim(),
        limit_type: Number(limitForm.limit_type),
        limit_value: Number(limitForm.limit_value),
        reset_date: limitForm.reset_date.trim() ? limitForm.reset_date.trim() : null,
      },
    });
  }

  function openCreateResource(): void {
    setEditingResourceId(null);
    setResourceForm(EMPTY_RESOURCE_FORM);
    setResourceModalOpen(true);
  }

  function openEditResource(resource: LeonidSharedResource): void {
    setEditingResourceId(resource.id);
    setResourceForm({
      resource_limit: String(resource.resource_limit),
      value: resource.value,
      count: resource.count,
      enabled: resource.enabled,
    });
    setResourceModalOpen(true);
  }

  function submitResource(): void {
    resourceMutation.mutate({
      id: editingResourceId,
      payload: {
        resource_limit: Number(resourceForm.resource_limit),
        value: resourceForm.value.trim(),
        count: Number(resourceForm.count),
        enabled: resourceForm.enabled,
      },
    });
  }

  const limitTypeOptions = (limitTypesQuery.data ?? []).map((item) => ({
    label: item.name,
    value: String(item.id),
  }));
  const limitOptions = (limitsQuery.data ?? []).map((item) => ({
    label: item.resource_name,
    value: String(item.id),
  }));
  const limitNameById = new Map((limitsQuery.data ?? []).map((item) => [item.id, item.resource_name]));

  const error =
    limitTypesQuery.error ??
    limitsQuery.error ??
    resourcesQuery.error ??
    limitMutation.error ??
    resourceMutation.error ??
    toggleResourceMutation.error ??
    deleteMutation.error;
  const isLoading = limitTypesQuery.isLoading || limitsQuery.isLoading || resourcesQuery.isLoading;
  const limitFormValid = limitForm.resource_name.trim().length > 0 && limitForm.limit_type !== "";
  const resourceFormValid = resourceForm.resource_limit !== "" && resourceForm.value.trim().length > 0;

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Shared resources</Title>
        <Text c="dimmed">Manage shared-resource limits and their pooled values used by test runs.</Text>
      </div>

      {error ? (
        <Alert color="red" title="Leonid shared resources failed">
          {formatError(error, "Unable to load or update Leonid shared resources.")}
        </Alert>
      ) : null}

      {isLoading ? (
        <Stack align="center" py="xl">
          <Loader />
          <Text c="dimmed">Loading Leonid shared resources.</Text>
        </Stack>
      ) : (
        <>
          <Paper p="md" withBorder>
            <Stack gap="md">
              <Group justify="space-between">
                <Text fw={600}>Limits</Text>
                <Button aria-label="Add limit" onClick={openCreateLimit} size="xs">
                  Add limit
                </Button>
              </Group>
              {(limitsQuery.data ?? []).length > 0 ? (
                <Table highlightOnHover striped withTableBorder>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Resource name</Table.Th>
                      <Table.Th>Limit type</Table.Th>
                      <Table.Th>Limit value</Table.Th>
                      <Table.Th>Reset date</Table.Th>
                      <Table.Th>Actions</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {(limitsQuery.data ?? []).map((limit) => (
                      <Table.Tr key={limit.id}>
                        <Table.Td>{limit.resource_name}</Table.Td>
                        <Table.Td>
                          {limitTypeOptions.find((option) => option.value === String(limit.limit_type))?.label ??
                            limit.limit_type}
                        </Table.Td>
                        <Table.Td>{limit.limit_value}</Table.Td>
                        <Table.Td>{limit.reset_date ?? "—"}</Table.Td>
                        <Table.Td>
                          <Group gap="xs">
                            <Button
                              aria-label={`Edit limit ${limit.resource_name}`}
                              onClick={() => openEditLimit(limit)}
                              size="xs"
                              variant="light"
                            >
                              Edit
                            </Button>
                            <Button
                              aria-label={`Delete limit ${limit.resource_name}`}
                              color="red"
                              onClick={() =>
                                setDeleteTarget({ id: limit.id, kind: "limit", label: limit.resource_name })
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
                <Text c="dimmed">No limits were returned.</Text>
              )}
            </Stack>
          </Paper>

          <Paper p="md" withBorder>
            <Stack gap="md">
              <Group justify="space-between">
                <Text fw={600}>Resources</Text>
                <Button aria-label="Add resource" onClick={openCreateResource} size="xs">
                  Add resource
                </Button>
              </Group>
              {(resourcesQuery.data ?? []).length > 0 ? (
                <Table highlightOnHover striped withTableBorder>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Limit</Table.Th>
                      <Table.Th>Value</Table.Th>
                      <Table.Th>Count</Table.Th>
                      <Table.Th>Enabled</Table.Th>
                      <Table.Th>Actions</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {(resourcesQuery.data ?? []).map((resource) => (
                      <Table.Tr key={resource.id}>
                        <Table.Td>{limitNameById.get(resource.resource_limit) ?? resource.resource_limit}</Table.Td>
                        <Table.Td>{resource.value}</Table.Td>
                        <Table.Td>{resource.count}</Table.Td>
                        <Table.Td>{resource.enabled ? "Yes" : "No"}</Table.Td>
                        <Table.Td>
                          <Group gap="xs">
                            <Button
                              aria-label={`Toggle resource ${resource.value}`}
                              onClick={() => toggleResourceMutation.mutate(resource)}
                              size="xs"
                              variant="light"
                            >
                              {resource.enabled ? "Disable" : "Enable"}
                            </Button>
                            <Button
                              aria-label={`Edit resource ${resource.value}`}
                              onClick={() => openEditResource(resource)}
                              size="xs"
                              variant="light"
                            >
                              Edit
                            </Button>
                            <Button
                              aria-label={`Delete resource ${resource.value}`}
                              color="red"
                              onClick={() =>
                                setDeleteTarget({ id: resource.id, kind: "resource", label: resource.value })
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
                <Text c="dimmed">No resources were returned.</Text>
              )}
            </Stack>
          </Paper>
        </>
      )}

      <Modal
        onClose={() => setLimitModalOpen(false)}
        opened={limitModalOpen}
        title={editingLimitId === null ? "Add limit" : "Edit limit"}
      >
        <Stack>
          <TextInput
            label="Resource name"
            onChange={(event) => setLimitForm((form) => ({ ...form, resource_name: event.target.value }))}
            value={limitForm.resource_name}
          />
          <Select
            data={limitTypeOptions}
            label="Limit type"
            onChange={(value) => setLimitForm((form) => ({ ...form, limit_type: value ?? "" }))}
            value={limitForm.limit_type || null}
          />
          <NumberInput
            label="Limit value"
            onChange={(value) => setLimitForm((form) => ({ ...form, limit_value: value }))}
            value={limitForm.limit_value}
          />
          <TextInput
            description="YYYY-MM-DD, leave empty for none"
            label="Reset date"
            onChange={(event) => setLimitForm((form) => ({ ...form, reset_date: event.target.value }))}
            value={limitForm.reset_date}
          />
          <Group justify="flex-end">
            <Button onClick={() => setLimitModalOpen(false)} variant="default">
              Cancel
            </Button>
            <Button
              disabled={!limitFormValid}
              loading={limitMutation.isPending}
              onClick={submitLimit}
            >
              Save
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        onClose={() => setResourceModalOpen(false)}
        opened={resourceModalOpen}
        title={editingResourceId === null ? "Add resource" : "Edit resource"}
      >
        <Stack>
          <Select
            data={limitOptions}
            label="Limit"
            onChange={(value) => setResourceForm((form) => ({ ...form, resource_limit: value ?? "" }))}
            value={resourceForm.resource_limit || null}
          />
          <TextInput
            label="Value"
            onChange={(event) => setResourceForm((form) => ({ ...form, value: event.target.value }))}
            value={resourceForm.value}
          />
          <NumberInput
            label="Count"
            onChange={(value) => setResourceForm((form) => ({ ...form, count: value }))}
            value={resourceForm.count}
          />
          <Switch
            checked={resourceForm.enabled}
            label="Enabled"
            onChange={(event) => setResourceForm((form) => ({ ...form, enabled: event.target.checked }))}
          />
          <Group justify="flex-end">
            <Button onClick={() => setResourceModalOpen(false)} variant="default">
              Cancel
            </Button>
            <Button
              disabled={!resourceFormValid}
              loading={resourceMutation.isPending}
              onClick={submitResource}
            >
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
