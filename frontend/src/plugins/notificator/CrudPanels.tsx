import { useState } from "react";
import {
  Alert,
  Button,
  Group,
  Loader,
  Modal,
  Paper,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { backendClient } from "@/api/backendClient";
import type {
  NotificatorProduct,
  NotificatorProductInput,
  NotificatorSlackChannel,
  NotificatorSlackChannelInput,
  NotificatorSubProduct,
  NotificatorSubProductInput,
} from "@/api/types";
import { QueryKey } from "@/constants";
import { formatNamedEntity, formatNullable } from "@/plugins/notificator/formatters";
import { useAuthStore } from "@/store/authStore";

function formatError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

interface ProductFormState {
  name: string;
  description: string;
}

const EMPTY_PRODUCT_FORM: ProductFormState = {
  name: "",
  description: "",
};

export function ProductsPanel() {
  const token = useAuthStore((state) => state.token) ?? "";
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<NotificatorProduct | null>(null);
  const [form, setForm] = useState<ProductFormState>(EMPTY_PRODUCT_FORM);
  const [formOpen, setFormOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<NotificatorProduct | null>(null);

  const productsQuery = useQuery({
    queryFn: ({ signal }) => backendClient.listNotificatorProducts(token, signal),
    queryKey: [QueryKey.NOTIFICATOR_PRODUCTS, token],
  });

  const mutation = useMutation({
    mutationFn: (payload: { id: number | null; body: NotificatorProductInput }) =>
      payload.id === null
        ? backendClient.createNotificatorProduct(token, payload.body)
        : backendClient.updateNotificatorProduct(token, payload.id, payload.body),
    onSuccess: async () => {
      setEditing(null);
      setForm(EMPTY_PRODUCT_FORM);
      setFormOpen(false);
      await queryClient.invalidateQueries({ queryKey: [QueryKey.NOTIFICATOR_PRODUCTS] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (productId: number) => backendClient.deleteNotificatorProduct(token, productId),
    onSuccess: async () => {
      setDeleteTarget(null);
      await queryClient.invalidateQueries({ queryKey: [QueryKey.NOTIFICATOR_PRODUCTS] });
    },
  });

  function openCreate(): void {
    mutation.reset();
    setEditing(null);
    setForm(EMPTY_PRODUCT_FORM);
    setFormOpen(true);
  }

  function openEdit(item: NotificatorProduct): void {
    mutation.reset();
    setEditing(item);
    setFormOpen(true);
    setForm({
      name: item.name,
      description: item.description ?? "",
    });
  }

  function submit(): void {
    mutation.mutate({
      id: editing?.id ?? null,
      body: {
        name: form.name.trim(),
        description: form.description.trim() ? form.description.trim() : null,
      },
    });
  }

  const error = productsQuery.error ?? mutation.error ?? deleteMutation.error;

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Products</Title>
        <Text c="dimmed">Writable product catalog with visible downstream counts.</Text>
      </div>

      {error ? (
        <Alert color="red" title="Notificator products failed">
          {formatError(error, "Unable to load or update Notificator products.")}
        </Alert>
      ) : null}

      {productsQuery.isLoading ? (
        <Stack align="center" py="xl">
          <Loader />
          <Text c="dimmed">Loading products.</Text>
        </Stack>
      ) : (
        <Paper p="md" withBorder>
          <Stack gap="md">
            <Group justify="space-between">
              <Text fw={600}>Products</Text>
              <Button onClick={openCreate} size="xs">Add product</Button>
            </Group>
            {(productsQuery.data ?? []).length === 0 ? (
              <Text c="dimmed">No products were returned.</Text>
            ) : (
              <Table.ScrollContainer minWidth={900}>
                <Table highlightOnHover striped withTableBorder>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Name</Table.Th>
                      <Table.Th>Description</Table.Th>
                      <Table.Th>Teams</Table.Th>
                      <Table.Th>Sub products</Table.Th>
                      <Table.Th>QAA members</Table.Th>
                      <Table.Th>Actions</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {(productsQuery.data ?? []).map((item) => (
                      <Table.Tr key={item.id}>
                        <Table.Td>{item.name}</Table.Td>
                        <Table.Td>{formatNullable(item.description)}</Table.Td>
                        <Table.Td>{item.teams_count}</Table.Td>
                        <Table.Td>{item.sub_products_count}</Table.Td>
                        <Table.Td>{item.qaa_members_count}</Table.Td>
                        <Table.Td>
                          <Group gap="xs">
                            <Button onClick={() => openEdit(item)} size="xs" variant="light">Edit</Button>
                            <Button color="red" onClick={() => setDeleteTarget(item)} size="xs" variant="light">Delete</Button>
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            )}
          </Stack>
        </Paper>
      )}

      <Modal
        opened={formOpen}
        onClose={() => {
          setEditing(null);
          setForm(EMPTY_PRODUCT_FORM);
          setFormOpen(false);
        }}
        title={editing ? `Edit ${editing.name}` : "Create product"}
      >
        <Stack>
          <TextInput
            label="Name"
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.currentTarget.value }))}
          />
          <Textarea
            label="Description"
            value={form.description}
            onChange={(event) =>
              setForm((current) => ({ ...current, description: event.currentTarget.value }))
            }
          />
          <Button disabled={form.name.trim().length === 0 || mutation.isPending} onClick={submit}>
            {editing ? "Save" : "Create"}
          </Button>
        </Stack>
      </Modal>

      <Modal
        opened={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete product"
      >
        <Stack>
          <Text>{`Delete ${deleteTarget?.name ?? "this product"}?`}</Text>
          <Button
            color="red"
            disabled={!deleteTarget || deleteMutation.isPending}
            onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
          >
            Delete
          </Button>
        </Stack>
      </Modal>
    </Stack>
  );
}

interface SubProductFormState {
  name: string;
  product: string;
  team: string;
}

const EMPTY_SUB_PRODUCT_FORM: SubProductFormState = {
  name: "",
  product: "",
  team: "",
};

export function SubProductsPanel() {
  const token = useAuthStore((state) => state.token) ?? "";
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<NotificatorSubProduct | null>(null);
  const [form, setForm] = useState<SubProductFormState>(EMPTY_SUB_PRODUCT_FORM);
  const [formOpen, setFormOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<NotificatorSubProduct | null>(null);

  const subProductsQuery = useQuery({
    queryFn: ({ signal }) => backendClient.listNotificatorSubProducts(token, signal),
    queryKey: [QueryKey.NOTIFICATOR_SUB_PRODUCTS, token],
  });
  const productsQuery = useQuery({
    queryFn: ({ signal }) => backendClient.listNotificatorProducts(token, signal),
    queryKey: [QueryKey.NOTIFICATOR_PRODUCTS, token],
  });
  const teamsQuery = useQuery({
    queryFn: ({ signal }) => backendClient.listNotificatorTeams(token, signal),
    queryKey: [QueryKey.NOTIFICATOR_TEAMS, token],
  });

  const mutation = useMutation({
    mutationFn: (payload: { id: number | null; body: NotificatorSubProductInput }) =>
      payload.id === null
        ? backendClient.createNotificatorSubProduct(token, payload.body)
        : backendClient.updateNotificatorSubProduct(token, payload.id, payload.body),
    onSuccess: async () => {
      setEditing(null);
      setForm(EMPTY_SUB_PRODUCT_FORM);
      setFormOpen(false);
      await queryClient.invalidateQueries({ queryKey: [QueryKey.NOTIFICATOR_SUB_PRODUCTS] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (subProductId: number) =>
      backendClient.deleteNotificatorSubProduct(token, subProductId),
    onSuccess: async () => {
      setDeleteTarget(null);
      await queryClient.invalidateQueries({ queryKey: [QueryKey.NOTIFICATOR_SUB_PRODUCTS] });
    },
  });

  function openCreate(): void {
    mutation.reset();
    setEditing(null);
    setForm(EMPTY_SUB_PRODUCT_FORM);
    setFormOpen(true);
  }

  function openEdit(item: NotificatorSubProduct): void {
    mutation.reset();
    setEditing(item);
    setFormOpen(true);
    setForm({
      name: item.name,
      product: item.product ? String(item.product.id) : "",
      team: item.team ? String(item.team.id) : "",
    });
  }

  function submit(): void {
    mutation.mutate({
      id: editing?.id ?? null,
      body: {
        name: form.name.trim(),
        product: form.product ? Number(form.product) : null,
        team: form.team ? Number(form.team) : null,
      },
    });
  }

  const productOptions = [
    { value: "", label: "-" },
    ...((productsQuery.data ?? []).map((item) => ({ value: String(item.id), label: item.name }))),
  ];
  const teamOptions = [
    { value: "", label: "-" },
    ...((teamsQuery.data ?? []).map((item) => ({ value: String(item.id), label: item.name }))),
  ];
  const error = subProductsQuery.error ?? productsQuery.error ?? teamsQuery.error ?? mutation.error ?? deleteMutation.error;
  const isLoading = subProductsQuery.isLoading || productsQuery.isLoading || teamsQuery.isLoading;

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Sub Products</Title>
        <Text c="dimmed">Writable sub-product mapping to products and teams.</Text>
      </div>

      {error ? (
        <Alert color="red" title="Notificator sub products failed">
          {formatError(error, "Unable to load or update Notificator sub products.")}
        </Alert>
      ) : null}

      {isLoading ? (
        <Stack align="center" py="xl">
          <Loader />
          <Text c="dimmed">Loading sub products.</Text>
        </Stack>
      ) : (
        <Paper p="md" withBorder>
          <Stack gap="md">
            <Group justify="space-between">
              <Text fw={600}>Sub products</Text>
              <Button onClick={openCreate} size="xs">Add sub product</Button>
            </Group>
            {(subProductsQuery.data ?? []).length === 0 ? (
              <Text c="dimmed">No sub products were returned.</Text>
            ) : (
              <Table.ScrollContainer minWidth={860}>
                <Table highlightOnHover striped withTableBorder>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Name</Table.Th>
                      <Table.Th>Product</Table.Th>
                      <Table.Th>Team</Table.Th>
                      <Table.Th>Actions</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {(subProductsQuery.data ?? []).map((item) => (
                      <Table.Tr key={item.id}>
                        <Table.Td>{item.name}</Table.Td>
                        <Table.Td>{formatNamedEntity(item.product)}</Table.Td>
                        <Table.Td>{formatNamedEntity(item.team)}</Table.Td>
                        <Table.Td>
                          <Group gap="xs">
                            <Button onClick={() => openEdit(item)} size="xs" variant="light">Edit</Button>
                            <Button color="red" onClick={() => setDeleteTarget(item)} size="xs" variant="light">Delete</Button>
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            )}
          </Stack>
        </Paper>
      )}

      <Modal
        opened={formOpen}
        onClose={() => {
          setEditing(null);
          setForm(EMPTY_SUB_PRODUCT_FORM);
          setFormOpen(false);
        }}
        title={editing ? `Edit ${editing.name}` : "Create sub product"}
      >
        <Stack>
          <TextInput
            label="Name"
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.currentTarget.value }))}
          />
          <Select label="Product" data={productOptions} value={form.product} onChange={(value) => setForm((current) => ({ ...current, product: value ?? "" }))} />
          <Select label="Team" data={teamOptions} value={form.team} onChange={(value) => setForm((current) => ({ ...current, team: value ?? "" }))} />
          <Button disabled={form.name.trim().length === 0 || mutation.isPending} onClick={submit}>
            {editing ? "Save" : "Create"}
          </Button>
        </Stack>
      </Modal>

      <Modal opened={deleteTarget !== null} onClose={() => setDeleteTarget(null)} title="Delete sub product">
        <Stack>
          <Text>{`Delete ${deleteTarget?.name ?? "this sub product"}?`}</Text>
          <Button
            color="red"
            disabled={!deleteTarget || deleteMutation.isPending}
            onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
          >
            Delete
          </Button>
        </Stack>
      </Modal>
    </Stack>
  );
}

interface SlackChannelFormState {
  channelId: string;
  description: string;
}

const EMPTY_SLACK_CHANNEL_FORM: SlackChannelFormState = {
  channelId: "",
  description: "",
};

export function SlackChannelsPanel() {
  const token = useAuthStore((state) => state.token) ?? "";
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<NotificatorSlackChannel | null>(null);
  const [form, setForm] = useState<SlackChannelFormState>(EMPTY_SLACK_CHANNEL_FORM);
  const [formOpen, setFormOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<NotificatorSlackChannel | null>(null);

  const channelsQuery = useQuery({
    queryFn: ({ signal }) => backendClient.listNotificatorSlackChannels(token, signal),
    queryKey: [QueryKey.NOTIFICATOR_SLACK_CHANNELS, token],
  });

  const mutation = useMutation({
    mutationFn: (payload: { id: number | null; body: NotificatorSlackChannelInput }) =>
      payload.id === null
        ? backendClient.createNotificatorSlackChannel(token, payload.body)
        : backendClient.updateNotificatorSlackChannel(token, payload.id, payload.body),
    onSuccess: async () => {
      setEditing(null);
      setForm(EMPTY_SLACK_CHANNEL_FORM);
      setFormOpen(false);
      await queryClient.invalidateQueries({ queryKey: [QueryKey.NOTIFICATOR_SLACK_CHANNELS] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (channelId: number) =>
      backendClient.deleteNotificatorSlackChannel(token, channelId),
    onSuccess: async () => {
      setDeleteTarget(null);
      await queryClient.invalidateQueries({ queryKey: [QueryKey.NOTIFICATOR_SLACK_CHANNELS] });
    },
  });

  function openCreate(): void {
    mutation.reset();
    setEditing(null);
    setForm(EMPTY_SLACK_CHANNEL_FORM);
    setFormOpen(true);
  }

  function openEdit(item: NotificatorSlackChannel): void {
    mutation.reset();
    setEditing(item);
    setFormOpen(true);
    setForm({
      channelId: item.channel_id,
      description: item.description ?? "",
    });
  }

  function submit(): void {
    mutation.mutate({
      id: editing?.id ?? null,
      body: {
        channel_id: form.channelId.trim(),
        description: form.description.trim() ? form.description.trim() : null,
      },
    });
  }

  const error = channelsQuery.error ?? mutation.error ?? deleteMutation.error;

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Slack Channels</Title>
        <Text c="dimmed">Writable channel directory referenced by notification configs.</Text>
      </div>

      {error ? (
        <Alert color="red" title="Notificator Slack channels failed">
          {formatError(error, "Unable to load or update Notificator Slack channels.")}
        </Alert>
      ) : null}

      {channelsQuery.isLoading ? (
        <Stack align="center" py="xl">
          <Loader />
          <Text c="dimmed">Loading Slack channels.</Text>
        </Stack>
      ) : (
        <Paper p="md" withBorder>
          <Stack gap="md">
            <Group justify="space-between">
              <Text fw={600}>Slack channels</Text>
              <Button onClick={openCreate} size="xs">Add Slack channel</Button>
            </Group>
            {(channelsQuery.data ?? []).length === 0 ? (
              <Text c="dimmed">No Slack channels were returned.</Text>
            ) : (
              <Table.ScrollContainer minWidth={760}>
                <Table highlightOnHover striped withTableBorder>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Channel ID</Table.Th>
                      <Table.Th>Description</Table.Th>
                      <Table.Th>Actions</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {(channelsQuery.data ?? []).map((item) => (
                      <Table.Tr key={item.id}>
                        <Table.Td>{item.channel_id}</Table.Td>
                        <Table.Td>{formatNullable(item.description)}</Table.Td>
                        <Table.Td>
                          <Group gap="xs">
                            <Button onClick={() => openEdit(item)} size="xs" variant="light">Edit</Button>
                            <Button color="red" onClick={() => setDeleteTarget(item)} size="xs" variant="light">Delete</Button>
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            )}
          </Stack>
        </Paper>
      )}

      <Modal
        opened={formOpen}
        onClose={() => {
          setEditing(null);
          setForm(EMPTY_SLACK_CHANNEL_FORM);
          setFormOpen(false);
        }}
        title={editing ? `Edit ${editing.channel_id}` : "Create Slack channel"}
      >
        <Stack>
          <TextInput
            label="Channel ID"
            value={form.channelId}
            onChange={(event) =>
              setForm((current) => ({ ...current, channelId: event.currentTarget.value }))
            }
          />
          <TextInput
            label="Description"
            value={form.description}
            onChange={(event) =>
              setForm((current) => ({ ...current, description: event.currentTarget.value }))
            }
          />
          <Button disabled={form.channelId.trim().length === 0 || mutation.isPending} onClick={submit}>
            {editing ? "Save" : "Create"}
          </Button>
        </Stack>
      </Modal>

      <Modal opened={deleteTarget !== null} onClose={() => setDeleteTarget(null)} title="Delete Slack channel">
        <Stack>
          <Text>{`Delete ${deleteTarget?.channel_id ?? "this Slack channel"}?`}</Text>
          <Button
            color="red"
            disabled={!deleteTarget || deleteMutation.isPending}
            onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
          >
            Delete
          </Button>
        </Stack>
      </Modal>
    </Stack>
  );
}
