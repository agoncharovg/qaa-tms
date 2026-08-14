import { useState } from "react";
import {
  Alert,
  Button,
  CopyButton,
  Group,
  Loader,
  Modal,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import { IconAlertCircle, IconCopy, IconEdit, IconKey, IconPlus, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { backendClient } from "@/api/backendClient";
import type { QaaUser, QaaUserCreateRequest, QaaUserUpdateRequest } from "@/api/types";
import { QaaAdminSubTab, QaaSubjectKind, QueryKey } from "@/constants";
import { useAuthStore } from "@/store/authStore";

type UserFormState = {
  email: string;
  slackUserId: string;
  name: string;
  description: string;
};

type TokenModalState = {
  title: string;
  token: string;
};

type QaaAdminSubTabValue = (typeof QaaAdminSubTab)[keyof typeof QaaAdminSubTab];

const QaaAdminPanelCopy = {
  ADMIN_TITLE: "QAA generator",
  ADMIN_SUBTITLE: "Manage QAA generator users and service registrations with the backend-held superuser token.",
  COPIED_ACTION: "Copied",
  COPY_ACTION: "Copy token",
  COPY_ONCE_WARNING:
    "This plaintext token is shown once. Copy it now. It is never stored in the SPA or written to the operations audit.",
  CREATE_SERVICE_ACTION: "Create service",
  CREATE_SERVICE_ERROR: "Unable to create the QAA generator service.",
  CREATE_SERVICE_MODAL_TITLE: "Create QAA generator service",
  CREATE_SERVICE_SUBTITLE: "Register external services such as qaa-bot and issue a service token.",
  CREATE_USER_ACTION: "Create user",
  CREATE_USER_ERROR: "Unable to create the QAA generator user.",
  CREATE_USER_MODAL_TITLE: "Create QAA generator user",
  CREATE_USER_SUBTITLE: "Provide at least one identifier.",
  DELETE_ACTION: "Delete",
  DELETE_CONFIRMATION_HELP: "Type the identifier below to confirm permanent deletion.",
  DELETE_CONFIRMATION_LABEL: "Confirmation",
  DELETE_CONFIRMATION_TITLE: "Delete QAA generator user",
  DELETE_ERROR: "Unable to delete the QAA generator user.",
  DELETE_SUBMIT_ACTION: "Delete user",
  DETAIL_NOT_SET: "Not set",
  EDIT_ACTION: "Edit",
  EDIT_MODAL_TITLE: "Edit QAA generator user",
  EDIT_SUBMIT_ACTION: "Save changes",
  EDIT_SUBTITLE: "Clear a field to remove it. Keep at least one identifier.",
  LOAD_SERVICES_ERROR_TITLE: "Failed to load services",
  LOAD_USERS_ERROR_TITLE: "Failed to load users",
  LOADING_SERVICES: "Loading QAA generator services.",
  LOADING_USERS: "Loading QAA generator users.",
  NO_SERVICES: "No QAA generator services were returned.",
  NO_USERS: "No QAA generator users were returned.",
  REGENERATE_ACTION: "Regenerate token",
  REGENERATE_ERROR: "Unable to regenerate the QAA generator user token.",
  REGENERATE_SERVICE_ERROR: "Unable to regenerate the QAA generator service token.",
  RETRY_ACTION: "Retry",
  REVOKE_SERVICE_ACTION: "Revoke",
  REVOKE_SERVICE_CONFIRM_HELP: "This revokes the active service token shown below.",
  REVOKE_SERVICE_CONFIRM_TITLE: "Revoke QAA generator service token",
  REVOKE_SERVICE_ERROR: "Unable to revoke the service token.",
  REVOKE_SERVICE_SUBMIT_ACTION: "Revoke token",
  SERVICE_NAME_LABEL: "Service name",
  SERVICE_REGENERATED_TOKEN_MODAL_TITLE: "Copy the regenerated QAA generator service token",
  SERVICES_SUBTITLE: "Manage service subjects and revoke the active service token shown for each row.",
  SERVICES_TAB: "Services",
  TABLE_ACTIONS: "Actions",
  TABLE_CREATED: "Created",
  TABLE_DESCRIPTION: "Description",
  TABLE_EMAIL: "Email",
  TABLE_NAME: "Name",
  TABLE_SLACK: "Slack user id",
  TABLE_TOKEN_ID: "Token id",
  TOKEN_FIELD_LABEL: "Plaintext token",
  UPDATE_ERROR: "Unable to update the QAA generator user.",
  USER_CREATED_TOKEN_MODAL_TITLE: "Copy the new QAA generator user token",
  USER_REGENERATED_TOKEN_MODAL_TITLE: "Copy the regenerated QAA generator user token",
  USER_SERVICE_TOKEN_MODAL_TITLE: "Copy the new QAA generator service token",
  USERS_SUBTITLE: "Every user can be edited, deleted, or issued a fresh token from one table.",
  USERS_TAB: "Users",
} as const;

const QAA_USERS_DEFAULT_LIMIT = 50 as const;
const QAA_USERS_DEFAULT_OFFSET = 0 as const;
const QAA_COPY_TIMEOUT_MS = 2000 as const;

const USER_FORM_INITIAL_STATE: UserFormState = {
  description: "",
  email: "",
  name: "",
  slackUserId: "",
};

const QAA_ADMIN_SUB_TABS = [
  {
    label: QaaAdminPanelCopy.USERS_TAB,
    value: QaaAdminSubTab.USERS,
  },
  {
    label: QaaAdminPanelCopy.SERVICES_TAB,
    value: QaaAdminSubTab.SERVICES,
  },
] as const;

function readOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  return value.trim().length > 0 ? value : null;
}

function formatOptionalText(value: unknown): string {
  return readOptionalText(value) ?? QaaAdminPanelCopy.DETAIL_NOT_SET;
}

function resolveServiceTokenId(user: QaaUser | null): string | null {
  return readOptionalText(user?.token_id);
}

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return QaaAdminPanelCopy.DETAIL_NOT_SET;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function toUserFormState(user: QaaUser): UserFormState {
  return {
    description: readOptionalText(user.description) ?? "",
    email: readOptionalText(user.email) ?? "",
    name: readOptionalText(user.name) ?? "",
    slackUserId: readOptionalText(user.slack_user_id) ?? "",
  };
}

function hasUserIdentifier(form: UserFormState): boolean {
  return (
    form.email.trim().length > 0 ||
    form.slackUserId.trim().length > 0 ||
    form.name.trim().length > 0
  );
}

function buildQaaUserCreatePayload(form: UserFormState): QaaUserCreateRequest {
  return {
    description: form.description.trim() || undefined,
    email: form.email.trim() || undefined,
    name: form.name.trim() || undefined,
    slack_user_id: form.slackUserId.trim() || undefined,
  };
}

function buildQaaUserUpdatePayload(form: UserFormState): QaaUserUpdateRequest {
  return {
    description: form.description.trim() || null,
    email: form.email.trim() || null,
    name: form.name.trim() || null,
    slack_user_id: form.slackUserId.trim() || null,
  };
}

function resolveUserIdentifier(user: QaaUser): string {
  const candidates = [user.email, user.slack_user_id, user.name, user.id];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return user.id;
}

function QaaUserFormFields({
  form,
  onChange,
}: {
  form: UserFormState;
  onChange: (next: UserFormState) => void;
}) {
  return (
    <>
      <TextInput
        aria-label={QaaAdminPanelCopy.TABLE_EMAIL}
        label={QaaAdminPanelCopy.TABLE_EMAIL}
        value={form.email}
        onChange={(event) =>
          onChange({
            ...form,
            email: event.currentTarget.value,
          })
        }
      />
      <TextInput
        aria-label={QaaAdminPanelCopy.TABLE_SLACK}
        label={QaaAdminPanelCopy.TABLE_SLACK}
        value={form.slackUserId}
        onChange={(event) =>
          onChange({
            ...form,
            slackUserId: event.currentTarget.value,
          })
        }
      />
      <TextInput
        aria-label={QaaAdminPanelCopy.TABLE_NAME}
        label={QaaAdminPanelCopy.TABLE_NAME}
        value={form.name}
        onChange={(event) =>
          onChange({
            ...form,
            name: event.currentTarget.value,
          })
        }
      />
      <Textarea
        aria-label={QaaAdminPanelCopy.TABLE_DESCRIPTION}
        autosize
        label={QaaAdminPanelCopy.TABLE_DESCRIPTION}
        minRows={3}
        value={form.description}
        onChange={(event) =>
          onChange({
            ...form,
            description: event.currentTarget.value,
          })
        }
      />
    </>
  );
}

export function AdminPanel() {
  const queryClient = useQueryClient();
  const token = useAuthStore((state) => state.token);
  const currentUser = useAuthStore((state) => state.currentUser);

  const [activeSubTab, setActiveSubTab] = useState<QaaAdminSubTabValue>(QaaAdminSubTab.USERS);
  const [createUserOpened, setCreateUserOpened] = useState(false);
  const [createUserForm, setCreateUserForm] = useState<UserFormState>(USER_FORM_INITIAL_STATE);
  const [editingUser, setEditingUser] = useState<QaaUser | null>(null);
  const [editUserForm, setEditUserForm] = useState<UserFormState>(USER_FORM_INITIAL_STATE);
  const [deletingUser, setDeletingUser] = useState<QaaUser | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [createServiceOpened, setCreateServiceOpened] = useState(false);
  const [createServiceName, setCreateServiceName] = useState("");
  const [serviceToRevoke, setServiceToRevoke] = useState<QaaUser | null>(null);
  const [tokenModal, setTokenModal] = useState<TokenModalState | null>(null);

  const qaaAdminEnabled = Boolean(token) && Boolean(currentUser?.is_admin);

  const usersQuery = useQuery({
    enabled: qaaAdminEnabled && activeSubTab === QaaAdminSubTab.USERS,
    queryFn: ({ signal }) =>
      backendClient.listQaaUsers(
        token ?? "",
        {
          kind: QaaSubjectKind.USER,
          limit: QAA_USERS_DEFAULT_LIMIT,
          offset: QAA_USERS_DEFAULT_OFFSET,
        },
        signal
      ),
    queryKey: [QueryKey.QAA_USERS, token, QaaSubjectKind.USER],
  });

  const servicesQuery = useQuery({
    enabled: qaaAdminEnabled && activeSubTab === QaaAdminSubTab.SERVICES,
    queryFn: ({ signal }) =>
      backendClient.listQaaUsers(
        token ?? "",
        {
          kind: QaaSubjectKind.SERVICE,
          limit: QAA_USERS_DEFAULT_LIMIT,
          offset: QAA_USERS_DEFAULT_OFFSET,
        },
        signal
      ),
    queryKey: [QueryKey.QAA_USERS, token, QaaSubjectKind.SERVICE],
  });

  const createUserMutation = useMutation({
    mutationFn: async (payload: QaaUserCreateRequest) => {
      if (!token) {
        throw new Error("Authentication is required.");
      }

      const response = await backendClient.createQaaUser(token, payload);
      setTokenModal({
        title: QaaAdminPanelCopy.USER_CREATED_TOKEN_MODAL_TITLE,
        token: response.token,
      });
      return response.user;
    },
    onSuccess: async () => {
      setCreateUserOpened(false);
      setCreateUserForm(USER_FORM_INITIAL_STATE);
      await queryClient.invalidateQueries({ queryKey: [QueryKey.QAA_USERS] });
    },
  });


  const updateUserMutation = useMutation({
    mutationFn: async ({ payload, userId }: { payload: QaaUserUpdateRequest; userId: string }) => {
      if (!token) {
        throw new Error("Authentication is required.");
      }

      return backendClient.updateQaaUser(token, userId, payload);
    },
    onSuccess: async () => {
      setEditingUser(null);
      setEditUserForm(USER_FORM_INITIAL_STATE);
      await queryClient.invalidateQueries({ queryKey: [QueryKey.QAA_USERS] });
    },
  });

  const regenerateTokenMutation = useMutation({
    mutationFn: async (userId: string) => {
      if (!token) {
        throw new Error("Authentication is required.");
      }

      const response = await backendClient.regenerateQaaUserToken(token, userId);
      setTokenModal({
        title: QaaAdminPanelCopy.USER_REGENERATED_TOKEN_MODAL_TITLE,
        token: response.token,
      });
      return userId;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [QueryKey.QAA_USERS] });
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      if (!token) {
        throw new Error("Authentication is required.");
      }

      await backendClient.deleteQaaUser(token, userId);
    },
    onSuccess: async () => {
      setDeletingUser(null);
      setDeleteConfirmation("");
      await queryClient.invalidateQueries({ queryKey: [QueryKey.QAA_USERS] });
    },
  });

  const createServiceMutation = useMutation({
    mutationFn: async (name: string) => {
      if (!token) {
        throw new Error("Authentication is required.");
      }

      return backendClient.createQaaServiceToken(token, { name });
    },
    onSuccess: async (response) => {
      setCreateServiceOpened(false);
      setCreateServiceName("");
      setTokenModal({
        title: QaaAdminPanelCopy.USER_SERVICE_TOKEN_MODAL_TITLE,
        token: response.token,
      });
      await queryClient.invalidateQueries({ queryKey: [QueryKey.QAA_USERS] });
    },
  });

  const revokeServiceMutation = useMutation({
    mutationFn: async (tokenId: string) => {
      if (!token) {
        throw new Error("Authentication is required.");
      }

      return backendClient.revokeQaaServiceToken(token, tokenId);
    },
    onSuccess: async () => {
      setServiceToRevoke(null);
      await queryClient.invalidateQueries({ queryKey: [QueryKey.QAA_USERS] });
    },
  });

  const regenerateServiceTokenMutation = useMutation({
    mutationFn: async (tokenId: string) => {
      if (!token) {
        throw new Error("Authentication is required.");
      }

      const response = await backendClient.regenerateQaaServiceToken(token, tokenId);
      setTokenModal({
        title: QaaAdminPanelCopy.SERVICE_REGENERATED_TOKEN_MODAL_TITLE,
        token: response.token,
      });
      return tokenId;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [QueryKey.QAA_USERS] });
    },
  });

  if (!currentUser?.is_admin) {
    return null;
  }

  function openCreateUserModal(): void {
    createUserMutation.reset();
    setCreateUserForm(USER_FORM_INITIAL_STATE);
    setCreateUserOpened(true);
  }

  function closeCreateUserModal(): void {
    createUserMutation.reset();
    setCreateUserOpened(false);
    setCreateUserForm(USER_FORM_INITIAL_STATE);
  }

  function openEditUserModal(user: QaaUser): void {
    updateUserMutation.reset();
    setEditingUser(user);
    setEditUserForm(toUserFormState(user));
  }

  function closeEditUserModal(): void {
    updateUserMutation.reset();
    setEditingUser(null);
    setEditUserForm(USER_FORM_INITIAL_STATE);
  }

  function openDeleteUserModal(user: QaaUser): void {
    deleteUserMutation.reset();
    setDeletingUser(user);
    setDeleteConfirmation("");
  }

  function closeDeleteUserModal(): void {
    deleteUserMutation.reset();
    setDeletingUser(null);
    setDeleteConfirmation("");
  }

  function openCreateServiceModal(): void {
    createServiceMutation.reset();
    setCreateServiceName("");
    setCreateServiceOpened(true);
  }

  function closeCreateServiceModal(): void {
    createServiceMutation.reset();
    setCreateServiceName("");
    setCreateServiceOpened(false);
  }

  function openRevokeServiceModal(service: QaaUser): void {
    revokeServiceMutation.reset();
    setServiceToRevoke(service);
  }

  function closeRevokeServiceModal(): void {
    revokeServiceMutation.reset();
    setServiceToRevoke(null);
  }

  function closeTokenModal(): void {
    setTokenModal(null);
    createUserMutation.reset();
    regenerateTokenMutation.reset();
    createServiceMutation.reset();
    regenerateServiceTokenMutation.reset();
  }

  function submitCreateUser(): void {
    createUserMutation.mutate(buildQaaUserCreatePayload(createUserForm));
  }

  function submitEditUser(): void {
    if (!editingUser) {
      return;
    }

    updateUserMutation.mutate({
      payload: buildQaaUserUpdatePayload(editUserForm),
      userId: editingUser.id,
    });
  }

  function submitDeleteUser(): void {
    if (!deletingUser) {
      return;
    }

    deleteUserMutation.mutate(deletingUser.id);
  }

  function submitCreateService(): void {
    const serviceName = createServiceName.trim();
    if (!serviceName) {
      return;
    }

    createServiceMutation.mutate(serviceName);
  }

  function submitRevokeService(): void {
    const tokenId = resolveServiceTokenId(serviceToRevoke);
    if (!tokenId) {
      return;
    }

    revokeServiceMutation.mutate(tokenId);
  }

  const deleteIdentifier = deletingUser ? resolveUserIdentifier(deletingUser) : "";
  const deleteConfirmationMatches = deleteConfirmation.trim() === deleteIdentifier;
  const serviceTokenId = resolveServiceTokenId(serviceToRevoke);

  const usersPanel = (
    <Stack gap="md">
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={3}>{QaaAdminPanelCopy.USERS_TAB}</Title>
          <Text c="dimmed">{QaaAdminPanelCopy.USERS_SUBTITLE}</Text>
        </div>
        <Button leftSection={<IconPlus size={16} />} onClick={openCreateUserModal}>
          {QaaAdminPanelCopy.CREATE_USER_ACTION}
        </Button>
      </Group>

      {usersQuery.isLoading ? (
        <Stack align="center" gap="sm" py="xl">
          <Loader size="lg" />
          <Text c="dimmed">{QaaAdminPanelCopy.LOADING_USERS}</Text>
        </Stack>
      ) : null}

      {usersQuery.isError ? (
        <Alert color="red" icon={<IconAlertCircle size={18} />} title={QaaAdminPanelCopy.LOAD_USERS_ERROR_TITLE}>
          <Stack gap="sm">
            <Text>
              {usersQuery.error instanceof Error
                ? usersQuery.error.message
                : QaaAdminPanelCopy.LOAD_USERS_ERROR_TITLE}
            </Text>
            <Group>
              <Button onClick={() => void usersQuery.refetch()} variant="light">
                {QaaAdminPanelCopy.RETRY_ACTION}
              </Button>
            </Group>
          </Stack>
        </Alert>
      ) : null}

      {!usersQuery.isLoading && !usersQuery.isError && (usersQuery.data?.items.length ?? 0) === 0 ? (
        <Alert title={QaaAdminPanelCopy.USERS_TAB}>{QaaAdminPanelCopy.NO_USERS}</Alert>
      ) : null}

      {!usersQuery.isLoading && !usersQuery.isError && (usersQuery.data?.items.length ?? 0) > 0 ? (
        <Table.ScrollContainer minWidth={980}>
          <Table highlightOnHover striped withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{QaaAdminPanelCopy.TABLE_NAME}</Table.Th>
                <Table.Th>{QaaAdminPanelCopy.TABLE_EMAIL}</Table.Th>
                <Table.Th>{QaaAdminPanelCopy.TABLE_SLACK}</Table.Th>
                <Table.Th>{QaaAdminPanelCopy.TABLE_DESCRIPTION}</Table.Th>
                <Table.Th>{QaaAdminPanelCopy.TABLE_CREATED}</Table.Th>
                <Table.Th>{QaaAdminPanelCopy.TABLE_ACTIONS}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {usersQuery.data?.items.map((user) => (
                <Table.Tr key={user.id}>
                  <Table.Td>{formatOptionalText(user.name)}</Table.Td>
                  <Table.Td>{formatOptionalText(user.email)}</Table.Td>
                  <Table.Td>{formatOptionalText(user.slack_user_id)}</Table.Td>
                  <Table.Td>{formatOptionalText(user.description)}</Table.Td>
                  <Table.Td>{formatDate(readOptionalText(user.created_at))}</Table.Td>
                  <Table.Td>
                    <Group gap="xs">
                      <Button
                        aria-label={`${QaaAdminPanelCopy.EDIT_ACTION} ${user.id}`}
                        leftSection={<IconEdit size={14} />}
                        onClick={() => openEditUserModal(user)}
                        size="xs"
                        variant="light"
                      >
                        {QaaAdminPanelCopy.EDIT_ACTION}
                      </Button>
                      <Button
                        aria-label={`${QaaAdminPanelCopy.REGENERATE_ACTION} ${user.id}`}
                        color="yellow"
                        leftSection={<IconKey size={14} />}
                        loading={regenerateTokenMutation.isPending && regenerateTokenMutation.variables === user.id}
                        onClick={() => regenerateTokenMutation.mutate(user.id)}
                        size="xs"
                        variant="light"
                      >
                        {QaaAdminPanelCopy.REGENERATE_ACTION}
                      </Button>
                      <Button
                        aria-label={`${QaaAdminPanelCopy.DELETE_ACTION} ${user.id}`}
                        color="red"
                        leftSection={<IconTrash size={14} />}
                        onClick={() => openDeleteUserModal(user)}
                        size="xs"
                        variant="light"
                      >
                        {QaaAdminPanelCopy.DELETE_ACTION}
                      </Button>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      ) : null}
    </Stack>
  );


  const servicesPanel = (
    <Stack gap="md">
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={3}>{QaaAdminPanelCopy.SERVICES_TAB}</Title>
          <Text c="dimmed">{QaaAdminPanelCopy.SERVICES_SUBTITLE}</Text>
        </div>
        <Button leftSection={<IconPlus size={16} />} onClick={openCreateServiceModal}>
          {QaaAdminPanelCopy.CREATE_SERVICE_ACTION}
        </Button>
      </Group>

      {servicesQuery.isLoading ? (
        <Stack align="center" gap="sm" py="xl">
          <Loader size="lg" />
          <Text c="dimmed">{QaaAdminPanelCopy.LOADING_SERVICES}</Text>
        </Stack>
      ) : null}

      {servicesQuery.isError ? (
        <Alert
          color="red"
          icon={<IconAlertCircle size={18} />}
          title={QaaAdminPanelCopy.LOAD_SERVICES_ERROR_TITLE}
        >
          <Stack gap="sm">
            <Text>
              {servicesQuery.error instanceof Error
                ? servicesQuery.error.message
                : QaaAdminPanelCopy.LOAD_SERVICES_ERROR_TITLE}
            </Text>
            <Group>
              <Button onClick={() => void servicesQuery.refetch()} variant="light">
                {QaaAdminPanelCopy.RETRY_ACTION}
              </Button>
            </Group>
          </Stack>
        </Alert>
      ) : null}

      {!servicesQuery.isLoading && !servicesQuery.isError && (servicesQuery.data?.items.length ?? 0) === 0 ? (
        <Alert title={QaaAdminPanelCopy.SERVICES_TAB}>{QaaAdminPanelCopy.NO_SERVICES}</Alert>
      ) : null}

      {!servicesQuery.isLoading && !servicesQuery.isError && (servicesQuery.data?.items.length ?? 0) > 0 ? (
        <Table.ScrollContainer minWidth={820}>
          <Table highlightOnHover striped withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{QaaAdminPanelCopy.TABLE_NAME}</Table.Th>
                <Table.Th>{QaaAdminPanelCopy.TABLE_CREATED}</Table.Th>
                <Table.Th>{QaaAdminPanelCopy.TABLE_TOKEN_ID}</Table.Th>
                <Table.Th>{QaaAdminPanelCopy.TABLE_ACTIONS}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {servicesQuery.data?.items.map((service) => {
                const tokenId = resolveServiceTokenId(service);
                return (
                  <Table.Tr key={service.id}>
                    <Table.Td>{formatOptionalText(service.name)}</Table.Td>
                    <Table.Td>{formatDate(readOptionalText(service.created_at))}</Table.Td>
                    <Table.Td>{formatOptionalText(tokenId)}</Table.Td>
                    <Table.Td>
                      <Group gap="xs">
                        <Button
                          aria-label={`${QaaAdminPanelCopy.REGENERATE_ACTION} ${service.id}`}
                          color="yellow"
                          disabled={!tokenId}
                          leftSection={<IconKey size={14} />}
                          loading={
                            regenerateServiceTokenMutation.isPending &&
                            regenerateServiceTokenMutation.variables === tokenId
                          }
                          onClick={() => {
                            if (!tokenId) {
                              return;
                            }

                            regenerateServiceTokenMutation.mutate(tokenId);
                          }}
                          size="xs"
                          variant="light"
                        >
                          {QaaAdminPanelCopy.REGENERATE_ACTION}
                        </Button>
                        <Button
                          aria-label={`${QaaAdminPanelCopy.REVOKE_SERVICE_ACTION} ${service.id}`}
                          color="red"
                          disabled={!tokenId}
                          leftSection={<IconTrash size={14} />}
                          onClick={() => openRevokeServiceModal(service)}
                          size="xs"
                          variant="light"
                        >
                          {QaaAdminPanelCopy.REVOKE_SERVICE_ACTION}
                        </Button>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      ) : null}
    </Stack>
  );

  const subTabPanels: Record<QaaAdminSubTabValue, JSX.Element> = {
    [QaaAdminSubTab.USERS]: usersPanel,
    [QaaAdminSubTab.SERVICES]: servicesPanel,
  };

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>{QaaAdminPanelCopy.ADMIN_TITLE}</Title>
        <Text c="dimmed">{QaaAdminPanelCopy.ADMIN_SUBTITLE}</Text>
      </div>

      <Tabs
        onChange={(value) => {
          if (!value) {
            return;
          }

          setActiveSubTab(value as QaaAdminSubTabValue);
        }}
        value={activeSubTab}
      >
        <Tabs.List>
          {QAA_ADMIN_SUB_TABS.map((tab) => (
            <Tabs.Tab key={tab.value} value={tab.value}>
              {tab.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>

        {QAA_ADMIN_SUB_TABS.map((tab) => (
          <Tabs.Panel key={tab.value} pt="md" value={tab.value}>
            {subTabPanels[tab.value]}
          </Tabs.Panel>
        ))}
      </Tabs>

      <Modal
        opened={createUserOpened}
        onClose={closeCreateUserModal}
        title={QaaAdminPanelCopy.CREATE_USER_MODAL_TITLE}
        centered
        transitionProps={{ duration: 0 }}
      >
        <Stack>
          <Text c="dimmed" size="sm">
            {QaaAdminPanelCopy.CREATE_USER_SUBTITLE}
          </Text>

          {createUserMutation.isError ? (
            <Alert color="red" icon={<IconAlertCircle size={18} />} title={QaaAdminPanelCopy.CREATE_USER_ERROR}>
              {createUserMutation.error instanceof Error
                ? createUserMutation.error.message
                : QaaAdminPanelCopy.CREATE_USER_ERROR}
            </Alert>
          ) : null}

          <QaaUserFormFields form={createUserForm} onChange={setCreateUserForm} />

          <Group justify="flex-end">
            <Button
              disabled={!hasUserIdentifier(createUserForm)}
              loading={createUserMutation.isPending}
              onClick={submitCreateUser}
            >
              {QaaAdminPanelCopy.CREATE_USER_ACTION}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={editingUser !== null}
        onClose={closeEditUserModal}
        title={QaaAdminPanelCopy.EDIT_MODAL_TITLE}
        centered
        transitionProps={{ duration: 0 }}
      >
        <Stack>
          <Text c="dimmed" size="sm">
            {QaaAdminPanelCopy.EDIT_SUBTITLE}
          </Text>

          {updateUserMutation.isError ? (
            <Alert color="red" icon={<IconAlertCircle size={18} />} title={QaaAdminPanelCopy.UPDATE_ERROR}>
              {updateUserMutation.error instanceof Error
                ? updateUserMutation.error.message
                : QaaAdminPanelCopy.UPDATE_ERROR}
            </Alert>
          ) : null}

          <QaaUserFormFields form={editUserForm} onChange={setEditUserForm} />

          <Group justify="flex-end">
            <Button
              disabled={!hasUserIdentifier(editUserForm)}
              loading={updateUserMutation.isPending}
              onClick={submitEditUser}
            >
              {QaaAdminPanelCopy.EDIT_SUBMIT_ACTION}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={deletingUser !== null}
        onClose={closeDeleteUserModal}
        title={QaaAdminPanelCopy.DELETE_CONFIRMATION_TITLE}
        centered
        transitionProps={{ duration: 0 }}
      >
        <Stack>
          <Text c="dimmed" size="sm">
            {QaaAdminPanelCopy.DELETE_CONFIRMATION_HELP}
          </Text>
          <Text fw={600}>{deleteIdentifier}</Text>

          {deleteUserMutation.isError ? (
            <Alert color="red" icon={<IconAlertCircle size={18} />} title={QaaAdminPanelCopy.DELETE_ERROR}>
              {deleteUserMutation.error instanceof Error
                ? deleteUserMutation.error.message
                : QaaAdminPanelCopy.DELETE_ERROR}
            </Alert>
          ) : null}

          <TextInput
            label={QaaAdminPanelCopy.DELETE_CONFIRMATION_LABEL}
            onChange={(event) => setDeleteConfirmation(event.currentTarget.value)}
            value={deleteConfirmation}
          />

          <Group justify="flex-end">
            <Button
              color="red"
              disabled={!deleteConfirmationMatches}
              loading={deleteUserMutation.isPending}
              onClick={submitDeleteUser}
            >
              {QaaAdminPanelCopy.DELETE_SUBMIT_ACTION}
            </Button>
          </Group>
        </Stack>
      </Modal>


      <Modal
        opened={createServiceOpened}
        onClose={closeCreateServiceModal}
        title={QaaAdminPanelCopy.CREATE_SERVICE_MODAL_TITLE}
        centered
        transitionProps={{ duration: 0 }}
      >
        <Stack>
          <Text c="dimmed" size="sm">
            {QaaAdminPanelCopy.CREATE_SERVICE_SUBTITLE}
          </Text>

          {createServiceMutation.isError ? (
            <Alert color="red" icon={<IconAlertCircle size={18} />} title={QaaAdminPanelCopy.CREATE_SERVICE_ERROR}>
              {createServiceMutation.error instanceof Error
                ? createServiceMutation.error.message
                : QaaAdminPanelCopy.CREATE_SERVICE_ERROR}
            </Alert>
          ) : null}

          <TextInput
            aria-label={QaaAdminPanelCopy.SERVICE_NAME_LABEL}
            label={QaaAdminPanelCopy.SERVICE_NAME_LABEL}
            onChange={(event) => setCreateServiceName(event.currentTarget.value)}
            value={createServiceName}
          />

          <Group justify="flex-end">
            <Button
              disabled={createServiceName.trim().length === 0}
              loading={createServiceMutation.isPending}
              onClick={submitCreateService}
            >
              {QaaAdminPanelCopy.CREATE_SERVICE_ACTION}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={serviceToRevoke !== null}
        onClose={closeRevokeServiceModal}
        title={QaaAdminPanelCopy.REVOKE_SERVICE_CONFIRM_TITLE}
        centered
        transitionProps={{ duration: 0 }}
      >
        <Stack>
          <Text c="dimmed" size="sm">
            {QaaAdminPanelCopy.REVOKE_SERVICE_CONFIRM_HELP}
          </Text>

          <div>
            <Text fw={600}>{QaaAdminPanelCopy.TABLE_NAME}</Text>
            <Text>{formatOptionalText(serviceToRevoke?.name)}</Text>
          </div>

          <div>
            <Text fw={600}>{QaaAdminPanelCopy.TABLE_TOKEN_ID}</Text>
            <Text>{formatOptionalText(serviceTokenId)}</Text>
          </div>

          {revokeServiceMutation.isError ? (
            <Alert color="red" icon={<IconAlertCircle size={18} />} title={QaaAdminPanelCopy.REVOKE_SERVICE_ERROR}>
              {revokeServiceMutation.error instanceof Error
                ? revokeServiceMutation.error.message
                : QaaAdminPanelCopy.REVOKE_SERVICE_ERROR}
            </Alert>
          ) : null}

          <Group justify="flex-end">
            <Button
              color="red"
              disabled={!serviceTokenId}
              loading={revokeServiceMutation.isPending}
              onClick={submitRevokeService}
            >
              {QaaAdminPanelCopy.REVOKE_SERVICE_SUBMIT_ACTION}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={tokenModal !== null}
        onClose={closeTokenModal}
        title={tokenModal?.title}
        centered
        transitionProps={{ duration: 0 }}
      >
        <Stack>
          <Alert color="yellow" icon={<IconAlertCircle size={18} />} title={QaaAdminPanelCopy.COPY_ONCE_WARNING}>
            <Text>{QaaAdminPanelCopy.COPY_ONCE_WARNING}</Text>
          </Alert>

          <TextInput
            label={QaaAdminPanelCopy.TOKEN_FIELD_LABEL}
            readOnly
            value={tokenModal?.token ?? ""}
          />

          <Group justify="flex-end">
            <CopyButton timeout={QAA_COPY_TIMEOUT_MS} value={tokenModal?.token ?? ""}>
              {({ copied, copy }) => (
                <Button leftSection={<IconCopy size={16} />} onClick={copy}>
                  {copied ? QaaAdminPanelCopy.COPIED_ACTION : QaaAdminPanelCopy.COPY_ACTION}
                </Button>
              )}
            </CopyButton>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
