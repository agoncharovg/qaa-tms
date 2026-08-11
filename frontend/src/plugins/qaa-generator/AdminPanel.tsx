import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Code,
  CopyButton,
  Divider,
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
import { IconAlertCircle, IconCopy, IconEye, IconKey, IconPlus, IconShieldX } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { backendClient } from "@/api/backendClient";
import type {
  QaaServiceTokenCreateRequest,
  QaaUser,
  QaaUserCreateRequest,
} from "@/api/types";
import { QueryKey } from "@/constants";
import { useAuthStore } from "@/store/authStore";

type LookupFormState = {
  email: string;
  slackUserId: string;
};

type CreateUserFormState = {
  email: string;
  slackUserId: string;
  name: string;
  description: string;
};

type ServiceTokenFormState = {
  name: string;
};

type RevokeTokenFormState = {
  tokenId: string;
};

type TokenModalState = {
  title: string;
  token: string;
};

const QaaAdminPanelCopy = {
  ADMIN_TITLE: "QAA Generator Admin",
  ADMIN_SUBTITLE: "Manage qaa-generator users and service tokens with the backend-held superuser token.",
  COPY_ACTION: "Copy token",
  COPIED_ACTION: "Copied",
  COPY_ONCE_WARNING:
    "This plaintext token is shown once. Copy it now. It is never stored in the SPA or written to the operations audit.",
  CREATE_SERVICE_TOKEN_ACTION: "Create service token",
  CREATE_SERVICE_TOKEN_ERROR: "Unable to create the service token.",
  CREATE_SERVICE_TOKEN_NAME_LABEL: "Service token name",
  CREATE_SERVICE_TOKEN_SECTION: "Service tokens",
  CREATE_SERVICE_TOKEN_SUBTITLE:
    "Create one token at a time, then revoke by token id when it is no longer needed.",
  CREATE_USER_ACTION: "Create user",
  CREATE_USER_ERROR: "Unable to create the qaa-generator user.",
  CREATE_USER_MODAL_TITLE: "Create qaa-generator user",
  CREATE_USER_SUBTITLE: "Provide at least one identifier.",
  DETAIL_CREATED_LABEL: "Created",
  DETAIL_DESCRIPTION_LABEL: "Description",
  DETAIL_EMAIL_LABEL: "Email",
  DETAIL_MODAL_TITLE: "User details",
  DETAIL_NAME_LABEL: "Name",
  DETAIL_NOT_SET: "Not set",
  DETAIL_SLACK_LABEL: "Slack user id",
  DETAIL_UPDATED_LABEL: "Updated",
  LOAD_DETAILS_ACTION: "View details",
  LOAD_DETAILS_ERROR: "Unable to load the qaa-generator user details.",
  LOAD_USERS_ACTION: "Search users",
  LOAD_USERS_ERROR: "Unable to load qaa-generator users.",
  LOADING_DETAILS: "Loading user details.",
  LOADING_USERS: "Loading qaa-generator users.",
  NO_USERS: "No qaa-generator users matched the current lookup.",
  REGENERATE_ACTION: "Regenerate token",
  REGENERATE_ERROR: "Unable to regenerate the qaa-generator user token.",
  RESET_LOOKUP_ACTION: "Reset",
  REVOKE_ACTION: "Revoke token",
  REVOKE_ERROR: "Unable to revoke the service token.",
  REVOKE_SUCCESS: "Service token revoked.",
  REVOKE_TOKEN_ID_LABEL: "Service token id",
  SERVICE_TOKEN_MODAL_TITLE: "Copy the new qaa-generator service token",
  TOKEN_FIELD_LABEL: "Plaintext token",
  USER_CREATED_TOKEN_MODAL_TITLE: "Copy the new qaa-generator user token",
  USER_REGENERATED_TOKEN_MODAL_TITLE: "Copy the regenerated qaa-generator user token",
  USERS_CREATED_AT_HEADER: "Created",
  USERS_DESCRIPTION_LABEL: "Description",
  USERS_EMAIL_HEADER: "Email",
  USERS_EMAIL_LABEL: "Email",
  USERS_LOOKUP_LABEL: "Lookup",
  USERS_NAME_HEADER: "Name",
  USERS_NAME_LABEL: "Name",
  USERS_SECTION: "Users",
  USERS_SLACK_HEADER: "Slack user id",
  USERS_SLACK_LABEL: "Slack user id",
  USERS_TABLE_ACTIONS: "Actions",
} as const;

