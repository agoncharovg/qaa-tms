import { type CSSProperties, useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Badge,
  Button,
  Checkbox,
  Collapse,
  Grid,
  Group,
  Modal,
  Select,
  SegmentedControl,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  UnstyledButton,
} from "@mantine/core";
import {
  IconChevronDown,
  IconChevronRight,
  IconDeviceFloppy,
  IconFolder,
  IconPlus,
  IconSend,
  IconTrash,
} from "@tabler/icons-react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";

import { agentClient } from "@/api/agentClient";
import type {
  RequestsExecuteResponse,
  RequestsFolderNode,
  RequestsHeaderField,
  RequestsItemReadResponse,
  RequestsItemsResponse,
  RequestsMethod,
  RequestsQueryParam,
  RequestsRequestBody,
} from "@/api/types";
import { HttpMethod, QueryKey } from "@/constants";
import { hasPermission } from "@/plugins/permissions";
import {
  RequestsCompanionUnavailableAlert,
  RequestsEmptyCard,
  RequestsErrorAlert,
  RequestsLoadingState,
  RequestsNoticeAlert,
  RequestsSurface,
} from "@/plugins/requests/RequestsShared";
import {
  clearRequestsDraft,
  clearRequestsDraftsForFolder,
  getRequestsDraft,
  renameRequestsDraftFolder,
  setRequestsDraft,
  type RequestsEditorDraft,
} from "@/plugins/requests/requestsDrafts";
import { getErrorMessage, type RequestsNotice, useRequestsAgent } from "@/plugins/requests/requestsShared";
import { useAuthStore } from "@/store/authStore";

const REQUESTS_WRITE_PERMISSION = "requests.write";

const FOLDER_ROW_STYLE: CSSProperties = {
  alignItems: "center",
  border: "1px solid transparent",
  borderRadius: "10px",
  display: "flex",
  gap: "8px",
  justifyContent: "space-between",
  padding: "8px 12px",
  width: "100%",
};

const ITEM_ROW_STYLE: CSSProperties = {
  alignItems: "center",
  border: "1px solid transparent",
  borderRadius: "8px",
  display: "flex",
  justifyContent: "space-between",
  padding: "6px 10px",
  width: "100%",
};

const BODY_MODE_OPTIONS = [
  { label: "None", value: "none" },
  { label: "JSON", value: "json" },
  { label: "Raw", value: "raw" },
  { label: "Form", value: "form" },
];

const HTTP_METHOD_OPTIONS = Object.values(HttpMethod).map((value) => ({
  label: value,
  value,
}));

type FolderModalState = {
  mode: "create" | "rename";
  open: boolean;
};

type FolderItemsState = {
  error: unknown;
  isError: boolean;
  isLoading: boolean;
  items: RequestsItemsResponse["items"];
  refetch: () => Promise<unknown>;
};

function buildEmptyHeaderField(): RequestsHeaderField {
  return { enabled: true, name: "", value: "" };
}

function buildEmptyQueryParam(): RequestsQueryParam {
  return { enabled: true, name: "", value: "" };
}

function ensureHeaderRows(rows: RequestsHeaderField[]): RequestsHeaderField[] {
  return rows.length > 0 ? rows : [buildEmptyHeaderField()];
}

function ensureQueryRows(rows: RequestsQueryParam[]): RequestsQueryParam[] {
  return rows.length > 0 ? rows : [buildEmptyQueryParam()];
}

function buildEmptyDraft(folder: string | null): RequestsEditorDraft {
  return {
    body: { content: "", mode: "none" },
    credentialId: null,
    folder,
    headers: [buildEmptyHeaderField()],
    method: HttpMethod.GET,
    name: null,
    queryParams: [buildEmptyQueryParam()],
    url: "",
  };
}

function buildDraftFromItem(item: RequestsItemReadResponse): RequestsEditorDraft {
  return {
    body: item.body,
    credentialId: item.credentialId,
    folder: item.folder,
    headers: ensureHeaderRows(item.headers),
    method: item.method,
    name: item.name,
    queryParams: ensureQueryRows(item.queryParams),
    url: item.url,
  };
}

function flattenFolders(folders: RequestsFolderNode[]): RequestsFolderNode[] {
  const result: RequestsFolderNode[] = [];

  const visit = (nodes: RequestsFolderNode[]) => {
    for (const node of nodes) {
      result.push(node);
      if (node.children.length > 0) {
        visit(node.children);
      }
    }
  };

  visit(folders);
  return result;
}

function findFolder(nodes: RequestsFolderNode[], name: string | null): RequestsFolderNode | null {
  for (const node of nodes) {
    if (node.name === name) {
      return node;
    }
    const child = findFolder(node.children, name);
    if (child) {
      return child;
    }
  }

  return null;
}

