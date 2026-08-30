import { useMemo, useState } from "react";
import {
  Button,
  Checkbox,
  Group,
  Modal,
  Popover,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { IconPlus, IconRefresh, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { agentClient } from "@/api/agentClient";
import type {
  RequestsCredentialPublic,
  RequestsCredentialType,
  RequestsEnvironmentColumn,
} from "@/api/types";
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
import {
  applyVariableCompletion,
  availableVariableNames,
  buildVariableMap,
  findUnresolved,
  getVariableCompletion,
  type VariableCompletion,
} from "@/plugins/requests/requestsVariables";
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

type CredentialTemplateField =
  | "adminTokenUrl"
  | "loginUrl"
  | "password"
  | "permanentToken"
  | "referer"
  | "scheme"
  | "token"
  | "username"
  | "verifyUrl";

type NewSecretDraft = {
  key: string;
  values: Record<string, string>;
};

function buildEmptySecretDraft(): NewSecretDraft {
  return { key: "", values: {} };
}

function normalizeVariableValues(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value.length > 0));
}

function insertVariableReference(
  value: string,
  completion: VariableCompletion | null,
  variableName: string
): string {
  if (completion) {
    return applyVariableCompletion(value, completion, variableName);
  }

  return `${value}{{${variableName}}}`;
}

function applySecretValuesToAll(
  environments: RequestsEnvironmentColumn[],
  values: Record<string, string>,
  mode: "fill-empty" | "overwrite-all"
): Record<string, string> {
  if (environments.length === 0) {
    return values;
  }

  const sourceValue =
    mode === "fill-empty"
      ? environments
          .map((environment) => values[environment.id] ?? "")
          .find((value) => value.length > 0) ?? ""
      : values[environments[0]?.id ?? ""] ?? "";

  const nextValues = { ...values };
  for (const environment of environments) {
    if (mode === "fill-empty") {
      if ((nextValues[environment.id] ?? "").length === 0 && sourceValue.length > 0) {
        nextValues[environment.id] = sourceValue;
      }
      continue;
    }

    if (sourceValue.length > 0) {
      nextValues[environment.id] = sourceValue;
    } else {
      delete nextValues[environment.id];
    }
  }

  return nextValues;
}

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
  if (credential.type === "bearer") {
    base.token = credential.config.token;
  }


  if (credential.type === "api_key_permanent") {
    base.scheme = credential.config.scheme;
    base.verifyUrl = credential.config.verifyUrl;
    base.permanentToken = credential.config.permanentToken;
  }

  if (credential.type === "login_password") {
    base.loginUrl = credential.config.loginUrl;
    base.referer = credential.config.referer;
    base.username = credential.config.username;
    base.password = credential.config.password;
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
    return credential.config.token || "Blank token";
  }

  if (credential.type === "api_key_permanent") {
    return `${credential.config.scheme} -> ${credential.config.verifyUrl} (${credential.config.permanentToken || "blank token"})`;
  }

  if (credential.type === "login_password") {
    return `${credential.config.username} @ ${credential.config.loginUrl}`;
  }

  return `Admin ${credential.config.adminCredentialId}, client ${credential.config.clientId}`;
}

