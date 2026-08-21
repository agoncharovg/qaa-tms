import { useState } from "react";
import {
  Alert,
  Button,
  Group,
  Loader,
  Modal,
  Paper,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { agentClient } from "@/api/agentClient";
import type { LeonidPipelineParam } from "@/api/types";
import { QueryKey } from "@/constants";
import { useAuthStore } from "@/store/authStore";

interface PipelineConfigsPanelProps {
  agentPort: number;
}

interface PipelineFormState {
  name: string;
  job_path: string;
  params: string;
}

const EMPTY_FORM: PipelineFormState = {
  name: "",
  job_path: "",
  params: "[]",
};

function formatError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

const PARSE_ERROR = Symbol("parse-error");

function parseParams(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return PARSE_ERROR;
  }
}

export function PipelineConfigsPanel({ agentPort }: PipelineConfigsPanelProps) {
  const token = useAuthStore((state) => state.token) ?? "";
  const queryClient = useQueryClient();

  const pipelineParamsQuery = useQuery({
    queryFn: ({ signal }) => agentClient.listLeonidPipelineParams(agentPort, token, signal),
    queryKey: [QueryKey.LEONID_PIPELINE_PARAMS, agentPort, token],
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<PipelineFormState>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<LeonidPipelineParam | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: [QueryKey.LEONID_PIPELINE_PARAMS] });

  const mutation = useMutation({
    mutationFn: ({ id, payload }: { id: number | null; payload: { name: string; job_path: string; params: unknown } }) =>
      id === null
        ? agentClient.createLeonidPipelineParam(agentPort, token, payload)
        : agentClient.updateLeonidPipelineParam(agentPort, token, id, payload),
    onSuccess: async () => {
      await invalidate();
      setModalOpen(false);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (pipelineParamId: number) =>
      agentClient.deleteLeonidPipelineParam(agentPort, token, pipelineParamId),
    onSuccess: async () => {
      await invalidate();
      setDeleteTarget(null);
    },
  });

  function openCreate(): void {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }

  function openEdit(item: LeonidPipelineParam): void {
    setEditingId(item.id);
    setForm({
      name: item.name,
      job_path: item.job_path,
      params: JSON.stringify(item.params, null, 2),
    });
    setModalOpen(true);
  }

  const parsedParams = parseParams(form.params);
  const paramsValid = parsedParams !== PARSE_ERROR;
  const formValid = form.name.trim().length > 0 && form.job_path.trim().length > 0 && paramsValid;

  function submit(): void {
    if (parsedParams === PARSE_ERROR) {
      return;
    }
    mutation.mutate({
      id: editingId,
      payload: {
        name: form.name.trim(),
        job_path: form.job_path.trim(),
        params: parsedParams,
      },
    });
  }

  const error = pipelineParamsQuery.error ?? mutation.error ?? deleteMutation.error;

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Pipeline configs</Title>
        <Text c="dimmed">Manage the named Jenkins pipeline parameter presets used by Leonid triggers.</Text>
      </div>

      {error ? (
        <Alert color="red" title="Leonid pipeline configs failed">
          {formatError(error, "Unable to load or update Leonid pipeline configs.")}
        </Alert>
      ) : null}

      {pipelineParamsQuery.isLoading ? (
        <Stack align="center" py="xl">
          <Loader />
          <Text c="dimmed">Loading Leonid pipeline configs.</Text>
        </Stack>
      ) : (
        <Paper p="md" withBorder>
          <Stack gap="md">
            <Group justify="space-between">
              <Text fw={600}>Pipeline parameter presets</Text>
              <Button aria-label="Add pipeline config" onClick={openCreate} size="xs">
                Add pipeline config
              </Button>
            </Group>
            {(pipelineParamsQuery.data ?? []).length > 0 ? (
              <Table.ScrollContainer minWidth={760}>
                <Table highlightOnHover striped withTableBorder>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Name</Table.Th>
                      <Table.Th>Job path</Table.Th>
                      <Table.Th>Params</Table.Th>
                      <Table.Th>Actions</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {(pipelineParamsQuery.data ?? []).map((item) => (
                      <Table.Tr key={item.id}>
                        <Table.Td>{item.name}</Table.Td>
                        <Table.Td>{item.job_path}</Table.Td>
                        <Table.Td>
                          <code>{JSON.stringify(item.params)}</code>
                        </Table.Td>
                        <Table.Td>
                          <Group gap="xs">
                            <Button
                              aria-label={`Edit pipeline config ${item.name}`}
                              onClick={() => openEdit(item)}
                              size="xs"
                              variant="light"
                            >
                              Edit
                            </Button>
                            <Button
                              aria-label={`Delete pipeline config ${item.name}`}
                              color="red"
                              onClick={() => setDeleteTarget(item)}
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
              </Table.ScrollContainer>
            ) : (
              <Text c="dimmed">No pipeline configs were returned.</Text>
            )}
          </Stack>
        </Paper>
      )}

      <Modal
        onClose={() => setModalOpen(false)}
        opened={modalOpen}
        title={editingId === null ? "Add pipeline config" : "Edit pipeline config"}
      >
        <Stack>
          <TextInput
            label="Name"
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            value={form.name}
          />
          <TextInput
            label="Job path"
            onChange={(event) => setForm((current) => ({ ...current, job_path: event.target.value }))}
            value={form.job_path}
          />
          <Textarea
            autosize
            error={paramsValid ? null : "Params must be valid JSON"}
            label="Params (JSON)"
            minRows={3}
            onChange={(event) => setForm((current) => ({ ...current, params: event.target.value }))}
            value={form.params}
          />
          <Group justify="flex-end">
            <Button onClick={() => setModalOpen(false)} variant="default">
              Cancel
            </Button>
            <Button disabled={!formValid} loading={mutation.isPending} onClick={submit}>
              Save
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal onClose={() => setDeleteTarget(null)} opened={deleteTarget !== null} title="Confirm delete">
        <Stack>
          <Text>Delete pipeline config {deleteTarget?.name}?</Text>
          <Group justify="flex-end">
            <Button onClick={() => setDeleteTarget(null)} variant="default">
              Cancel
            </Button>
            <Button
              color="red"
              loading={deleteMutation.isPending}
              onClick={() => {
                if (deleteTarget) {
                  deleteMutation.mutate(deleteTarget.id);
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