function formatSize(sizeBytes: number): string {
  return `${sizeBytes} B`;
}

function formatBody(mode: RequestsRequestBody["mode"], content: string): string {
  if (mode !== "json") {
    return content;
  }

  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}

function renderResponseBody(bodyText: string): string {
  try {
    return JSON.stringify(JSON.parse(bodyText), null, 2);
  } catch {
    return bodyText;
  }
}

function buildStatusColor(statusCode: number | null): string {
  if (statusCode === null) {
    return "red";
  }
  if (statusCode >= 500) {
    return "red";
  }
  if (statusCode >= 400) {
    return "yellow";
  }
  if (statusCode >= 200) {
    return "green";
  }

  return "gray";
}

function buildRequestPayload(editor: RequestsEditorDraft) {
  return {
    body: {
      content: formatBody(editor.body.mode, editor.body.content),
      mode: editor.body.mode,
    },
    credentialId: editor.credentialId,
    folder: editor.folder ?? "",
    headers: editor.headers.filter((row) => row.name.trim().length > 0 || row.value.trim().length > 0),
    method: editor.method,
    name: editor.name ?? undefined,
    queryParams: editor.queryParams.filter((row) => row.name.trim().length > 0 || row.value.trim().length > 0),
    url: editor.url.trim(),
  };
}

async function invalidateRequestsQueries(queryClient: ReturnType<typeof useQueryClient>): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: [QueryKey.REQUESTS_COLLECTIONS] }),
    queryClient.invalidateQueries({ queryKey: [QueryKey.REQUESTS_ITEMS] }),
    queryClient.invalidateQueries({ queryKey: [QueryKey.REQUESTS_ITEM] }),
    queryClient.invalidateQueries({ queryKey: [QueryKey.REQUESTS_CREDENTIALS] }),
    queryClient.invalidateQueries({ queryKey: [QueryKey.REQUESTS_HISTORY] }),
  ]);
}