const QaaAdminPanelQueryKey = {
  DETAIL: "detail",
} as const;

const QAA_USERS_DEFAULT_LIMIT = 50 as const;
const QAA_USERS_DEFAULT_OFFSET = 0 as const;
const QAA_COPY_TIMEOUT_MS = 2000 as const;

const LOOKUP_FORM_INITIAL_STATE: LookupFormState = {
  email: "",
  slackUserId: "",
};

const CREATE_USER_FORM_INITIAL_STATE: CreateUserFormState = {
  description: "",
  email: "",
  name: "",
  slackUserId: "",
};

const SERVICE_TOKEN_FORM_INITIAL_STATE: ServiceTokenFormState = {
  name: "",
};

const REVOKE_TOKEN_FORM_INITIAL_STATE: RevokeTokenFormState = {
  tokenId: "",
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

function buildQaaUserCreatePayload(form: CreateUserFormState): QaaUserCreateRequest {
  return {
    description: form.description || undefined,
    email: form.email || undefined,
    name: form.name || undefined,
    slack_user_id: form.slackUserId || undefined,
  };
}

function buildQaaServiceTokenPayload(form: ServiceTokenFormState): QaaServiceTokenCreateRequest {
  return {
    name: form.name,
  };
}

function UserDetailBody({ user }: { user: QaaUser }) {
  return (
    <Stack gap="xs">
      <Group justify="space-between">
        <Text fw={600}>{QaaAdminPanelCopy.DETAIL_EMAIL_LABEL}</Text>
        <Text>{formatOptionalText(typeof user.email === "string" ? user.email : null)}</Text>
      </Group>
      <Group justify="space-between">
        <Text fw={600}>{QaaAdminPanelCopy.DETAIL_SLACK_LABEL}</Text>
        <Text>
          {formatOptionalText(typeof user.slack_user_id === "string" ? user.slack_user_id : null)}
        </Text>
      </Group>
      <Group justify="space-between">
        <Text fw={600}>{QaaAdminPanelCopy.DETAIL_NAME_LABEL}</Text>
        <Text>{formatOptionalText(typeof user.name === "string" ? user.name : null)}</Text>
      </Group>
      <Group justify="space-between" align="flex-start">
        <Text fw={600}>{QaaAdminPanelCopy.DETAIL_DESCRIPTION_LABEL}</Text>
        <Text maw={420} ta="right">
          {formatOptionalText(typeof user.description === "string" ? user.description : null)}
        </Text>
      </Group>
      <Group justify="space-between">
        <Text fw={600}>{QaaAdminPanelCopy.DETAIL_CREATED_LABEL}</Text>
        <Text>{formatDate(typeof user.created_at === "string" ? user.created_at : null)}</Text>
      </Group>
      <Group justify="space-between">
        <Text fw={600}>{QaaAdminPanelCopy.DETAIL_UPDATED_LABEL}</Text>
        <Text>{formatDate(typeof user.updated_at === "string" ? user.updated_at : null)}</Text>
      </Group>
      <Divider />
      <Code block>{JSON.stringify(user, null, 2)}</Code>
    </Stack>
  );
}

export function AdminPanel() {
  const queryClient = useQueryClient();
  const token = useAuthStore((state) => state.token);
  const currentUser = useAuthStore((state) => state.currentUser);

  const [lookupForm, setLookupForm] = useState<LookupFormState>(LOOKUP_FORM_INITIAL_STATE);
  const [appliedLookup, setAppliedLookup] = useState<LookupFormState>(LOOKUP_FORM_INITIAL_STATE);
  const [createUserOpened, setCreateUserOpened] = useState(false);
  const [createUserForm, setCreateUserForm] = useState<CreateUserFormState>(
    CREATE_USER_FORM_INITIAL_STATE
  );
  const [serviceTokenForm, setServiceTokenForm] = useState<ServiceTokenFormState>(
    SERVICE_TOKEN_FORM_INITIAL_STATE
  );
  const [revokeTokenForm, setRevokeTokenForm] = useState<RevokeTokenFormState>(
    REVOKE_TOKEN_FORM_INITIAL_STATE
  );
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [detailOpened, setDetailOpened] = useState(false);
  const [tokenModal, setTokenModal] = useState<TokenModalState | null>(null);
  const [revokeSuccessMessage, setRevokeSuccessMessage] = useState<string | null>(null);

  const usersQuery = useQuery({
    enabled: Boolean(token) && Boolean(currentUser?.is_admin),
    queryFn: ({ signal }) =>
      backendClient.listQaaUsers(
        token ?? "",
        {
          email: appliedLookup.email || undefined,
          limit: QAA_USERS_DEFAULT_LIMIT,
          offset: QAA_USERS_DEFAULT_OFFSET,
          slackUserId: appliedLookup.slackUserId || undefined,
        },
        signal
      ),
    queryKey: [QueryKey.QAA_USERS, token, appliedLookup.email, appliedLookup.slackUserId],
  });

  const userDetailQuery = useQuery({
    enabled: Boolean(token) && Boolean(selectedUserId) && detailOpened && Boolean(currentUser?.is_admin),
    queryFn: ({ signal }) => backendClient.getQaaUser(token ?? "", selectedUserId ?? "", signal),
    queryKey: [QueryKey.QAA_USERS, QaaAdminPanelQueryKey.DETAIL, selectedUserId, token],
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
    onSuccess: async (createdUser) => {
      setCreateUserOpened(false);
      setCreateUserForm(CREATE_USER_FORM_INITIAL_STATE);
      setSelectedUserId(createdUser.id);
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
    onSuccess: async (userId) => {
      if (selectedUserId === userId) {
        await queryClient.invalidateQueries({
          queryKey: [QueryKey.QAA_USERS, QaaAdminPanelQueryKey.DETAIL, userId],
        });
      }
      await queryClient.invalidateQueries({ queryKey: [QueryKey.QAA_USERS] });
    },
  });

  const createServiceTokenMutation = useMutation({
    mutationFn: async (payload: QaaServiceTokenCreateRequest) => {
      if (!token) {
        throw new Error("Authentication is required.");
      }

      const response = await backendClient.createQaaServiceToken(token, payload);
      setTokenModal({
        title: QaaAdminPanelCopy.SERVICE_TOKEN_MODAL_TITLE,
        token: response.token,
      });
      return response.user;
    },
    onSuccess: async () => {
      setServiceTokenForm(SERVICE_TOKEN_FORM_INITIAL_STATE);
      await queryClient.invalidateQueries({ queryKey: [QueryKey.QAA_USERS] });
    },
  });

  const revokeServiceTokenMutation = useMutation({
    mutationFn: async (tokenId: string) => {
      if (!token) {
        throw new Error("Authentication is required.");
      }

      return backendClient.revokeQaaServiceToken(token, tokenId);
    },
    onSuccess: () => {
      setRevokeTokenForm(REVOKE_TOKEN_FORM_INITIAL_STATE);
      setRevokeSuccessMessage(QaaAdminPanelCopy.REVOKE_SUCCESS);
    },
  });

  if (!currentUser?.is_admin) {
    return null;
  }

  function openCreateUserModal(): void {
    createUserMutation.reset();
    setCreateUserForm(CREATE_USER_FORM_INITIAL_STATE);
    setCreateUserOpened(true);
  }

  function closeCreateUserModal(): void {
    createUserMutation.reset();
    setCreateUserOpened(false);
    setCreateUserForm(CREATE_USER_FORM_INITIAL_STATE);
  }

  function openUserDetails(userId: string): void {
    setSelectedUserId(userId);
    setDetailOpened(true);
  }

  function closeUserDetails(): void {
    setSelectedUserId(null);
    setDetailOpened(false);
  }

  function closeTokenModal(): void {
    setTokenModal(null);
    createUserMutation.reset();
    regenerateTokenMutation.reset();
    createServiceTokenMutation.reset();
  }

  function applyLookup(): void {
    setAppliedLookup(lookupForm);
  }

  function resetLookup(): void {
    setLookupForm(LOOKUP_FORM_INITIAL_STATE);
    setAppliedLookup(LOOKUP_FORM_INITIAL_STATE);
  }

  function submitCreateUser(): void {
    setRevokeSuccessMessage(null);
    createUserMutation.mutate(buildQaaUserCreatePayload(createUserForm));
  }

  function submitCreateServiceToken(): void {
    setRevokeSuccessMessage(null);
    createServiceTokenMutation.mutate(buildQaaServiceTokenPayload(serviceTokenForm));
  }

  function submitRevokeServiceToken(): void {
    setRevokeSuccessMessage(null);
    revokeServiceTokenMutation.mutate(revokeTokenForm.tokenId);
  }

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

      <Stack gap="md">
        <div>
          <Title order={3}>{QaaAdminPanelCopy.USERS_SECTION}</Title>
          <Text c="dimmed">{QaaAdminPanelCopy.USERS_LOOKUP_LABEL}</Text>
        </div>
        <Group align="flex-end" grow>
          <TextInput
            aria-label={QaaAdminPanelCopy.USERS_EMAIL_LABEL}
            label={QaaAdminPanelCopy.USERS_EMAIL_LABEL}
            value={lookupForm.email}
            onChange={(event) =>
              setLookupForm((current) => ({ ...current, email: event.currentTarget.value }))
            }
          />
          <TextInput
            aria-label={QaaAdminPanelCopy.USERS_SLACK_LABEL}
            label={QaaAdminPanelCopy.USERS_SLACK_LABEL}
            value={lookupForm.slackUserId}
            onChange={(event) =>
              setLookupForm((current) => ({ ...current, slackUserId: event.currentTarget.value }))
            }
          />
        </Group>
        <Group>
          <Button onClick={applyLookup}>{QaaAdminPanelCopy.LOAD_USERS_ACTION}</Button>
          <Button onClick={resetLookup} variant="light">
            {QaaAdminPanelCopy.RESET_LOOKUP_ACTION}
          </Button>
        </Group>
      </Stack>

      {usersQuery.isLoading ? (
        <Stack align="center" gap="sm" py="xl">
          <Loader size="lg" />
          <Text c="dimmed">{QaaAdminPanelCopy.LOADING_USERS}</Text>
        </Stack>
      ) : null}

      {usersQuery.isError ? (
        <Alert color="red" icon={<IconAlertCircle size={18} />} title={QaaAdminPanelCopy.LOAD_USERS_ERROR}>
          <Stack gap="sm">
            <Text>
              {usersQuery.error instanceof Error
                ? usersQuery.error.message
                : QaaAdminPanelCopy.LOAD_USERS_ERROR}
            </Text>
            <Group>
              <Button onClick={() => void usersQuery.refetch()} variant="light">
                {QaaAdminPanelCopy.LOAD_USERS_ACTION}
              </Button>
            </Group>
          </Stack>
        </Alert>
      ) : null}

      {!usersQuery.isLoading && !usersQuery.isError && (usersQuery.data?.items.length ?? 0) === 0 ? (
        <Alert title={QaaAdminPanelCopy.USERS_SECTION}>{QaaAdminPanelCopy.NO_USERS}</Alert>
      ) : null}

      {!usersQuery.isLoading && !usersQuery.isError && (usersQuery.data?.items.length ?? 0) > 0 ? (
        <Table.ScrollContainer minWidth={860}>
          <Table highlightOnHover striped withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{QaaAdminPanelCopy.USERS_NAME_HEADER}</Table.Th>
                <Table.Th>{QaaAdminPanelCopy.USERS_EMAIL_HEADER}</Table.Th>
                <Table.Th>{QaaAdminPanelCopy.USERS_SLACK_HEADER}</Table.Th>
                <Table.Th>{QaaAdminPanelCopy.USERS_CREATED_AT_HEADER}</Table.Th>
                <Table.Th>{QaaAdminPanelCopy.USERS_TABLE_ACTIONS}</Table.Th>
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
                  <Table.Td>{formatDate(typeof user.created_at === "string" ? user.created_at : null)}</Table.Td>
                  <Table.Td>
                    <Group gap="xs">
                      <Button
                        aria-label={`${QaaAdminPanelCopy.LOAD_DETAILS_ACTION} ${user.id}`}
                        leftSection={<IconEye size={14} />}
                        onClick={() => openUserDetails(user.id)}
                        size="xs"
                        variant="light"
                      >
                        {QaaAdminPanelCopy.LOAD_DETAILS_ACTION}
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
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      ) : null}

      <Divider />

      <Stack gap="md">
        <div>
          <Title order={3}>{QaaAdminPanelCopy.CREATE_SERVICE_TOKEN_SECTION}</Title>
          <Text c="dimmed">{QaaAdminPanelCopy.CREATE_SERVICE_TOKEN_SUBTITLE}</Text>
        </div>

        {revokeSuccessMessage ? (
          <Alert color="teal" title={QaaAdminPanelCopy.CREATE_SERVICE_TOKEN_SECTION}>
            {revokeSuccessMessage}
          </Alert>
        ) : null}

        <Group align="flex-end" grow>
          <TextInput
            aria-label={QaaAdminPanelCopy.CREATE_SERVICE_TOKEN_NAME_LABEL}
            label={QaaAdminPanelCopy.CREATE_SERVICE_TOKEN_NAME_LABEL}
            value={serviceTokenForm.name}
            onChange={(event) =>
              setServiceTokenForm({
                name: event.currentTarget.value,
              })
            }
          />
          <Button
            leftSection={<IconPlus size={16} />}
            loading={createServiceTokenMutation.isPending}
            onClick={submitCreateServiceToken}
          >
            {QaaAdminPanelCopy.CREATE_SERVICE_TOKEN_ACTION}
          </Button>
        </Group>

        {createServiceTokenMutation.isError ? (
          <Alert color="red" icon={<IconAlertCircle size={18} />} title={QaaAdminPanelCopy.CREATE_SERVICE_TOKEN_ERROR}>
            {createServiceTokenMutation.error instanceof Error
              ? createServiceTokenMutation.error.message
              : QaaAdminPanelCopy.CREATE_SERVICE_TOKEN_ERROR}
          </Alert>
        ) : null}

        <Group align="flex-end" grow>
          <TextInput
            aria-label={QaaAdminPanelCopy.REVOKE_TOKEN_ID_LABEL}
            label={QaaAdminPanelCopy.REVOKE_TOKEN_ID_LABEL}
            value={revokeTokenForm.tokenId}
            onChange={(event) =>
              setRevokeTokenForm({
                tokenId: event.currentTarget.value,
              })
            }
          />
          <Button
            color="red"
            leftSection={<IconShieldX size={16} />}
            loading={revokeServiceTokenMutation.isPending}
            onClick={submitRevokeServiceToken}
            variant="light"
          >
            {QaaAdminPanelCopy.REVOKE_ACTION}
          </Button>
        </Group>

        {revokeServiceTokenMutation.isError ? (
          <Alert color="red" icon={<IconAlertCircle size={18} />} title={QaaAdminPanelCopy.REVOKE_ERROR}>
            {revokeServiceTokenMutation.error instanceof Error
              ? revokeServiceTokenMutation.error.message
              : QaaAdminPanelCopy.REVOKE_ERROR}
          </Alert>
        ) : null}
      </Stack>

      <Modal
        opened={createUserOpened}
        onClose={closeCreateUserModal}
        title={QaaAdminPanelCopy.CREATE_USER_MODAL_TITLE}
        transitionProps={{ duration: 0 }}
        withinPortal={false}
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

          <TextInput
            aria-label={QaaAdminPanelCopy.USERS_EMAIL_LABEL}
            label={QaaAdminPanelCopy.USERS_EMAIL_LABEL}
            value={createUserForm.email}
            onChange={(event) =>
              setCreateUserForm((current) => ({ ...current, email: event.currentTarget.value }))
            }
          />
          <TextInput
            aria-label={QaaAdminPanelCopy.USERS_SLACK_LABEL}
            label={QaaAdminPanelCopy.USERS_SLACK_LABEL}
            value={createUserForm.slackUserId}
            onChange={(event) =>
              setCreateUserForm((current) => ({ ...current, slackUserId: event.currentTarget.value }))
            }
          />
          <TextInput
            aria-label={QaaAdminPanelCopy.USERS_NAME_LABEL}
            label={QaaAdminPanelCopy.USERS_NAME_LABEL}
            value={createUserForm.name}
            onChange={(event) =>
              setCreateUserForm((current) => ({ ...current, name: event.currentTarget.value }))
            }
          />
          <Textarea
            aria-label={QaaAdminPanelCopy.USERS_DESCRIPTION_LABEL}
            autosize
            label={QaaAdminPanelCopy.USERS_DESCRIPTION_LABEL}
            minRows={3}
            value={createUserForm.description}
            onChange={(event) =>
              setCreateUserForm((current) => ({ ...current, description: event.currentTarget.value }))
            }
          />
          <Group justify="flex-end">
            <Button onClick={submitCreateUser} loading={createUserMutation.isPending}>
              {QaaAdminPanelCopy.CREATE_USER_ACTION}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={detailOpened}
        onClose={closeUserDetails}
        title={QaaAdminPanelCopy.DETAIL_MODAL_TITLE}
        transitionProps={{ duration: 0 }}
        withinPortal={false}
      >
        {userDetailQuery.isLoading ? (
          <Stack align="center" gap="sm" py="xl">
            <Loader size="lg" />
            <Text c="dimmed">{QaaAdminPanelCopy.LOADING_DETAILS}</Text>
          </Stack>
        ) : null}

        {userDetailQuery.isError ? (
          <Alert color="red" icon={<IconAlertCircle size={18} />} title={QaaAdminPanelCopy.LOAD_DETAILS_ERROR}>
            {userDetailQuery.error instanceof Error
              ? userDetailQuery.error.message
              : QaaAdminPanelCopy.LOAD_DETAILS_ERROR}
          </Alert>
        ) : null}

        {!userDetailQuery.isLoading && !userDetailQuery.isError && userDetailQuery.data ? (
          <UserDetailBody user={userDetailQuery.data} />
        ) : null}
      </Modal>

      <Modal
        opened={tokenModal !== null}
        onClose={closeTokenModal}
        title={tokenModal?.title ?? QaaAdminPanelCopy.TOKEN_FIELD_LABEL}
        transitionProps={{ duration: 0 }}
        withinPortal={false}
      >
        <Stack>
          <Alert color="yellow" icon={<IconAlertCircle size={18} />} title={tokenModal?.title ?? ""}>
            {QaaAdminPanelCopy.COPY_ONCE_WARNING}
          </Alert>
          <Textarea
            aria-label={QaaAdminPanelCopy.TOKEN_FIELD_LABEL}
            autosize
            label={QaaAdminPanelCopy.TOKEN_FIELD_LABEL}
            minRows={3}
            readOnly
            value={tokenModal?.token ?? ""}
          />
          <Group justify="space-between">
            <Badge color="yellow" variant="light">
              {QaaAdminPanelCopy.COPY_ONCE_WARNING}
            </Badge>
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
