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
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import { IconAlertCircle, IconCopy, IconEdit, IconKey, IconPlus, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { backendClient } from "@/api/backendClient";
import type { QaaUser, QaaUserCreateRequest, QaaUserUpdateRequest } from "@/api/types";
import { QueryKey } from "@/constants";
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

const QaaAdminPanelCopy = {
  ADMIN_TITLE: "QAA Generator Admin",
  ADMIN_SUBTITLE: "Manage qaa-generator users with the backend-held superuser token.",
  COPY_ACTION: "Copy token",
  COPIED_ACTION: "Copied",
  COPY_ONCE_WARNING:
    "This plaintext token is shown once. Copy it now. It is never stored in the SPA or written to the operations audit.",
  CREATE_USER_ACTION: "Create user",
  CREATE_USER_ERROR: "Unable to create the qaa-generator user.",
  CREATE_USER_MODAL_TITLE: "Create qaa-generator user",
  CREATE_USER_SUBTITLE: "Provide at least one identifier.",
  DELETE_ACTION: "Delete",
  DELETE_CONFIRMATION_HELP: "Type the identifier below to confirm permanent deletion.",
  DELETE_CONFIRMATION_LABEL: "Confirmation",
  DELETE_CONFIRMATION_TITLE: "Delete qaa-generator user",
  DELETE_ERROR: "Unable to delete the qaa-generator user.",
  DELETE_SUBMIT_ACTION: "Delete user",
  DETAIL_NOT_SET: "Not set",
  EDIT_ACTION: "Edit",
  EDIT_MODAL_TITLE: "Edit qaa-generator user",
  EDIT_SUBMIT_ACTION: "Save changes",
  EDIT_SUBTITLE: "Clear a field to remove it. Keep at least one identifier.",
  LOADING_USERS: "Loading qaa-generator users.",
  NO_USERS: "No qaa-generator users were returned.",
  REGENERATE_ACTION: "Regenerate token",
  REGENERATE_ERROR: "Unable to regenerate the qaa-generator user token.",
  TABLE_ACTIONS: "Actions",
  TABLE_CREATED: "Created",
  TABLE_DESCRIPTION: "Description",
  TABLE_EMAIL: "Email",
  TABLE_NAME: "Name",
  TABLE_SLACK: "Slack user id",
  TOKEN_FIELD_LABEL: "Plaintext token",
  UPDATE_ERROR: "Unable to update the qaa-generator user.",
  USER_CREATED_TOKEN_MODAL_TITLE: "Copy the new qaa-generator user token",
  USER_REGENERATED_TOKEN_MODAL_TITLE: "Copy the regenerated qaa-generator user token",
  USERS_SECTION: "Users",
  USERS_SUBTITLE: "Every user can be edited, deleted, or issued a fresh token from one table.",
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

function formatOptionalText(value: string | null | undefined): string {
  return value && value.trim().length > 0 ? value : QaaAdminPanelCopy.DETAIL_NOT_SET;
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
    description: typeof user.description === "string" ? user.description : "",
    email: typeof user.email === "string" ? user.email : "",
    name: typeof user.name === "string" ? user.name : "",
    slackUserId: typeof user.slack_user_id === "string" ? user.slack_user_id : "",
  };
}

function hasUserIdentifier(form: UserFormState): boolean {
  return form.email.trim().length > 0 || form.slackUserId.trim().length > 0;
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

  const [createUserOpened, setCreateUserOpened] = useState(false);
  const [createUserForm, setCreateUserForm] = useState<UserFormState>(USER_FORM_INITIAL_STATE);
  const [editingUser, setEditingUser] = useState<QaaUser | null>(null);
  const [editUserForm, setEditUserForm] = useState<UserFormState>(USER_FORM_INITIAL_STATE);
  const [deletingUser, setDeletingUser] = useState<QaaUser | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [tokenModal, setTokenModal] = useState<TokenModalState | null>(null);

  const usersQuery = useQuery({
    enabled: Boolean(token) && Boolean(currentUser?.is_admin),
    queryFn: ({ signal }) =>
      backendClient.listQaaUsers(
        token ?? "",
        {
          limit: QAA_USERS_DEFAULT_LIMIT,
          offset: QAA_USERS_DEFAULT_OFFSET,
        },
        signal
      ),
    queryKey: [QueryKey.QAA_USERS, token],
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

  function closeTokenModal(): void {
    setTokenModal(null);
    createUserMutation.reset();
    regenerateTokenMutation.reset();
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

  const deleteIdentifier = deletingUser ? resolveUserIdentifier(deletingUser) : "";
  const deleteConfirmationMatches = deleteConfirmation.trim() === deleteIdentifier;

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={2}>{QaaAdminPanelCopy.ADMIN_TITLE}</Title>
          <Text c="dimmed">{QaaAdminPanelCopy.ADMIN_SUBTITLE}</Text>
        </div>
        <Button leftSection={<IconPlus size={16} />} onClick={openCreateUserModal}>
          {QaaAdminPanelCopy.CREATE_USER_ACTION}
        </Button>
      </Group>

      <div>
        <Title order={3}>{QaaAdminPanelCopy.USERS_SECTION}</Title>
        <Text c="dimmed">{QaaAdminPanelCopy.USERS_SUBTITLE}</Text>
      </div>

      {usersQuery.isLoading ? (
        <Stack align="center" gap="sm" py="xl">
          <Loader size="lg" />
          <Text c="dimmed">{QaaAdminPanelCopy.LOADING_USERS}</Text>
        </Stack>
      ) : null}

      {usersQuery.isError ? (
        <Alert color="red" icon={<IconAlertCircle size={18} />} title={QaaAdminPanelCopy.USERS_SECTION}>
          <Stack gap="sm">
            <Text>
              {usersQuery.error instanceof Error ? usersQuery.error.message : QaaAdminPanelCopy.USERS_SECTION}
            </Text>
            <Group>
              <Button onClick={() => void usersQuery.refetch()} variant="light">
                Retry
              </Button>
            </Group>
          </Stack>
        </Alert>
      ) : null}

      {!usersQuery.isLoading && !usersQuery.isError && (usersQuery.data?.items.length ?? 0) === 0 ? (
        <Alert title={QaaAdminPanelCopy.USERS_SECTION}>{QaaAdminPanelCopy.NO_USERS}</Alert>
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
                  <Table.Td>{formatOptionalText(typeof user.name === "string" ? user.name : null)}</Table.Td>
                  <Table.Td>{formatOptionalText(typeof user.email === "string" ? user.email : null)}</Table.Td>
                  <Table.Td>
                    {formatOptionalText(
                      typeof user.slack_user_id === "string" ? user.slack_user_id : null
                    )}
                  </Table.Td>
                  <Table.Td>
                    {formatOptionalText(
                      typeof user.description === "string" ? user.description : null
                    )}
                  </Table.Td>
                  <Table.Td>{formatDate(typeof user.created_at === "string" ? user.created_at : null)}</Table.Td>
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
          <Text>
            Delete <strong>{deleteIdentifier}</strong>.
          </Text>
          <Text c="dimmed" size="sm">
            {QaaAdminPanelCopy.DELETE_CONFIRMATION_HELP}
          </Text>

          {deleteUserMutation.isError ? (
            <Alert color="red" icon={<IconAlertCircle size={18} />} title={QaaAdminPanelCopy.DELETE_ERROR}>
              {deleteUserMutation.error instanceof Error
                ? deleteUserMutation.error.message
                : QaaAdminPanelCopy.DELETE_ERROR}
            </Alert>
          ) : null}

          <TextInput
            aria-label={QaaAdminPanelCopy.DELETE_CONFIRMATION_LABEL}
            label={QaaAdminPanelCopy.DELETE_CONFIRMATION_LABEL}
            value={deleteConfirmation}
            onChange={(event) => setDeleteConfirmation(event.currentTarget.value)}
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
        opened={tokenModal !== null}
        onClose={closeTokenModal}
        title={tokenModal?.title ?? QaaAdminPanelCopy.TOKEN_FIELD_LABEL}
        centered
        transitionProps={{ duration: 0 }}
      >
        <Stack>
          <Alert color="yellow" title={QaaAdminPanelCopy.COPY_ONCE_WARNING}>
            {QaaAdminPanelCopy.COPY_ONCE_WARNING}
          </Alert>
          <TextInput
            aria-label={QaaAdminPanelCopy.TOKEN_FIELD_LABEL}
            label={QaaAdminPanelCopy.TOKEN_FIELD_LABEL}
            readOnly
            value={tokenModal?.token ?? ""}
          />
          <Group justify="flex-end">
            <CopyButton timeout={QAA_COPY_TIMEOUT_MS} value={tokenModal?.token ?? ""}>
              {({ copied, copy }) => (
                <Button leftSection={<IconCopy size={16} />} onClick={copy} variant="light">
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