function KeyValueTable<T extends RequestsHeaderField | RequestsQueryParam>({
  addLabel,
  rows,
  title,
  onAdd,
  onChange,
  onRemove,
}: {
  addLabel: string;
  rows: T[];
  title: string;
  onAdd: () => void;
  onChange: (index: number, row: T) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Text fw={600}>{title}</Text>
        <Button leftSection={<IconPlus size={16} />} onClick={onAdd} size="xs" variant="light">
          {addLabel}
        </Button>
      </Group>
      <Table striped withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Enabled</Table.Th>
            <Table.Th>Name</Table.Th>
            <Table.Th>Value</Table.Th>
            <Table.Th></Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((row, index) => (
            <Table.Tr key={`${title}-${index}`}>
              <Table.Td>
                <Checkbox
                  checked={row.enabled}
                  onChange={(event) => onChange(index, { ...row, enabled: event.currentTarget.checked })}
                />
              </Table.Td>
              <Table.Td>
                <TextInput
                  aria-label={`${title} name ${index + 1}`}
                  onChange={(event) => onChange(index, { ...row, name: event.currentTarget.value })}
                  value={row.name}
                />
              </Table.Td>
              <Table.Td>
                <TextInput
                  aria-label={`${title} value ${index + 1}`}
                  onChange={(event) => onChange(index, { ...row, value: event.currentTarget.value })}
                  value={row.value}
                />
              </Table.Td>
              <Table.Td>
                <ActionIcon aria-label={`Remove ${title} ${index + 1}`} color="red" onClick={() => onRemove(index)} variant="light">
                  <IconTrash size={16} />
                </ActionIcon>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}

function FolderTree({
  expandedFolders,
  itemsByFolder,
  onSelectFolder,
  onSelectRequest,
  selectedFolder,
  selectedRequestName,
  toggleFolder,
  tree,
}: {
  expandedFolders: Set<string>;
  itemsByFolder: Map<string, FolderItemsState>;
  onSelectFolder: (folderName: string) => void;
  onSelectRequest: (folderName: string, requestName: string) => void;
  selectedFolder: string | null;
  selectedRequestName: string | null;
  toggleFolder: (folderName: string) => void;
  tree: RequestsFolderNode[];
}) {
  const renderNodes = (nodes: RequestsFolderNode[], depth = 0): JSX.Element[] =>
    nodes.flatMap((node) => {
      const folderItems = itemsByFolder.get(node.name);
      const isExpanded = expandedFolders.has(node.name);
      const requestRows = folderItems?.items ?? [];

      return [
        <Stack gap="xs" key={node.name}>
          <Group gap="xs" pl={depth * 16}>
            <ActionIcon
              aria-label={`${isExpanded ? "Collapse" : "Expand"} ${node.name}`}
              onClick={() => toggleFolder(node.name)}
              variant="subtle"
            >
              {isExpanded ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
            </ActionIcon>
            <UnstyledButton
              onClick={() => onSelectFolder(node.name)}
              style={{
                ...FOLDER_ROW_STYLE,
                backgroundColor: selectedFolder === node.name ? "rgba(34, 139, 230, 0.12)" : "transparent",
                color: selectedFolder === node.name ? "#4dabf7" : "inherit",
              }}
            >
              <Group gap="xs">
                <IconFolder size={16} />
                <Text>{node.name}</Text>
              </Group>
              <Badge size="sm" variant="light">
                {node.itemCount}
              </Badge>
            </UnstyledButton>
          </Group>
          <Collapse in={isExpanded}>
            <Stack gap="xs" pl={depth * 16 + 36}>
              {folderItems?.isLoading ? <Text c="dimmed" size="sm">Loading requests...</Text> : null}
              {folderItems?.isError ? (
                <RequestsErrorAlert
                  error={folderItems.error}
                  fallback="Unable to load saved requests for this folder."
                  onRetry={() => void folderItems.refetch()}
                  title="Request list failed"
                />
              ) : null}
              {requestRows.map((item) => (
                <UnstyledButton
                  key={`${node.name}-${item.name}`}
                  onClick={() => onSelectRequest(node.name, item.name)}
                  style={{
                    ...ITEM_ROW_STYLE,
                    backgroundColor:
                      selectedFolder === node.name && selectedRequestName === item.name
                        ? "rgba(34, 139, 230, 0.08)"
                        : "transparent",
                  }}
                >
                  <Stack gap={0}>
                    <Text fw={500}>{item.name}</Text>
                    <Text c="dimmed" size="xs">
                      {item.method} {item.url}
                    </Text>
                  </Stack>
                </UnstyledButton>
              ))}
              {node.children.length > 0 ? renderNodes(node.children, depth + 1) : null}
            </Stack>
          </Collapse>
        </Stack>,
      ];
    });

  return <Stack gap="xs">{renderNodes(tree)}</Stack>;
}

export function RequestsBuilderPanel() {
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((state) => state.currentUser);
  const canWrite = hasPermission(currentUser, REQUESTS_WRITE_PERMISSION);
  const { agentPort, companionUnavailable, preflightQuery, probedPorts, token } = useRequestsAgent();
  const [notice, setNotice] = useState<RequestsNotice | null>(null);
  const [folderModal, setFolderModal] = useState<FolderModalState>({ mode: "create", open: false });
  const [folderName, setFolderName] = useState("");
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [selectedRequestName, setSelectedRequestName] = useState<string | null>(null);
  const [isComposingNewRequest, setIsComposingNewRequest] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set());
  const [editor, setEditor] = useState<RequestsEditorDraft>(() => buildEmptyDraft(null));
  const [executeResponse, setExecuteResponse] = useState<RequestsExecuteResponse | null>(null);

  const collectionsQuery = useQuery({
    enabled: Boolean(token && agentPort !== null),
    queryFn: ({ signal }) => agentClient.listCollections(agentPort ?? 0, token ?? "", signal),
    queryKey: [QueryKey.REQUESTS_COLLECTIONS, token, agentPort],
    refetchOnWindowFocus: false,
    retry: false,
  });

  const credentialsQuery = useQuery({
    enabled: Boolean(token && agentPort !== null),
    queryFn: ({ signal }) => agentClient.listCredentials(agentPort ?? 0, token ?? "", signal),
    queryKey: [QueryKey.REQUESTS_CREDENTIALS, token, agentPort],
    refetchOnWindowFocus: false,
    retry: false,
  });

  const topLevelFolders = useMemo(() => collectionsQuery.data?.folders ?? [], [collectionsQuery.data?.folders]);
  const allFolders = useMemo(() => flattenFolders(topLevelFolders), [topLevelFolders]);

  const itemsQueries = useQueries({
    queries: allFolders.map((folder) => ({
      enabled: Boolean(token && agentPort !== null),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        agentClient.listRequestItems(agentPort ?? 0, token ?? "", folder.name, signal),
      queryKey: [QueryKey.REQUESTS_ITEMS, token, agentPort, folder.name],
      refetchOnWindowFocus: false,
      retry: false,
    })),
  });

  const itemsByFolder = useMemo(() => {
    return new Map<string, FolderItemsState>(
      allFolders.map((folder, index) => {
        const query = itemsQueries[index];
        return [
          folder.name,
          {
            error: query.error,
            isError: query.isError,
            isLoading: query.isLoading,
            items: query.data?.items ?? [],
            refetch: async () => query.refetch(),
          },
        ];
      })
    );
  }, [allFolders, itemsQueries]);

  const selectedFolderItemsState = selectedFolder ? itemsByFolder.get(selectedFolder) ?? null : null;

  const requestQuery = useQuery({
    enabled: Boolean(token && agentPort !== null && selectedFolder && selectedRequestName && !isComposingNewRequest),
    queryFn: ({ signal }) =>
      agentClient.readRequestItem(
        agentPort ?? 0,
        token ?? "",
        selectedFolder ?? "",
        selectedRequestName ?? "",
        signal
      ),
    queryKey: [QueryKey.REQUESTS_ITEM, token, agentPort, selectedFolder, selectedRequestName],
    refetchOnWindowFocus: false,
    retry: false,
  });

  useEffect(() => {
    if (allFolders.length === 0) {
      setSelectedFolder(null);
      setSelectedRequestName(null);
      setIsComposingNewRequest(false);
      setEditor(buildEmptyDraft(null));
      return;
    }

    if (!findFolder(topLevelFolders, selectedFolder)) {
      setSelectedFolder(allFolders[0]?.name ?? null);
    }
  }, [allFolders, selectedFolder, topLevelFolders]);

  useEffect(() => {
    if (!selectedFolder) {
      return;
    }

    setExpandedFolders((current) => {
      if (current.has(selectedFolder)) {
        return current;
      }

      const next = new Set(current);
      next.add(selectedFolder);
      return next;
    });
  }, [selectedFolder]);

  useEffect(() => {
    const validNames = new Set(allFolders.map((folder) => folder.name));
    setExpandedFolders((current) => {
      const next = new Set<string>();
      let changed = false;

      for (const folderName of current) {
        if (validNames.has(folderName)) {
          next.add(folderName);
        } else {
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [allFolders]);

  useEffect(() => {
    if (!selectedFolder || !selectedFolderItemsState || isComposingNewRequest) {
      return;
    }
    if (selectedFolderItemsState.isError || selectedFolderItemsState.isLoading) {
      return;
    }

    const items = selectedFolderItemsState.items;
    if (items.length === 0) {
      setSelectedRequestName(null);
      return;
    }

    if (!items.some((item) => item.name === selectedRequestName)) {
      setSelectedRequestName(items[0]?.name ?? null);
    }
  }, [isComposingNewRequest, selectedFolder, selectedFolderItemsState, selectedRequestName]);

  useEffect(() => {
    if (!requestQuery.data || isComposingNewRequest) {
      return;
    }

    const draft = getRequestsDraft({
      folder: requestQuery.data.folder,
      name: requestQuery.data.name,
      token,
    });
    setEditor(draft ?? buildDraftFromItem(requestQuery.data));
    setExecuteResponse(null);
  }, [isComposingNewRequest, requestQuery.data, token]);

  useEffect(() => {
    if (!isComposingNewRequest || !selectedFolder) {
      return;
    }

    const draft = getRequestsDraft({ folder: selectedFolder, name: null, token });
    setEditor(draft ?? buildEmptyDraft(selectedFolder));
    setExecuteResponse(null);
  }, [isComposingNewRequest, selectedFolder, token]);

  useEffect(() => {
    if (!selectedFolder) {
      return;
    }

    if (isComposingNewRequest) {
      setRequestsDraft({ folder: selectedFolder, name: null, token }, editor);
      return;
    }

    if (selectedRequestName && requestQuery.data) {
      setRequestsDraft({ folder: selectedFolder, name: selectedRequestName, token }, editor);
    }
  }, [editor, isComposingNewRequest, requestQuery.data, selectedFolder, selectedRequestName, token]);

  const saveFolderMutation = useMutation({
    mutationFn: async (payload: { mode: FolderModalState["mode"]; name: string }) => {
      if (!token || agentPort === null) {
        throw new Error("Authentication is required.");
      }

      if (payload.mode === "create") {
        return agentClient.createFolder(agentPort, token, { name: payload.name });
      }

      if (!selectedFolder) {
        throw new Error("Select a folder first.");
      }

      return agentClient.renameFolder(agentPort, token, { folder: selectedFolder, name: payload.name });
    },
    onError: (error) => {
      setNotice({
        message: getErrorMessage(error, "Unable to save the folder."),
        status: "error",
      });
    },
    onSuccess: async (_response, payload) => {
      if (payload.mode === "rename" && selectedFolder) {
        renameRequestsDraftFolder(token, selectedFolder, payload.name);
        if (selectedRequestName) {
          clearRequestsDraft({ folder: selectedFolder, name: selectedRequestName, token });
        }
      }

      setFolderModal({ mode: "create", open: false });
      setFolderName("");
      setSelectedFolder(payload.name);
      await invalidateRequestsQueries(queryClient);
    },
  });

  const deleteFolderMutation = useMutation({
    mutationFn: async () => {
      if (!token || agentPort === null || !selectedFolder) {
        throw new Error("Select a folder first.");
      }

      return agentClient.deleteFolder(agentPort, token, selectedFolder);
    },
    onError: (error) => {
      setNotice({ message: getErrorMessage(error, "Unable to delete the folder."), status: "error" });
    },
    onSuccess: async () => {
      if (selectedFolder) {
        clearRequestsDraftsForFolder(token, selectedFolder);
      }
      setSelectedRequestName(null);
      setIsComposingNewRequest(false);
      await invalidateRequestsQueries(queryClient);
    },
  });

  const reorderFoldersMutation = useMutation({
    mutationFn: async (folders: string[]) => {
      if (!token || agentPort === null) {
        throw new Error("Authentication is required.");
      }

      return agentClient.reorderCollections(agentPort, token, folders);
    },
    onError: (error) => {
      setNotice({
        message: getErrorMessage(error, "Unable to reorder folders."),
        status: "error",
      });
    },
    onSuccess: async () => {
      await invalidateRequestsQueries(queryClient);
    },
  });

  const saveRequestMutation = useMutation({
    mutationFn: async () => {
      if (!token || agentPort === null || !editor.folder) {
        throw new Error("Select a folder first.");
      }
      if (editor.url.trim().length === 0) {
        throw new Error("URL is required.");
      }

      const payload = buildRequestPayload(editor);
      if (isComposingNewRequest || !selectedRequestName || !selectedFolder) {
        return agentClient.createRequestItem(agentPort, token, payload);
      }

      return agentClient.updateRequestItem(agentPort, token, selectedFolder, selectedRequestName, {
        body: payload.body,
        credentialId: payload.credentialId,
        folder: payload.folder,
        headers: payload.headers,
        method: payload.method,
        queryParams: payload.queryParams,
        url: payload.url,
      });
    },
    onError: (error) => {
      setNotice({ message: getErrorMessage(error, "Unable to save the request."), status: "error" });
    },
    onSuccess: async (response) => {
      clearRequestsDraft({ folder: selectedFolder, name: selectedRequestName, token });
      clearRequestsDraft({ folder: response.folder, name: response.name, token });
      clearRequestsDraft({ folder: response.folder, name: null, token });
      setSelectedFolder(response.folder);
      setSelectedRequestName(response.name);
      setIsComposingNewRequest(false);
      setEditor(buildDraftFromItem(response));
      await invalidateRequestsQueries(queryClient);
    },
  });

  const deleteRequestMutation = useMutation({
    mutationFn: async () => {
      if (!token || agentPort === null || !selectedFolder || !selectedRequestName) {
        throw new Error("Select a request first.");
      }

      return agentClient.deleteRequestItem(agentPort, token, selectedFolder, selectedRequestName);
    },
    onError: (error) => {
      setNotice({ message: getErrorMessage(error, "Unable to delete the request."), status: "error" });
    },
    onSuccess: async () => {
      clearRequestsDraft({ folder: selectedFolder, name: selectedRequestName, token });
      setSelectedRequestName(null);
      setIsComposingNewRequest(false);
      await invalidateRequestsQueries(queryClient);
    },
  });

  const executeMutation = useMutation({
    mutationFn: async () => {
      if (!token || agentPort === null) {
        throw new Error("Authentication is required.");
      }
      if (editor.url.trim().length === 0) {
        throw new Error("URL is required.");
      }

      const payload = buildRequestPayload(editor);
      return agentClient.executeRequest(agentPort, token, {
        body: payload.body,
        credentialId: payload.credentialId,
        headers: payload.headers,
        method: payload.method,
        queryParams: payload.queryParams,
        url: payload.url,
      });
    },
    onError: (error) => {
      setNotice({ message: getErrorMessage(error, "Unable to execute the request."), status: "error" });
    },
    onSuccess: async (response) => {
      setExecuteResponse(response);
      await queryClient.invalidateQueries({ queryKey: [QueryKey.REQUESTS_HISTORY] });
    },
  });

  if (preflightQuery.isLoading) {
    return <RequestsLoadingState message="Checking the local companion app before loading Requests." />;
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

  if (collectionsQuery.isLoading) {
    return <RequestsLoadingState message="Loading request collections from the companion app." />;
  }

  if (collectionsQuery.isError) {
    return (
      <RequestsErrorAlert
        error={collectionsQuery.error}
        fallback="Unable to load request collections."
        onRetry={() => void collectionsQuery.refetch()}
        title="Collections failed"
      />
    );
  }

  const selectedTopLevelIndex = topLevelFolders.findIndex((folder) => folder.name === selectedFolder);
  const credentialOptions = (credentialsQuery.data?.credentials ?? []).map((credential) => ({
    label: `${credential.name} (${credential.type})`,
    value: credential.id,
  }));

  return (
    <Stack gap="md">
      <RequestsNoticeAlert notice={notice} />
      {!canWrite ? <Text c="dimmed" size="sm">Read-only access. Editing and execution controls are hidden.</Text> : null}
      <Grid align="stretch">
        <Grid.Col span={{ base: 12, md: 4 }}>
          <RequestsSurface
            description="Saved collections are loaded from the local companion app on this machine."
            title="Collections"
          >
            {canWrite ? (
              <Group wrap="wrap">
                <Button leftSection={<IconPlus size={16} />} onClick={() => { setFolderModal({ mode: "create", open: true }); setFolderName(""); }} size="xs" variant="light">
                  Create folder
                </Button>
                <Button
                  disabled={!selectedFolder}
                  onClick={() => { setFolderModal({ mode: "rename", open: true }); setFolderName(selectedFolder ?? ""); }}
                  size="xs"
                  variant="light"
                >
                  Rename folder
                </Button>
                <Button
                  color="red"
                  disabled={!selectedFolder}
                  loading={deleteFolderMutation.isPending}
                  onClick={() => {
                    if (selectedFolder && window.confirm(`Delete folder ${selectedFolder}?`)) {
                      void deleteFolderMutation.mutateAsync();
                    }
                  }}
                  size="xs"
                  variant="light"
                >
                  Delete folder
                </Button>
                <Button
                  disabled={selectedTopLevelIndex <= 0}
                  onClick={() => {
                    if (selectedTopLevelIndex < 1) {
                      return;
                    }
                    const next = [...topLevelFolders.map((folder) => folder.name)];
                    const [moved] = next.splice(selectedTopLevelIndex, 1);
                    next.splice(selectedTopLevelIndex - 1, 0, moved);
                    void reorderFoldersMutation.mutateAsync(next);
                  }}
                  size="xs"
                  variant="default"
                >
                  Move up
                </Button>
                <Button
                  disabled={selectedTopLevelIndex < 0 || selectedTopLevelIndex >= topLevelFolders.length - 1}
                  onClick={() => {
                    if (selectedTopLevelIndex < 0 || selectedTopLevelIndex >= topLevelFolders.length - 1) {
                      return;
                    }
                    const next = [...topLevelFolders.map((folder) => folder.name)];
                    const [moved] = next.splice(selectedTopLevelIndex, 1);
                    next.splice(selectedTopLevelIndex + 1, 0, moved);
                    void reorderFoldersMutation.mutateAsync(next);
                  }}
                  size="xs"
                  variant="default"
                >
                  Move down
                </Button>
                <Button
                  disabled={!selectedFolder}
                  leftSection={<IconPlus size={16} />}
                  onClick={() => {
                    setIsComposingNewRequest(true);
                    setSelectedRequestName(null);
                    setEditor(buildEmptyDraft(selectedFolder));
                  }}
                  size="xs"
                >
                  New request
                </Button>
              </Group>
            ) : null}
            {topLevelFolders.length === 0 ? (
              <RequestsEmptyCard body="No folders exist yet." title="Collections" />
            ) : (
              <FolderTree
                expandedFolders={expandedFolders}
                itemsByFolder={itemsByFolder}
                onSelectFolder={(folderName) => {
                  setSelectedFolder(folderName);
                  setIsComposingNewRequest(false);
                }}
                onSelectRequest={(folderName, requestName) => {
                  setSelectedFolder(folderName);
                  setSelectedRequestName(requestName);
                  setIsComposingNewRequest(false);
                }}
                selectedFolder={selectedFolder}
                selectedRequestName={selectedRequestName}
                toggleFolder={(folderName) => {
                  setExpandedFolders((current) => {
                    const next = new Set(current);
                    if (next.has(folderName)) {
                      next.delete(folderName);
                    } else {
                      next.add(folderName);
                    }
                    return next;
                  });
                }}
                tree={topLevelFolders}
              />
            )}
          </RequestsSurface>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 8 }}>
          <Stack gap="md">
            <RequestsNoticeAlert notice={notice} />
            {requestQuery.isError && !isComposingNewRequest ? (
              <RequestsErrorAlert
                error={requestQuery.error}
                fallback="Unable to load the selected request."
                onRetry={() => void requestQuery.refetch()}
                title="Request load failed"
              />
            ) : null}
            {!selectedFolder ? (
              <RequestsEmptyCard body="Select a folder to edit or execute a request." title="Request builder" />
            ) : (
              <RequestsSurface
                description={selectedRequestName && !isComposingNewRequest ? `Saved request: ${selectedRequestName}` : `Folder: ${selectedFolder}`}
                title="Request builder"
              >
                {requestQuery.isLoading && !isComposingNewRequest ? (
                  <RequestsLoadingState message="Loading the selected request from the companion app." />
                ) : (
                  <Stack gap="md">
                    <Group align="flex-end" grow>
                      <TextInput
                        description={isComposingNewRequest ? "Leave empty to auto-name the saved request." : "Saved request names are fixed."}
                        disabled={!isComposingNewRequest}
                        label="Name"
                        onChange={(event) => setEditor((current) => ({ ...current, name: event.currentTarget.value }))}
                        value={editor.name ?? ""}
                      />
                      <Select
                        data={HTTP_METHOD_OPTIONS}
                        label="Method"
                        onChange={(value) => setEditor((current) => ({ ...current, method: (value ?? HttpMethod.GET) as RequestsMethod }))}
                        value={editor.method}
                      />
                      <Select
                        data={allFolders.map((folder) => ({ label: folder.name, value: folder.name }))}
                        label="Folder"
                        onChange={(value) => setEditor((current) => ({ ...current, folder: value }))}
                        value={editor.folder}
                      />
                    </Group>
                    <Group align="flex-end" grow>
                      <TextInput
                        aria-label="Request URL"
                        label="URL"
                        onChange={(event) => setEditor((current) => ({ ...current, url: event.currentTarget.value }))}
                        placeholder="https://service.example/api"
                        value={editor.url}
                      />
                      {canWrite ? (
                        <Button
                          leftSection={<IconSend size={16} />}
                          loading={executeMutation.isPending}
                          onClick={() => void executeMutation.mutateAsync()}
                        >
                          Send
                        </Button>
                      ) : null}
                    </Group>
                    <SegmentedControl
                      data={[
                        { label: "Headers", value: "headers" },
                        { label: "Params", value: "params" },
                        { label: "Body", value: "body" },
                        { label: "Auth", value: "auth" },
                      ]}
                      fullWidth
                      onChange={() => undefined}
                      value="headers"
                    />
                    <KeyValueTable
                      addLabel="Add header"
                      onAdd={() => setEditor((current) => ({ ...current, headers: [...current.headers, buildEmptyHeaderField()] }))}
                      onChange={(index, row) => {
                        setEditor((current) => ({
                          ...current,
                          headers: current.headers.map((item, itemIndex) => (itemIndex === index ? row : item)),
                        }));
                      }}
                      onRemove={(index) => {
                        setEditor((current) => ({
                          ...current,
                          headers: ensureHeaderRows(current.headers.filter((_, itemIndex) => itemIndex !== index)),
                        }));
                      }}
                      rows={editor.headers}
                      title="Headers"
                    />
                    <KeyValueTable
                      addLabel="Add param"
                      onAdd={() => setEditor((current) => ({ ...current, queryParams: [...current.queryParams, buildEmptyQueryParam()] }))}
                      onChange={(index, row) => {
                        setEditor((current) => ({
                          ...current,
                          queryParams: current.queryParams.map((item, itemIndex) => (itemIndex === index ? row : item)),
                        }));
                      }}
                      onRemove={(index) => {
                        setEditor((current) => ({
                          ...current,
                          queryParams: ensureQueryRows(current.queryParams.filter((_, itemIndex) => itemIndex !== index)),
                        }));
                      }}
                      rows={editor.queryParams}
                      title="Params"
                    />
                    <Stack gap="sm">
                      <Text fw={600}>Body</Text>
                      <SegmentedControl
                        data={BODY_MODE_OPTIONS}
                        onChange={(value) =>
                          setEditor((current) => ({
                            ...current,
                            body: { ...current.body, mode: value as RequestsRequestBody["mode"] },
                          }))
                        }
                        value={editor.body.mode}
                      />
                      {editor.body.mode !== "none" ? (
                        <Textarea
                          aria-label="Request body"
                          autosize
                          minRows={8}
                          onChange={(event) =>
                            setEditor((current) => ({
                              ...current,
                              body: { ...current.body, content: event.currentTarget.value },
                            }))
                          }
                          value={editor.body.content}
                        />
                      ) : null}
                    </Stack>
                    <Stack gap="sm">
                      <Text fw={600}>Auth</Text>
                      <Select
                        clearable
                        data={credentialOptions}
                        description="Manual enabled Authorization headers override the selected credential."
                        label="Credential"
                        onChange={(value) => setEditor((current) => ({ ...current, credentialId: value }))}
                        placeholder="No credential"
                        value={editor.credentialId}
                      />
                    </Stack>
                    {canWrite ? (
                      <Group justify="space-between" wrap="wrap">
                        <Group gap="sm">
                          <Button
                            leftSection={<IconDeviceFloppy size={16} />}
                            loading={saveRequestMutation.isPending}
                            onClick={() => void saveRequestMutation.mutateAsync()}
                          >
                            Save request
                          </Button>
                          <Button
                            color="red"
                            disabled={!selectedRequestName || isComposingNewRequest}
                            loading={deleteRequestMutation.isPending}
                            onClick={() => {
                              if (selectedRequestName && window.confirm(`Delete request ${selectedRequestName}?`)) {
                                void deleteRequestMutation.mutateAsync();
                              }
                            }}
                            variant="light"
                          >
                            Delete request
                          </Button>
                        </Group>
                        {requestQuery.data ? (
                          <Text c="dimmed" size="sm">
                            Updated {requestQuery.data.updatedAt}
                          </Text>
                        ) : null}
                      </Group>
                    ) : null}
                  </Stack>
                )}
              </RequestsSurface>
            )}
            <RequestsSurface
              description="Execution uses the current editor state, even if it has not been saved yet."
              title="Response"
            >
              {!executeResponse ? (
                <RequestsEmptyCard body="Send a request to inspect the response and the stored redacted summary." title="Response" />
              ) : (
                <Stack gap="md">
                  <Group align="center" justify="space-between" wrap="wrap">
                    <Badge color={buildStatusColor(executeResponse.statusCode)} size="lg">
                      {executeResponse.statusCode === null
                        ? "Error"
                        : `${executeResponse.statusCode}${executeResponse.reasonPhrase ? ` ${executeResponse.reasonPhrase}` : ""}`}
                    </Badge>
                    <Group gap="sm">
                      <Text size="sm">{executeResponse.elapsedMs ?? 0} ms</Text>
                      <Text size="sm">{formatSize(executeResponse.sizeBytes)}</Text>
                      {executeResponse.truncated ? <Badge color="yellow">Truncated</Badge> : null}
                    </Group>
                  </Group>
                  {executeResponse.statusCode === null && executeResponse.error ? (
                    <Text c="red">{executeResponse.error}</Text>
                  ) : null}
                  <Stack gap="xs">
                    <Text fw={600}>Response headers</Text>
                    <Table withTableBorder>
                      <Table.Tbody>
                        {executeResponse.headers.map((header) => (
                          <Table.Tr key={`${header.name}-${header.value}`}>
                            <Table.Td>{header.name}</Table.Td>
                            <Table.Td>{header.value}</Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </Stack>
                  <Stack gap="xs">
                    <Text fw={600}>Response body</Text>
                    <Textarea autosize minRows={8} readOnly value={renderResponseBody(executeResponse.bodyText)} />
                  </Stack>
                  <Stack gap="xs">
                    <Text fw={600}>Redacted request summary</Text>
                    <Text size="sm">
                      {executeResponse.requestSummary.method} {executeResponse.requestSummary.url}
                    </Text>
                    <Table withTableBorder>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>Header</Table.Th>
                          <Table.Th>Value</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {executeResponse.requestSummary.headers.map((header) => (
                          <Table.Tr key={`${header.name}-${header.value}`}>
                            <Table.Td>{header.name}</Table.Td>
                            <Table.Td>{header.value}</Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </Stack>
                </Stack>
              )}
            </RequestsSurface>
          </Stack>
        </Grid.Col>
      </Grid>
      <Modal
        onClose={() => { setFolderModal({ mode: "create", open: false }); setFolderName(""); }}
        opened={folderModal.open}
        title={folderModal.mode === "create" ? "Create folder" : "Rename folder"}
      >
        <Stack>
          <TextInput
            label="Folder name"
            onChange={(event) => setFolderName(event.currentTarget.value)}
            value={folderName}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => { setFolderModal({ mode: "create", open: false }); setFolderName(""); }}>
              Cancel
            </Button>
            <Button
              disabled={folderName.trim().length === 0}
              loading={saveFolderMutation.isPending}
              onClick={() => void saveFolderMutation.mutateAsync({ mode: folderModal.mode, name: folderName.trim() })}
            >
              Save
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

