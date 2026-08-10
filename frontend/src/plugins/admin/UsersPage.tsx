import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Loader,
  Modal,
  PasswordInput,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconAlertCircle, IconEdit, IconPlus, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { backendClient } from "@/api/backendClient";
import type { User, UserCreateRequest, UserUpdateRequest } from "@/api/types";
import { QueryKey } from "@/constants";
import { useAuthStore } from "@/store/authStore";

type CreateFormState = {
  username: string;
  password: string;
  displayName: string;
  isAdmin: boolean;
  autoLogin: boolean;
};

type EditFormState = {
  displayName: string;
  isAdmin: boolean;
  autoLogin: boolean;
  resetPassword: boolean;
  password: string;
};

const CREATE_FORM_INITIAL_STATE: CreateFormState = {
  username: "",
  password: "",
  displayName: "",
  isAdmin: false,
  autoLogin: false,
};

function buildEditFormState(user: User): EditFormState {
  return {
    displayName: user.display_name,
    isAdmin: user.is_admin,
    autoLogin: user.auto_login,
    password: "",
    resetPassword: false,
  };
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

export function UsersPage() {
  const queryClient = useQueryClient();
  const token = useAuthStore((state) => state.token);
  const currentUser = useAuthStore((state) => state.currentUser);
  const setCurrentUser = useAuthStore((state) => state.setCurrentUser);

  const [createOpened, setCreateOpened] = useState(false);
  const [createForm, setCreateForm] = useState<CreateFormState>(CREATE_FORM_INITIAL_STATE);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editForm, setEditForm] = useState<EditFormState | null>(null);
  const [deletingUser, setDeletingUser] = useState<User | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");

  const usersQuery = useQuery({
    enabled: Boolean(token),
    queryFn: ({ signal }) => backendClient.listUsers(token ?? "", signal),
    queryKey: [QueryKey.USERS, token],
  });

  const createMutation = useMutation({
    mutationFn: async (payload: UserCreateRequest) => {
      if (!token) {
        throw new Error("Authentication is required.");
      }

      return backendClient.createUser(token, payload);
    },
    onSuccess: async () => {
      setCreateOpened(false);
      setCreateForm(CREATE_FORM_INITIAL_STATE);
      await queryClient.invalidateQueries({ queryKey: [QueryKey.USERS] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ userId, payload }: { userId: number; payload: UserUpdateRequest }) => {
      if (!token) {
        throw new Error("Authentication is required.");
      }

      return backendClient.updateUser(token, userId, payload);
    },
    onSuccess: async (updatedUser) => {
      if (currentUser?.id === updatedUser.id) {
        setCurrentUser(updatedUser);
      }
      setEditingUser(null);
      setEditForm(null);
      await queryClient.invalidateQueries({ queryKey: [QueryKey.USERS] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (userId: number) => {
      if (!token) {
        throw new Error("Authentication is required.");
      }

      await backendClient.deleteUser(token, userId);
    },
    onSuccess: async () => {
      setDeletingUser(null);
      setDeleteConfirmation("");
      await queryClient.invalidateQueries({ queryKey: [QueryKey.USERS] });
    },
  });

  function openCreateModal(): void {
    createMutation.reset();
    setCreateForm(CREATE_FORM_INITIAL_STATE);
    setCreateOpened(true);
  }

  function closeCreateModal(): void {
    createMutation.reset();
    setCreateOpened(false);
    setCreateForm(CREATE_FORM_INITIAL_STATE);
  }

  function openEditModal(user: User): void {
    updateMutation.reset();
    setEditingUser(user);
    setEditForm(buildEditFormState(user));
  }

  function closeEditModal(): void {
    updateMutation.reset();
    setEditingUser(null);
    setEditForm(null);
  }

  function openDeleteModal(user: User): void {
    deleteMutation.reset();
    setDeletingUser(user);
    setDeleteConfirmation("");
  }

  function closeDeleteModal(): void {
    deleteMutation.reset();
    setDeletingUser(null);
    setDeleteConfirmation("");
  }

  function submitCreate(): void {
    createMutation.mutate({
      auto_login: createForm.autoLogin,
      display_name: createForm.displayName,
      is_admin: createForm.isAdmin,
      password: createForm.password,
      username: createForm.username,
    });
  }

  function submitEdit(): void {
    if (!editingUser || !editForm) {
      return;
    }

    const payload: UserUpdateRequest = {
      auto_login: editForm.autoLogin,
      display_name: editForm.displayName,
      is_admin: editForm.isAdmin,
    };

    if (editForm.resetPassword) {
      payload.password = editForm.password;
    }

    updateMutation.mutate({
      payload,
      userId: editingUser.id,
    });
  }

  const isDeletingSelf = deletingUser?.id === currentUser?.id;
  const deleteConfirmationMatches = deleteConfirmation.trim() === deletingUser?.username;

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={2}>Users</Title>
          <Text c="dimmed">Manage local TMS users, admin access, and password resets.</Text>
        </div>
        <Button leftSection={<IconPlus size={16} />} onClick={openCreateModal}>
          Create user
        </Button>
      </Group>

      {usersQuery.isLoading ? (
        <Stack align="center" gap="sm" py="xl">
          <Loader size="lg" />
          <Text c="dimmed">Loading users.</Text>
        </Stack>
      ) : null}

      {usersQuery.isError ? (
        <Alert color="red" icon={<IconAlertCircle size={18} />} title="Failed to load users">
          <Stack gap="sm">
            <Text>
              {usersQuery.error instanceof Error
                ? usersQuery.error.message
                : "Unable to load the user list."}
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
        <Alert title="No users yet">No users were returned by the backend.</Alert>
      ) : null}

      {!usersQuery.isLoading && !usersQuery.isError && (usersQuery.data?.items.length ?? 0) > 0 ? (
        <Table.ScrollContainer minWidth={820}>
          <Table highlightOnHover striped withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Username</Table.Th>
                <Table.Th>Display name</Table.Th>
                <Table.Th>Admin</Table.Th>
                <Table.Th>Auto-login</Table.Th>
                <Table.Th>Created</Table.Th>
                <Table.Th>Actions</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {usersQuery.data?.items.map((user) => {
                const isSelf = user.id === currentUser?.id;
                return (
                  <Table.Tr key={user.id}>
                    <Table.Td>{user.username}</Table.Td>
                    <Table.Td>{user.display_name}</Table.Td>
                    <Table.Td>
                      <Badge color={user.is_admin ? "blue" : "gray"} variant="light">
                        {user.is_admin ? "Yes" : "No"}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Badge color={user.auto_login ? "teal" : "gray"} variant="light">
                        {user.auto_login ? "Enabled" : "Disabled"}
                      </Badge>
                    </Table.Td>
                    <Table.Td>{formatDate(user.created_at)}</Table.Td>
                    <Table.Td>
                      <Group gap="xs">
                        <Button
                          aria-label={`Edit ${user.username}`}
                          leftSection={<IconEdit size={14} />}
                          onClick={() => openEditModal(user)}
                          size="xs"
                          variant="light"
                        >
                          Edit
                        </Button>
                        <Button
                          aria-label={`Delete ${user.username}`}
                          color="red"
                          disabled={isSelf}
                          leftSection={<IconTrash size={14} />}
                          onClick={() => openDeleteModal(user)}
                          size="xs"
                          variant="light"
                        >
                          Delete
                        </Button>
                      </Group>
                      {isSelf ? (
                        <Text c="dimmed" size="xs" mt={6}>
                          Your account cannot be deleted from this screen.
                        </Text>
                      ) : null}
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      ) : null}

      <Modal
        opened={createOpened}
        onClose={closeCreateModal}
        title="Create user"
        transitionProps={{ duration: 0 }}
        withinPortal={false}
      >
        <Stack>
          {createMutation.isError ? (
            <Alert color="red" icon={<IconAlertCircle size={18} />} title="Create failed">
              {createMutation.error instanceof Error
                ? createMutation.error.message
                : "Unable to create the user."}
            </Alert>
          ) : null}

          <TextInput
            aria-label="Username"
            label="Username"
            value={createForm.username}
            onChange={(event) =>
              setCreateForm((current) => ({ ...current, username: event.currentTarget.value }))
            }
          />
          <TextInput
            aria-label="Display name"
            label="Display name"
            value={createForm.displayName}
            onChange={(event) =>
              setCreateForm((current) => ({ ...current, displayName: event.currentTarget.value }))
            }
          />
          <PasswordInput
            aria-label="Password"
            description="Blank is allowed and creates an empty-password account."
            label="Password"
            value={createForm.password}
            onChange={(event) =>
              setCreateForm((current) => ({ ...current, password: event.currentTarget.value }))
            }
          />
          <Checkbox
            aria-label="Admin access"
            checked={createForm.isAdmin}
            label="Admin access"
            onChange={(event) =>
              setCreateForm((current) => ({ ...current, isAdmin: event.currentTarget.checked }))
            }
          />
          <Checkbox
            aria-label="Auto-login"
            checked={createForm.autoLogin}
            label="Auto-login"
            onChange={(event) =>
              setCreateForm((current) => ({ ...current, autoLogin: event.currentTarget.checked }))
            }
          />
          <Group justify="flex-end">
            <Button onClick={closeCreateModal} variant="default">
              Cancel
            </Button>
            <Button aria-label="Submit create user" loading={createMutation.isPending} onClick={submitCreate}>
              Create user
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={Boolean(editingUser && editForm)}
        onClose={closeEditModal}
        title="Edit user"
        transitionProps={{ duration: 0 }}
        withinPortal={false}
      >
        <Stack>
          {updateMutation.isError ? (
            <Alert color="red" icon={<IconAlertCircle size={18} />} title="Update failed">
              {updateMutation.error instanceof Error
                ? updateMutation.error.message
                : "Unable to update the user."}
            </Alert>
          ) : null}

          <TextInput aria-label="Username" label="Username" readOnly value={editingUser?.username ?? ""} />
          <TextInput
            aria-label="Display name"
            label="Display name"
            value={editForm?.displayName ?? ""}
            onChange={(event) =>
              setEditForm((current) =>
                current ? { ...current, displayName: event.currentTarget.value } : current
              )
            }
          />
          <Checkbox
            aria-label="Admin access"
            checked={editForm?.isAdmin ?? false}
            disabled={editingUser?.id === currentUser?.id}
            label="Admin access"
            onChange={(event) =>
              setEditForm((current) =>
                current ? { ...current, isAdmin: event.currentTarget.checked } : current
              )
            }
          />
          {editingUser?.id === currentUser?.id ? (
            <Text c="dimmed" size="sm">
              You cannot remove your own admin access.
            </Text>
          ) : null}
          <Checkbox
            aria-label="Auto-login"
            checked={editForm?.autoLogin ?? false}
            label="Auto-login"
            onChange={(event) =>
              setEditForm((current) =>
                current ? { ...current, autoLogin: event.currentTarget.checked } : current
              )
            }
          />
          <Checkbox
            aria-label="Reset password"
            checked={editForm?.resetPassword ?? false}
            label="Reset password"
            onChange={(event) =>
              setEditForm((current) =>
                current
                  ? {
                      ...current,
                      password: event.currentTarget.checked ? current.password : "",
                      resetPassword: event.currentTarget.checked,
                    }
                  : current
              )
            }
          />
          <PasswordInput
            aria-label="New password"
            description="Leave reset disabled to keep the current password. Enable it and submit an empty value to reset to an empty password."
            disabled={!editForm?.resetPassword}
            label="New password"
            value={editForm?.password ?? ""}
            onChange={(event) =>
              setEditForm((current) =>
                current ? { ...current, password: event.currentTarget.value } : current
              )
            }
          />
          <Group justify="flex-end">
            <Button onClick={closeEditModal} variant="default">
              Cancel
            </Button>
            <Button aria-label="Save changes" loading={updateMutation.isPending} onClick={submitEdit}>
              Save changes
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={Boolean(deletingUser)}
        onClose={closeDeleteModal}
        title="Delete user"
        transitionProps={{ duration: 0 }}
        withinPortal={false}
      >
        <Stack>
          {deleteMutation.isError ? (
            <Alert color="red" icon={<IconAlertCircle size={18} />} title="Delete failed">
              {deleteMutation.error instanceof Error
                ? deleteMutation.error.message
                : "Unable to delete the user."}
            </Alert>
          ) : null}

          <Text>
            Type <strong>{deletingUser?.username ?? ""}</strong> to confirm deletion.
          </Text>
          <TextInput
            aria-label="Confirmation"
            label="Confirmation"
            value={deleteConfirmation}
            onChange={(event) => setDeleteConfirmation(event.currentTarget.value)}
          />
          {isDeletingSelf ? (
            <Alert color="yellow" title="Blocked">
              Your account cannot be deleted from this screen.
            </Alert>
          ) : null}
          <Group justify="flex-end">
            <Button onClick={closeDeleteModal} variant="default">
              Cancel
            </Button>
            <Button
              aria-label="Delete user"
              color="red"
              disabled={isDeletingSelf || !deleteConfirmationMatches}
              loading={deleteMutation.isPending}
              onClick={() => {
                if (!deletingUser) {
                  return;
                }
                deleteMutation.mutate(deletingUser.id);
              }}
            >
              Delete user
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