function buildCredentialPayload(form: CredentialFormState): Record<string, unknown> {
  if (form.type === "bearer") {
    return {
      config: { token: form.token },
      name: form.name.trim() || undefined,
      type: form.type,
    };
  }

  if (form.type === "api_key_permanent") {
    return {
      config: {
        permanentToken: form.permanentToken,
        scheme: form.scheme,
        verifyUrl: form.verifyUrl,
      },
      name: form.name.trim() || undefined,
      type: form.type,
    };
  }

  if (form.type === "login_password") {
    return {
      config: {
        loginUrl: form.loginUrl,
        password: form.password,
        referer: form.referer,
        username: form.username,
      },
      name: form.name.trim() || undefined,
      type: form.type,
    };
  }

  return {
    config: {
      adminCredentialId: form.adminCredentialId,
      adminTokenUrl: form.adminTokenUrl,
      clientId: Number(form.clientId),
      issueByCurrentUser: form.issueByCurrentUser,
    },
    name: form.name.trim() || undefined,
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
  const [fieldCompletions, setFieldCompletions] = useState<Partial<Record<CredentialTemplateField, VariableCompletion | null>>>({});
  const [newSecretDraft, setNewSecretDraft] = useState<NewSecretDraft>(() => buildEmptySecretDraft());
  const [newSecretField, setNewSecretField] = useState<CredentialTemplateField | null>(null);

  const credentialsQuery = useQuery({
    enabled: Boolean(token && agentPort !== null),
    queryFn: ({ signal }) => agentClient.listCredentials(agentPort ?? 0, token ?? "", signal),
    queryKey: [QueryKey.REQUESTS_CREDENTIALS, token, agentPort],
    refetchOnWindowFocus: false,
    retry: false,
  });

  const environmentsQuery = useQuery({
    enabled: Boolean(token && agentPort !== null),
    queryFn: ({ signal }) => agentClient.getRequestsState(agentPort ?? 0, token ?? "", signal),
    queryKey: [QueryKey.REQUESTS_ENVIRONMENTS, token, agentPort],
    refetchOnWindowFocus: false,
    retry: false,
  });

  const credentials = useMemo(() => credentialsQuery.data?.credentials ?? [], [credentialsQuery.data?.credentials]);
  const bearerCredentialOptions = useMemo(() => {
    return credentials
      .filter((credential) => credential.type === "bearer")
      .map((credential) => ({ label: credential.name, value: credential.id }));
  }, [credentials]);

  const environments = environmentsQuery.data?.environments ?? [];
  const activeEnvironmentId = environmentsQuery.data?.activeId ?? null;
  const variableMap = useMemo(
    () => buildVariableMap(environmentsQuery.data ?? null, activeEnvironmentId),
    [activeEnvironmentId, environmentsQuery.data]
  );
  const variableNames = useMemo(
    () => availableVariableNames(environmentsQuery.data ?? null, activeEnvironmentId),
    [activeEnvironmentId, environmentsQuery.data]
  );

  const resetFormState = () => {
    setForm(buildEmptyCredentialForm());
    setFieldCompletions({});
    setNewSecretDraft(buildEmptySecretDraft());
    setNewSecretField(null);
  };

  const updateTemplateField = (field: CredentialTemplateField, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const openNewSecret = (field: CredentialTemplateField) => {
    setNewSecretField(field);
    setNewSecretDraft(buildEmptySecretDraft());
  };

  const closeNewSecret = () => {
    setNewSecretField(null);
    setNewSecretDraft(buildEmptySecretDraft());
  };

  const insertSecretIntoField = (field: CredentialTemplateField, variableName: string) => {
    setForm((current) => ({
      ...current,
      [field]: insertVariableReference(
        current[field],
        fieldCompletions[field] ?? null,
        variableName
      ),
    }));
    setFieldCompletions((current) => ({ ...current, [field]: null }));
  };

  const detectVariableCompletion = (value: string, caret: number) =>
    getVariableCompletion(value, caret) ??
    (caret === value.length ? null : getVariableCompletion(value, value.length));

  const renderTemplateField = (field: CredentialTemplateField, label: string) => {
    const completion = fieldCompletions[field] ?? detectVariableCompletion(form[field], form[field].length);
    const suggestions =
      completion === null
        ? []
        : variableNames.filter((name) =>
            completion.partial.length === 0
              ? true
              : name.toLowerCase().includes(completion.partial.toLowerCase())
          );
    const unresolved = findUnresolved(form[field], variableMap);

    return (
      <Group align="flex-start" wrap="nowrap">
        <Stack gap={4} style={{ flex: 1 }}>
          <TextInput
            label={label}
            onChange={(event) => {
              const value = event.currentTarget.value;
              const caret = event.currentTarget.selectionStart ?? value.length;
              updateTemplateField(field, value);
              setFieldCompletions((current) => ({
                ...current,
                [field]: detectVariableCompletion(value, caret),
              }));
            }}
            onClick={(event) => {
              const value = event.currentTarget.value;
              const caret = event.currentTarget.selectionStart ?? value.length;
              setFieldCompletions((current) => ({
                ...current,
                [field]: detectVariableCompletion(value, caret),
              }));
            }}
            onKeyUp={(event) => {
              const value = event.currentTarget.value;
              const caret = event.currentTarget.selectionStart ?? value.length;
              setFieldCompletions((current) => ({
                ...current,
                [field]: detectVariableCompletion(value, caret),
              }));
            }}
            type="text"
            value={form[field]}
          />
          {completion && suggestions.length > 0 ? (
            <Group gap="xs">
              <Text c="dimmed" size="xs">
                Variables
              </Text>
              {suggestions.map((name) => (
                <Button
                  key={name}
                  onClick={() => insertSecretIntoField(field, name)}
                  size="xs"
                  variant="light"
                >
                  {name}
                </Button>
              ))}
            </Group>
          ) : null}
          {unresolved.length > 0 ? (
            <Text c="dimmed" size="xs">
              Unresolved variables: {unresolved.join(", ")}
            </Text>
          ) : null}
        </Stack>
        <Popover opened={newSecretField === field} position="bottom-end" shadow="md" width={Math.max(360, 220 + environments.length * 120)} withinPortal>
          <Popover.Target>
            <Button onClick={() => openNewSecret(field)} size="xs" variant="default">
              + New secret
            </Button>
          </Popover.Target>
          <Popover.Dropdown>
            <Stack gap="sm">
              <Text fw={600} size="sm">
                New secret
              </Text>
              <Table withTableBorder>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th style={{ minWidth: 160 }}>Name</Table.Th>
                    {environments.map((environment) => (
                      <Table.Th key={environment.id} style={{ minWidth: 160 }}>
                        {environment.name}
                      </Table.Th>
                    ))}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  <Table.Tr>
                    <Table.Td>
                      <TextInput
                        aria-label="New secret name"
                        onChange={(event) =>
                          setNewSecretDraft((current) => ({
                            ...current,
                            key: event.currentTarget.value,
                          }))
                        }
                        value={newSecretDraft.key}
                      />
                    </Table.Td>
                    {environments.map((environment) => (
                      <Table.Td key={environment.id}>
                        <TextInput
                          aria-label={`${environment.name} secret value`}
                          onChange={(event) => {
                            const value = event.currentTarget.value;
                            setNewSecretDraft((current) => ({
                              ...current,
                              values:
                                value.length > 0
                                  ? { ...current.values, [environment.id]: value }
                                  : Object.fromEntries(
                                      Object.entries(current.values).filter(
                                        ([key]) => key !== environment.id
                                      )
                                    ),
                            }));
                          }}
                          value={newSecretDraft.values[environment.id] ?? ""}
                        />
                      </Table.Td>
                    ))}
                  </Table.Tr>
                </Table.Tbody>
              </Table>
              <Group gap="xs" justify="space-between">
                <Group gap="xs">
                  <Button
                    onClick={() =>
                      setNewSecretDraft((current) => ({
                        ...current,
                        values: applySecretValuesToAll(
                          environments,
                          current.values,
                          "fill-empty"
                        ),
                      }))
                    }
                    size="xs"
                    variant="light"
                  >
                    Fill empty
                  </Button>
                  <Button
                    onClick={() =>
                      setNewSecretDraft((current) => ({
                        ...current,
                        values: applySecretValuesToAll(
                          environments,
                          current.values,
                          "overwrite-all"
                        ),
                      }))
                    }
                    size="xs"
                    variant="light"
                  >
                    Overwrite all
                  </Button>
                </Group>
                <Button
                  disabled={newSecretDraft.key.trim().length === 0}
                  loading={createSecretMutation.isPending}
                  onClick={() => void createSecretMutation.mutateAsync()}
                  size="xs"
                >
                  Create secret
                </Button>
                <Button onClick={closeNewSecret} size="xs" variant="default">
                  Close
                </Button>
              </Group>
            </Stack>
          </Popover.Dropdown>
        </Popover>
      </Group>
    );
  };

  const createSecretMutation = useMutation({
    mutationFn: async () => {
      if (!token || agentPort === null || newSecretField === null) {
        throw new Error("Authentication is required.");
      }

      return agentClient.createVariable(agentPort, token, {
        enabled: true,
        key: newSecretDraft.key.trim(),
        secret: true,
        values: normalizeVariableValues(newSecretDraft.values),
      });
    },
    onError: (error) => {
      setNotice({ message: getErrorMessage(error, "Unable to create the secret."), status: "error" });
    },
    onSuccess: async (nextState) => {
      queryClient.setQueryData([QueryKey.REQUESTS_ENVIRONMENTS, token, agentPort], nextState);
      if (newSecretField !== null) {
        insertSecretIntoField(newSecretField, newSecretDraft.key.trim());
      }
      closeNewSecret();
      await queryClient.invalidateQueries({ queryKey: [QueryKey.REQUESTS_ENVIRONMENTS] });
    },
  });

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
      return agentClient.resolveCredential(agentPort, token, { credentialId, environmentId: activeEnvironmentId, force: true });
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
        description="Credential recipes stay local and can reference {{variables}} or {{secrets}} from the active environment."
        title="Credentials"
      >
        {canWrite ? (
          <Group justify="space-between" wrap="wrap">
            <Button
              leftSection={<IconPlus size={16} />}
              onClick={() => { resetFormState(); setModalOpen(true); }}
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
                          onClick={() => { resetFormState(); setForm(buildFormFromCredential(credential)); setModalOpen(true); }}
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
        onClose={() => { setModalOpen(false); resetFormState(); }}
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
          {form.type === "bearer" ? renderTemplateField("token", "Token") : null}
          {form.type === "api_key_permanent" ? (
            <Stack gap="sm">
              {renderTemplateField("permanentToken", "Permanent token")}
              {renderTemplateField("verifyUrl", "Verify URL")}
              {renderTemplateField("scheme", "Scheme")}
            </Stack>
          ) : null}
          {form.type === "login_password" ? (
            <Stack gap="sm">
              {renderTemplateField("loginUrl", "Login URL")}
              {renderTemplateField("username", "Username")}
              {renderTemplateField("password", "Password")}
              {renderTemplateField("referer", "Referer")}
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
              {renderTemplateField("adminTokenUrl", "Admin token URL")}
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
            <Button variant="default" onClick={() => { setModalOpen(false); resetFormState(); }}>
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

