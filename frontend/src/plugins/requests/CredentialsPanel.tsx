import { useMemo, useState } from "react";
import {
  Button,
  Checkbox,
  Group,
  Modal,
  PasswordInput,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { IconPlus, IconRefresh, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { agentClient } from "@/api/agentClient";
import type { RequestsCredentialPublic, RequestsCredentialType } from "@/api/types";
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

type CredentialFormState = {
  adminCredentialId: string;
  adminTokenUrl: string;
  clientId: string;
  id: string | null;
  isEdit: boolean;
  issueByCurrentUser: boolean;
  loginUrl: string;
  name: string;
  password: string;
  permanentToken: string;
  referer: string;
  scheme: string;
  token: string;
  type: RequestsCredentialType;
  username: string;
  verifyUrl: string;
};

function buildEmptyCredentialForm(): CredentialFormState {
  return {
    adminCredentialId: "",
    adminTokenUrl: "",
    clientId: "",
    id: null,
    isEdit: false,
    issueByCurrentUser: true,
    loginUrl: "",
    name: "",
    password: "",
    permanentToken: "",
    referer: "",
    scheme: "APIKey",
    token: "",
    type: "bearer",
    username: "",
    verifyUrl: "",
  };
}

function buildFormFromCredential(credential: RequestsCredentialPublic): CredentialFormState {
  const base = buildEmptyCredentialForm();
  base.id = credential.id;
  base.isEdit = true;
  base.name = credential.name;
  base.type = credential.type;

  if (credential.type === "api_key_permanent") {
    base.scheme = credential.config.scheme;
    base.verifyUrl = credential.config.verifyUrl;
  }

  if (credential.type === "login_password") {
    base.loginUrl = credential.config.loginUrl;
    base.referer = credential.config.referer;
    base.username = credential.config.username;
  }

  if (credential.type === "client_admin") {
    base.adminCredentialId = credential.config.adminCredentialId;
    base.adminTokenUrl = credential.config.adminTokenUrl;
    base.clientId = String(credential.config.clientId);
    base.issueByCurrentUser = credential.config.issueByCurrentUser;
  }

  return base;
}

function describeCredential(credential: RequestsCredentialPublic): string {
  if (credential.type === "bearer") {
    return credential.config.hasToken ? "Token configured" : "Token missing";
  }

  if (credential.type === "api_key_permanent") {
    return `${credential.config.scheme} -> ${credential.config.verifyUrl} (${credential.config.hasPermanentToken ? "secret set" : "secret missing"})`;
  }

  if (credential.type === "login_password") {
    return `${credential.config.username} @ ${credential.config.loginUrl} (${credential.config.hasPassword ? "password set" : "password missing"})`;
  }

  return `Admin ${credential.config.adminCredentialId}, client ${credential.config.clientId}`;
}

function buildCredentialPayload(form: CredentialFormState): Record<string, unknown> {
  if (form.type === "bearer") {
    return form.isEdit
      ? {
          config: form.token.trim().length > 0 ? { token: form.token } : {},
          name: form.name.trim() || undefined,
          type: form.type,
        }
      : {
          config: { token: form.token },
          name: form.name.trim(),
          type: form.type,
        };
  }

  if (form.type === "api_key_permanent") {
    return form.isEdit
      ? {
          config: {
            ...(form.permanentToken.trim().length > 0 ? { permanentToken: form.permanentToken } : {}),
            ...(form.scheme.trim().length > 0 ? { scheme: form.scheme } : {}),
            ...(form.verifyUrl.trim().length > 0 ? { verifyUrl: form.verifyUrl } : {}),
          },
          name: form.name.trim() || undefined,
          type: form.type,
        }
      : {
          config: {
            permanentToken: form.permanentToken,
            scheme: form.scheme || "APIKey",
            verifyUrl: form.verifyUrl,
          },
          name: form.name.trim(),
          type: form.type,
        };
  }

  if (form.type === "login_password") {
    return form.isEdit
      ? {
          config: {
            ...(form.loginUrl.trim().length > 0 ? { loginUrl: form.loginUrl } : {}),
            ...(form.password.trim().length > 0 ? { password: form.password } : {}),
            ...(form.referer.trim().length > 0 ? { referer: form.referer } : {}),
            ...(form.username.trim().length > 0 ? { username: form.username } : {}),
          },
          name: form.name.trim() || undefined,
          type: form.type,
        }
      : {
          config: {
            loginUrl: form.loginUrl,
            password: form.password,
            referer: form.referer,
            username: form.username,
          },
          name: form.name.trim(),
          type: form.type,
        };
  }

  return form.isEdit
    ? {
        config: {
          ...(form.adminCredentialId.trim().length > 0 ? { adminCredentialId: form.adminCredentialId } : {}),
          ...(form.adminTokenUrl.trim().length > 0 ? { adminTokenUrl: form.adminTokenUrl } : {}),
          ...(form.clientId.trim().length > 0 ? { clientId: Number(form.clientId) } : {}),
          issueByCurrentUser: form.issueByCurrentUser,
        },
        name: form.name.trim() || undefined,
        type: form.type,
      }
    : {
        config: {
          adminCredentialId: form.adminCredentialId,
          adminTokenUrl: form.adminTokenUrl,
          clientId: Number(form.clientId),
          issueByCurrentUser: form.issueByCurrentUser,
        },
        name: form.name.trim(),
        type: form.type,
      };
}

export function CredentialsPanel() {
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((state) => state.currentUser);
  const canWrite = hasPermission(currentUser, REQUESTS_WRITE_PERMISSION);
  const { agentPort, companionUnavailable, preflightQuery, probedPorts, token } = useRequestsAgent();
  const [notice, setNotice] = useState<RequestsNotice | null>(null);
  const [form, setForm] = useState<CredentialFormState>(() => buildEmptyCredentialForm());
  const [modalOpen, setModalOpen] = useState(false);
  const [resolveMessages, setResolveMessages] = useState<Record<string, string>>({});

  const credentialsQuery = useQuery({
    enabled: Boolean(token && agentPort !== null),
    queryFn: ({ signal }) => agentClient.listCredentials(agentPort ?? 0, token ?? "", signal),
    queryKey: [QueryKey.REQUESTS_CREDENTIALS, token, agentPort],
    refetchOnWindowFocus: false,
    retry: false,
  });

  const credentials = useMemo(() => credentialsQuery.data?.credentials ?? [], [credentialsQuery.data?.credentials]);
  const bearerCredentialOptions = useMemo(() => {
    return credentials
      .filter((credential) => credential.type === "bearer")
      .map((credential) => ({ label: credential.name, value: credential.id }));
  }, [credentials]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!token || agentPort === null) {
        throw new Error("Authentication is required.");
      }

      const payload = buildCredentialPayload(form);
      if (form.isEdit && form.id) {
        return agentClient.updateCredential(agentPort, token, form.id, payload);
      }

      return agentClient.createCredential(agentPort, token, payload);
    },
    onError: (error) => {
      setNotice({ message: getErrorMessage(error, "Unable to save the credential."), status: "error" });
    },
    onSuccess: async () => {
      setModalOpen(false);
      setForm(buildEmptyCredentialForm());
      await queryClient.invalidateQueries({ queryKey: [QueryKey.REQUESTS_CREDENTIALS] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (credentialId: string) => {
      if (!token || agentPort === null) {
        throw new Error("Authentication is required.");
      }
      return agentClient.deleteCredential(agentPort, token, credentialId);
    },
    onError: (error) => {
      setNotice({ message: getErrorMessage(error, "Unable to delete the credential."), status: "error" });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [QueryKey.REQUESTS_CREDENTIALS] });
    },
  });

  const resolveMutation = useMutation({
    mutationFn: async (credentialId: string) => {
      if (!token || agentPort === null) {
        throw new Error("Authentication is required.");
      }
      return agentClient.resolveCredential(agentPort, token, { credentialId, force: true });
    },
    onError: (error, credentialId) => {
      setResolveMessages((current) => ({
        ...current,
        [credentialId]: getErrorMessage(error, "Unable to resolve the credential."),
      }));
    },
    onSuccess: (response, credentialId) => {
      setResolveMessages((current) => ({
        ...current,
        [credentialId]: response.ok
          ? `OK${response.expiresAt ? ` · expires ${response.expiresAt}` : ""}`
          : `Error · ${response.error ?? "Unknown error"}`,
      }));
    },
  });

  if (preflightQuery.isLoading) {
    return <RequestsLoadingState message="Checking the local companion app before loading credentials." />;
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

  if (credentialsQuery.isLoading) {
    return <RequestsLoadingState message="Loading credential metadata from the companion app." />;
  }

  if (credentialsQuery.isError) {
    return (
      <RequestsErrorAlert
        error={credentialsQuery.error}
        fallback="Unable to load request credentials."
        onRetry={() => void credentialsQuery.refetch()}
        title="Credentials failed"
      />
    );
  }

  return (
    <Stack gap="md">
      <RequestsNoticeAlert notice={notice} />
      {!canWrite ? <Text c="dimmed" size="sm">Read-only access. Credential create, edit, delete, and test actions are hidden.</Text> : null}
      <RequestsSurface
        description="Credential secrets stay local to the companion app and are never returned to the browser."
        title="Credentials"
      >
        {canWrite ? (
          <Group justify="space-between" wrap="wrap">
            <Button
              leftSection={<IconPlus size={16} />}
              onClick={() => { setForm(buildEmptyCredentialForm()); setModalOpen(true); }}
            >
              New credential
            </Button>
          </Group>
        ) : null}
        {credentials.length === 0 ? (
          <RequestsEmptyCard body="No credentials have been created yet." title="Credentials" />
        ) : (
          <Table striped withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>Type</Table.Th>
                <Table.Th>Details</Table.Th>
                <Table.Th>Updated</Table.Th>
                {canWrite ? <Table.Th></Table.Th> : null}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {credentials.map((credential) => (
                <Table.Tr key={credential.id}>
                  <Table.Td>{credential.name}</Table.Td>
                  <Table.Td>{credential.type}</Table.Td>
                  <Table.Td>
                    <Stack gap={2}>
                      <Text size="sm">{describeCredential(credential)}</Text>
                      {resolveMessages[credential.id] ? (
                        <Text c={resolveMessages[credential.id]?.startsWith("OK") ? "teal" : "red"} size="xs">
                          {resolveMessages[credential.id]}
                        </Text>
                      ) : null}
                    </Stack>
                  </Table.Td>
                  <Table.Td>{credential.updatedAt}</Table.Td>
                  {canWrite ? (
                    <Table.Td>
                      <Group gap="xs" justify="flex-end">
                        <Button
                          onClick={() => { setForm(buildFormFromCredential(credential)); setModalOpen(true); }}
                          size="xs"
                          variant="light"
                        >
                          Edit
                        </Button>
                        <Button
                          leftSection={<IconRefresh size={16} />}
                          loading={resolveMutation.isPending}
                          onClick={() => void resolveMutation.mutateAsync(credential.id)}
                          size="xs"
                          variant="light"
                        >
                          Test
                        </Button>
                        <Button
                          color="red"
                          leftSection={<IconTrash size={16} />}
                          onClick={() => {
                            if (window.confirm(`Delete credential ${credential.name}?`)) {
                              void deleteMutation.mutateAsync(credential.id);
                            }
                          }}
                          size="xs"
                          variant="light"
                        >
                          Delete
                        </Button>
                      </Group>
                    </Table.Td>
                  ) : null}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </RequestsSurface>
      <Modal
        onClose={() => { setModalOpen(false); setForm(buildEmptyCredentialForm()); }}
        opened={modalOpen}
        size={650}
        title={form.isEdit ? "Edit credential" : "Create credential"}
      >
        <Stack gap="sm">
          <TextInput
            label="Name"
            onChange={(event) => setForm((current) => ({ ...current, name: event.currentTarget.value }))}
            value={form.name}
          />
          <Select
            data={[
              { label: "Bearer", value: "bearer" },
              { label: "API key permanent", value: "api_key_permanent" },
              { label: "Login password", value: "login_password" },
              { label: "Client admin", value: "client_admin" },
            ]}
            disabled={form.isEdit}
            label="Type"
            onChange={(value) => setForm((current) => ({ ...current, type: (value ?? "bearer") as RequestsCredentialType }))}
            value={form.type}
          />
          {form.type === "bearer" ? (
            <PasswordInput
              label="Token"
              onChange={(event) => setForm((current) => ({ ...current, token: event.currentTarget.value }))}
              placeholder={form.isEdit ? "leave blank to keep" : undefined}
              value={form.token}
            />
          ) : null}
          {form.type === "api_key_permanent" ? (
            <Stack gap="sm">
              <PasswordInput
                label="Permanent token"
                onChange={(event) => setForm((current) => ({ ...current, permanentToken: event.currentTarget.value }))}
                placeholder={form.isEdit ? "leave blank to keep" : undefined}
                value={form.permanentToken}
              />
              <TextInput
                label="Verify URL"
                onChange={(event) => setForm((current) => ({ ...current, verifyUrl: event.currentTarget.value }))}
                value={form.verifyUrl}
              />
              <TextInput
                label="Scheme"
                onChange={(event) => setForm((current) => ({ ...current, scheme: event.currentTarget.value }))}
                value={form.scheme}
              />
            </Stack>
          ) : null}
          {form.type === "login_password" ? (
            <Stack gap="sm">
              <TextInput
                label="Login URL"
                onChange={(event) => setForm((current) => ({ ...current, loginUrl: event.currentTarget.value }))}
                value={form.loginUrl}
              />
              <TextInput
                label="Username"
                onChange={(event) => setForm((current) => ({ ...current, username: event.currentTarget.value }))}
                value={form.username}
              />
              <PasswordInput
                label="Password"
                onChange={(event) => setForm((current) => ({ ...current, password: event.currentTarget.value }))}
                placeholder={form.isEdit ? "leave blank to keep" : undefined}
                value={form.password}
              />
              <TextInput
                label="Referer"
                onChange={(event) => setForm((current) => ({ ...current, referer: event.currentTarget.value }))}
                value={form.referer}
              />
            </Stack>
          ) : null}
          {form.type === "client_admin" ? (
            <Stack gap="sm">
              <Select
                data={bearerCredentialOptions}
                label="Admin credential"
                onChange={(value) => setForm((current) => ({ ...current, adminCredentialId: value ?? "" }))}
                value={form.adminCredentialId}
              />
              <TextInput
                label="Admin token URL"
                onChange={(event) => setForm((current) => ({ ...current, adminTokenUrl: event.currentTarget.value }))}
                value={form.adminTokenUrl}
              />
              <TextInput
                label="Client ID"
                onChange={(event) => setForm((current) => ({ ...current, clientId: event.currentTarget.value }))}
                value={form.clientId}
              />
              <Checkbox
                checked={form.issueByCurrentUser}
                label="Issue by current user"
                onChange={(event) =>
                  setForm((current) => ({ ...current, issueByCurrentUser: event.currentTarget.checked }))
                }
              />
            </Stack>
          ) : null}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => { setModalOpen(false); setForm(buildEmptyCredentialForm()); }}>
              Cancel
            </Button>
            <Button
              loading={saveMutation.isPending}
              onClick={() => void saveMutation.mutateAsync()}
            >
              Save
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

