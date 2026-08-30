import { type CSSProperties, type DragEvent, type KeyboardEvent, useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Checkbox,
  Collapse,
  Grid,
  Group,
  Loader,
  Modal,
  Select,
  SegmentedControl,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconChevronDown,
  IconChevronRight,
  IconCopy,
  IconDeviceFloppy,
  IconDownload,
  IconFolder,
  IconPencil,
  IconPlus,
  IconSend,
  IconTerminal2,
  IconTrash,
} from "@tabler/icons-react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";

import { usePalette } from "@/app/theme/usePalette";
import type { Palette } from "@/app/theme/tokens";
import { AgentRequestError, agentClient } from "@/api/agentClient";
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
import { buildCurl, parseCurl } from "@/plugins/requests/requestsCurl";
import { IAM_ENVIRONMENT_SEED, IAM_SEED } from "@/plugins/requests/requestsSeeds";
import { getErrorMessage, type RequestsNotice, useRequestsAgent } from "@/plugins/requests/requestsShared";
import { buildVariableMap, resolveRequestDocument } from "@/plugins/requests/requestsVariables";
import { useAuthStore } from "@/store/authStore";

const REQUESTS_WRITE_PERMISSION = "requests.write";
const NO_ENVIRONMENT_VALUE = "__none__";
const STAGING_ENVIRONMENT_NAME = "staging";

function buildFolderRowStyle(active: boolean, palette: Palette): CSSProperties {
  return {
    alignItems: "center",
    backgroundColor: active ? palette.chip : "transparent",
    border: "1px solid transparent",
    borderRadius: "10px",
    color: active ? palette.accent : palette.inkSoft,
    display: "flex",
    gap: "8px",
    justifyContent: "flex-start",
    minWidth: 0,
    padding: "8px 12px",
    transition: "background-color 150ms ease, color 150ms ease",
    width: "100%",
  };
}

function buildRequestRowStyle(active: boolean, palette: Palette): CSSProperties {
  return {
    alignItems: "center",
    backgroundColor: active ? palette.accentSoft : "transparent",
    border: "1px solid transparent",
    borderRadius: "8px",
    color: active ? palette.accent : palette.inkSoft,
    display: "flex",
    justifyContent: "space-between",
    minWidth: 0,
    padding: "6px 10px",
    transition: "background-color 150ms ease, color 150ms ease",
    width: "100%",
  };
}

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

type CurlImportModalState = {
  open: boolean;
  value: string;
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

function isConflictError(error: unknown): boolean {
  return error instanceof AgentRequestError && error.status === 409;
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
            <Table.Th style={{ width: 64 }}>Enabled</Table.Th>
            <Table.Th style={{ width: "28%" }}>Name</Table.Th>
            <Table.Th>Value</Table.Th>
            <Table.Th style={{ width: 44 }}></Table.Th>
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
                  disabled={!row.enabled}
                  onChange={(event) => onChange(index, { ...row, name: event.currentTarget.value })}
                  value={row.name}
                />
              </Table.Td>
              <Table.Td>
                <TextInput
                  aria-label={`${title} value ${index + 1}`}
                  disabled={!row.enabled}
                  onChange={(event) => onChange(index, { ...row, value: event.currentTarget.value })}
                  value={row.value}
                />
              </Table.Td>
              <Table.Td>
                <ActionIcon
                  aria-label={`Remove ${title} ${index + 1}`}
                  color="red"
                  disabled={!row.enabled}
                  onClick={() => onRemove(index)}
                  variant="light"
                >
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

function UrlVariablePreview({ url, vars }: { url: string; vars: Record<string, string> }) {
  const resolved = useMemo(
    () => url.replace(/{{\s*([^{}]+?)\s*}}/g, (match, rawKey: string) => {
      const key = rawKey.trim();
      return Object.prototype.hasOwnProperty.call(vars, key) ? (vars[key] ?? "") : match;
    }),
    [url, vars]
  );

  if (resolved === url) return null;

  return (
    <Text c="dimmed" ff="monospace" size="xs" truncate>
      {resolved}
    </Text>
  );
}

function FolderTree({
  expandedFolders,
  itemsByFolder,
  onReorderFolders,
  onSelectFolder,
  onSelectRequest,
  reorderDisabled,
  selectedFolder,
  selectedRequestName,
  toggleFolder,
  tree,
}: {
  expandedFolders: Set<string>;
  itemsByFolder: Map<string, FolderItemsState>;
  onReorderFolders: (folders: string[]) => void;
  onSelectFolder: (folderName: string) => void;
  onSelectRequest: (folderName: string, requestName: string) => void;
  reorderDisabled: boolean;
  selectedFolder: string | null;
  selectedRequestName: string | null;
  toggleFolder: (folderName: string) => void;
  tree: RequestsFolderNode[];
}) {
  const palette = usePalette();
  const [draggedFolderName, setDraggedFolderName] = useState<string | null>(null);
  const [folderDropIndex, setFolderDropIndex] = useState<number | null>(null);

  function handleFolderRowClick(folderName: string): void {
    onSelectFolder(folderName);
  }

  function handleFolderRowKeyDown(event: KeyboardEvent<HTMLDivElement>, folderName: string): void {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    handleFolderRowClick(folderName);
  }

  function handleFolderDragStart(event: DragEvent<HTMLElement>, folderName: string): void {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-requests-folder-reorder", folderName);
    setDraggedFolderName(folderName);
    setFolderDropIndex(null);
  }

  function handleFolderDragEnd(): void {
    setDraggedFolderName(null);
    setFolderDropIndex(null);
  }

  function handleFolderDragOver(event: DragEvent<HTMLElement>, folderIndex: number): void {
    if (draggedFolderName === null || reorderDisabled) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const dropIndex = event.clientY <= rect.top + rect.height / 2 ? folderIndex : folderIndex + 1;

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (folderDropIndex !== dropIndex) {
      setFolderDropIndex(dropIndex);
    }
  }

  function handleFolderDrop(event: DragEvent<HTMLElement>): void {
    event.preventDefault();

    if (draggedFolderName === null || folderDropIndex === null || reorderDisabled) {
      setDraggedFolderName(null);
      setFolderDropIndex(null);
      return;
    }

    const currentIndex = tree.findIndex((folder) => folder.name === draggedFolderName);
    if (currentIndex < 0) {
      setDraggedFolderName(null);
      setFolderDropIndex(null);
      return;
    }

    const reordered = [...tree];
    const [draggedFolder] = reordered.splice(currentIndex, 1);
    const insertIndex = currentIndex < folderDropIndex ? folderDropIndex - 1 : folderDropIndex;
    reordered.splice(insertIndex, 0, draggedFolder);

    const newOrder = reordered.map((folder) => folder.name);
    const currentOrder = tree.map((folder) => folder.name);
    if (newOrder.every((name, index) => name === currentOrder[index])) {
      setDraggedFolderName(null);
      setFolderDropIndex(null);
      return;
    }

    onReorderFolders(newOrder);
    setDraggedFolderName(null);
    setFolderDropIndex(null);
  }

  function renderFolderNode(node: RequestsFolderNode, depth: number, rootIndex?: number): JSX.Element {
    const folderItems = itemsByFolder.get(node.name);
    const isExpanded = expandedFolders.has(node.name);
    const requestRows = folderItems?.items ?? [];
    const isActiveFolder = selectedFolder === node.name;
    const isTopLevel = depth === 0;
    const folderDraggable = isTopLevel && tree.length > 1 && !reorderDisabled;

    return (
      <Box key={node.name}>
        <Box
          aria-current={isActiveFolder ? "page" : undefined}
          aria-label={node.name}
          draggable={folderDraggable}
          onClick={() => handleFolderRowClick(node.name)}
          onDragEnd={folderDraggable ? handleFolderDragEnd : undefined}
          onDragOver={folderDraggable ? (event) => handleFolderDragOver(event, rootIndex ?? -1) : undefined}
          onDragStart={folderDraggable ? (event) => handleFolderDragStart(event, node.name) : undefined}
          onDrop={folderDraggable ? handleFolderDrop : undefined}
          onKeyDown={(event) => handleFolderRowKeyDown(event, node.name)}
          role="button"
          style={{
            ...buildFolderRowStyle(isActiveFolder, palette),
            cursor: folderDraggable ? "grab" : "pointer",
            marginLeft: depth * 16,
          }}
          tabIndex={0}
        >
          <ActionIcon
            aria-label={isExpanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
            onClick={(event) => {
              event.stopPropagation();
              toggleFolder(node.name);
            }}
            size="md"
            variant="subtle"
          >
            {isExpanded ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
          </ActionIcon>
          <Group gap={8} style={{ flex: 1, minWidth: 0 }} wrap="nowrap">
            <IconFolder size={16} style={{ flexShrink: 0 }} />
            <Text c="inherit" fw={isActiveFolder ? 600 : 500} truncate>
              {node.name}
            </Text>
            <Text c="inherit" ml="auto" size="sm">
              {node.itemCount}
            </Text>
          </Group>
        </Box>

        <Collapse in={isExpanded}>
          <Box ml="md" mt="xs" pl="md" style={{ borderLeft: `1px solid ${palette.line}` }}>
            <Stack gap={6}>
              {folderItems?.isLoading ? (
                <Group c="dimmed" gap="xs" wrap="nowrap">
                  <Loader size="xs" />
                  <Text size="sm">Loading requests...</Text>
                </Group>
              ) : null}
              {folderItems?.isError ? (
                <RequestsErrorAlert
                  error={folderItems.error}
                  fallback="Unable to load saved requests for this folder."
                  onRetry={() => void folderItems.refetch()}
                  title="Request list failed"
                />
              ) : null}
              {requestRows.map((item) => {
                const isSelected = selectedFolder === node.name && selectedRequestName === item.name;

                return (
                  <Tooltip key={`${node.name}-${item.name}`} label={`${item.method} ${item.url}`} multiline>
                    <UnstyledButton
                      aria-current={isSelected ? "page" : undefined}
                      aria-label={item.name}
                      onClick={() => onSelectRequest(node.name, item.name)}
                      style={buildRequestRowStyle(isSelected, palette)}
                    >
                      <Group gap="xs" style={{ flex: 1, minWidth: 0 }} wrap="nowrap">
                        <Box
                          aria-hidden="true"
                          h={6}
                          style={{
                            backgroundColor: isSelected ? palette.accent : palette.faint,
                            borderRadius: "999px",
                            flexShrink: 0,
                          }}
                          w={6}
                        />
                        <Text c="inherit" fw={isSelected ? 600 : 500} size="sm" truncate>
                          {item.name}
                        </Text>
                        <Text c={isSelected ? palette.accent : palette.faint} size="xs" truncate>
                          {item.url}
                        </Text>
                      </Group>
                      <Text c={isSelected ? palette.accent : palette.faint} size="xs">
                        {item.method}
                      </Text>
                    </UnstyledButton>
                  </Tooltip>
                );
              })}
              {node.children.map((child) => renderFolderNode(child, depth + 1))}
            </Stack>
          </Box>
        </Collapse>
      </Box>
    );
  }

  return (
    <Stack gap="xs">
      {tree.map((node, index) => (
        <Box key={node.name}>
          {folderDropIndex === index && draggedFolderName !== null ? (
            <Box
              aria-hidden="true"
              mb={6}
              style={{
                backgroundColor: "var(--mantine-color-blue-5)",
                borderRadius: "1px",
                height: "2px",
              }}
            />
          ) : null}
          {renderFolderNode(node, 0, index)}
        </Box>
      ))}
      {folderDropIndex === tree.length && draggedFolderName !== null ? (
        <Box
          aria-hidden="true"
          style={{
            backgroundColor: "var(--mantine-color-blue-5)",
            borderRadius: "1px",
            height: "2px",
          }}
        />
      ) : null}
    </Stack>
  );
}

export function RequestsBuilderPanel() {
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((state) => state.currentUser);
  const canWrite = hasPermission(currentUser, REQUESTS_WRITE_PERMISSION);
  const { agentPort, companionUnavailable, preflightQuery, probedPorts, token } = useRequestsAgent();
  const [notice, setNotice] = useState<RequestsNotice | null>(null);
  const [folderModal, setFolderModal] = useState<FolderModalState>({ mode: "create", open: false });
  const [folderName, setFolderName] = useState("");
  const [curlImportModal, setCurlImportModal] = useState<CurlImportModalState>({ open: false, value: "" });
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

  const environmentsQuery = useQuery({
    enabled: Boolean(token && agentPort !== null),
    queryFn: ({ signal }) => agentClient.listEnvironments(agentPort ?? 0, token ?? "", signal),
    queryKey: [QueryKey.REQUESTS_ENVIRONMENTS, token, agentPort],
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
  const activeEnvironment = useMemo(() => {
    if (!environmentsQuery.data?.activeId) {
      return null;
    }
    return (
      environmentsQuery.data.environments.find(
        (environment) => environment.id === environmentsQuery.data?.activeId
      ) ?? null
    );
  }, [environmentsQuery.data]);
  const environmentVariables = useMemo(
    () => buildVariableMap(activeEnvironment),
    [activeEnvironment]
  );
  const resolvedEditor = useMemo(
    () => resolveRequestDocument(editor, environmentVariables),
    [editor, environmentVariables]
  );

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

      const payload = buildRequestPayload(resolvedEditor.document);
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

  const setActiveEnvironmentMutation = useMutation({
    mutationFn: async (environmentId: string | null) => {
      if (!token || agentPort === null) {
        throw new Error("Authentication is required.");
      }

      return agentClient.setActiveEnvironment(agentPort, token, environmentId);
    },
    onError: (error) => {
      setNotice({
        message: getErrorMessage(error, "Unable to change the active environment."),
        status: "error",
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [QueryKey.REQUESTS_ENVIRONMENTS] });
    },
  });

  const importPresetMutation = useMutation({
    mutationFn: async () => {
      if (!token || agentPort === null) {
        throw new Error("Authentication is required.");
      }

      let importedRequests = 0;
      let skipped = 0;
      let createdEnvironments = 0;

      for (const folder of IAM_SEED) {
        try {
          await agentClient.createFolder(agentPort, token, { name: folder.name });
        } catch (error) {
          if (isConflictError(error)) {
            skipped += 1;
          } else {
            throw error;
          }
        }

        for (const request of folder.requests) {
          try {
            await agentClient.createRequestItem(agentPort, token, {
              body: request.body,
              credentialId: null,
              folder: folder.name,
              headers: request.headers,
              method: request.method,
              name: request.name,
              queryParams: request.queryParams,
              url: request.url,
            });
            importedRequests += 1;
          } catch (error) {
            if (isConflictError(error)) {
              skipped += 1;
            } else {
              throw error;
            }
          }
        }
      }

      let environmentsState = await agentClient.listEnvironments(agentPort, token);
      const existingEnvironmentNames = new Set(
        environmentsState.environments.map((environment) => environment.name)
      );

      for (const environment of IAM_ENVIRONMENT_SEED) {
        if (existingEnvironmentNames.has(environment.name)) {
          skipped += 1;
          continue;
        }

        environmentsState = await agentClient.createEnvironment(agentPort, token, {
          name: environment.name,
          variables: environment.variables,
        });
        createdEnvironments += 1;
        existingEnvironmentNames.add(environment.name);
      }

      if (!environmentsState.activeId) {
        const stagingEnvironment = environmentsState.environments.find(
          (environment) => environment.name === STAGING_ENVIRONMENT_NAME
        );
        if (stagingEnvironment) {
          environmentsState = await agentClient.setActiveEnvironment(
            agentPort,
            token,
            stagingEnvironment.id
          );
        }
      }

      return { createdEnvironments, importedRequests, skipped };
    },
    onError: (error) => {
      setNotice({ message: getErrorMessage(error, "Unable to import the IAM preset."), status: "error" });
    },
    onSuccess: async ({ createdEnvironments, importedRequests, skipped }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [QueryKey.REQUESTS_COLLECTIONS] }),
        queryClient.invalidateQueries({ queryKey: [QueryKey.REQUESTS_ITEMS] }),
        queryClient.invalidateQueries({ queryKey: [QueryKey.REQUESTS_ENVIRONMENTS] }),
      ]);
      notifications.show({
        color: "green",
        message: `Imported ${importedRequests} requests in ${IAM_SEED.length} folders, created ${createdEnvironments} environments, skipped ${skipped} existing`,
        title: "IAM preset imported",
      });
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

  const credentialOptions = (credentialsQuery.data?.credentials ?? []).map((credential) => ({
    label: `${credential.name} (${credential.type})`,
    value: credential.id,
  }));
  const environmentOptions = [
    { label: "No environment", value: NO_ENVIRONMENT_VALUE },
    ...((environmentsQuery.data?.environments ?? []).map((environment) => ({
      label: environment.name,
      value: environment.id,
    }))),
  ];

  const selectedCredentialName =
    editor.credentialId
      ? (credentialsQuery.data?.credentials.find((credential) => credential.id === editor.credentialId)?.name ??
          editor.credentialId)
      : null;
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
              <Stack gap="xs">
                <Group gap={4} wrap="wrap">
                  <Tooltip label="Create folder">
                    <Box component="span">
                      <ActionIcon
                        aria-label="Create folder"
                        onClick={() => {
                          setFolderModal({ mode: "create", open: true });
                          setFolderName("");
                        }}
                        radius="md"
                        size="lg"
                        variant="light"
                      >
                        <IconPlus size={18} />
                      </ActionIcon>
                    </Box>
                  </Tooltip>
                  <Tooltip label="Import IAM preset">
                    <Box component="span">
                      <ActionIcon
                        aria-label="Import IAM preset"
                        loading={importPresetMutation.isPending}
                        onClick={() => void importPresetMutation.mutateAsync()}
                        radius="md"
                        size="lg"
                        variant="light"
                      >
                        <IconDownload size={18} />
                      </ActionIcon>
                    </Box>
                  </Tooltip>
                  <Tooltip label="Rename folder">
                    <Box component="span">
                      <ActionIcon
                        aria-label="Rename folder"
                        disabled={!selectedFolder}
                        onClick={() => {
                          setFolderModal({ mode: "rename", open: true });
                          setFolderName(selectedFolder ?? "");
                        }}
                        radius="md"
                        size="lg"
                        variant="light"
                      >
                        <IconPencil size={18} />
                      </ActionIcon>
                    </Box>
                  </Tooltip>
                  <Tooltip label="Delete folder">
                    <Box component="span">
                      <ActionIcon
                        aria-label="Delete folder"
                        color="red"
                        disabled={!selectedFolder}
                        loading={deleteFolderMutation.isPending}
                        onClick={() => {
                          if (selectedFolder && window.confirm(`Delete folder ${selectedFolder}?`)) {
                            void deleteFolderMutation.mutateAsync();
                          }
                        }}
                        radius="md"
                        size="lg"
                        variant="light"
                      >
                        <IconTrash size={18} />
                      </ActionIcon>
                    </Box>
                  </Tooltip>
                  <Tooltip label="New request">
                    <Box component="span">
                      <ActionIcon
                        aria-label="New request"
                        disabled={!selectedFolder}
                        onClick={() => {
                          setIsComposingNewRequest(true);
                          setSelectedRequestName(null);
                          setEditor(buildEmptyDraft(selectedFolder));
                        }}
                        radius="md"
                        size="lg"
                        variant="light"
                      >
                        <IconSend size={18} />
                      </ActionIcon>
                    </Box>
                  </Tooltip>
                </Group>
                {topLevelFolders.length > 1 ? (
                  <Text c="dimmed" size="xs">
                    Drag top-level folders to reorder.
                  </Text>
                ) : null}
              </Stack>
            ) : null}
            {topLevelFolders.length === 0 ? (
              <RequestsEmptyCard body="No folders exist yet." title="Collections" />
            ) : (
              <FolderTree
                expandedFolders={expandedFolders}
                itemsByFolder={itemsByFolder}
                onReorderFolders={(folders) => void reorderFoldersMutation.mutateAsync(folders)}
                onSelectFolder={(folderName) => {
                  setSelectedFolder(folderName);
                  setIsComposingNewRequest(false);
                }}
                onSelectRequest={(folderName, requestName) => {
                  setSelectedFolder(folderName);
                  setSelectedRequestName(requestName);
                  setIsComposingNewRequest(false);
                }}
                reorderDisabled={reorderFoldersMutation.isPending}
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
                title="Request builder"
                titleRight={
                  canWrite ? (
                    <Group gap="sm">
                      <Button
                        leftSection={<IconDeviceFloppy size={16} />}
                        loading={saveRequestMutation.isPending}
                        onClick={() => void saveRequestMutation.mutateAsync()}
                        size="sm"
                        variant="default"
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
                        size="sm"
                        variant="light"
                      >
                        Delete request
                      </Button>
                    </Group>
                  ) : undefined
                }
              >
                {requestQuery.isLoading && !isComposingNewRequest ? (
                  <RequestsLoadingState message="Loading the selected request from the companion app." />
                ) : (
                  <Stack gap="md">
                    <Group align="flex-end">
                      <TextInput
                        label="Name"
                        placeholder="Name"
                        style={{ flex: 1 }}
                        value={editor.name ?? ""}
                        onChange={(event) => setEditor((current) => ({ ...current, name: event.currentTarget.value }))}
                      />
                      <Select
                        data={environmentOptions}
                        disabled={!canWrite || environmentsQuery.isLoading}
                        label="Environment"
                        onChange={(value) =>
                          void setActiveEnvironmentMutation.mutateAsync(
                            value === NO_ENVIRONMENT_VALUE ? null : value ?? null
                          )
                        }
                        value={environmentsQuery.data?.activeId ?? NO_ENVIRONMENT_VALUE}
                        w={220}
                      />
                    </Group>
                    {environmentsQuery.isError ? (
                      <RequestsErrorAlert
                        error={environmentsQuery.error}
                        fallback="Unable to load environments."
                        onRetry={() => void environmentsQuery.refetch()}
                        title="Environments failed"
                      />
                    ) : null}
                    <Group align="center" gap="sm" wrap="nowrap">
                      <Select
                        data={HTTP_METHOD_OPTIONS}
                        onChange={(value) => setEditor((current) => ({ ...current, method: (value ?? HttpMethod.GET) as RequestsMethod }))}
                        value={editor.method}
                        w={95}
                      />
                      <TextInput
                        aria-label="Request URL"
                        onChange={(event) => setEditor((current) => ({ ...current, url: event.currentTarget.value }))}
                        placeholder="URL"
                        style={{ flex: 1 }}
                        value={editor.url}
                      />
                      {canWrite ? (
                        <Tooltip label="Import from curl">
                          <ActionIcon onClick={() => setCurlImportModal({ open: true, value: "" })} size="lg" variant="default">
                            <IconTerminal2 size={16} />
                          </ActionIcon>
                        </Tooltip>
                      ) : null}
                      <Tooltip label="Copy as curl">
                        <ActionIcon
                          onClick={() => {
                            void (async () => {
                              try {
                                if (!navigator.clipboard) {
                                  throw new Error("Clipboard is unavailable.");
                                }
                                await navigator.clipboard.writeText(
                                  buildCurl({
                                    ...resolvedEditor.document,
                                    credentialName: selectedCredentialName,
                                  })
                                );
                                notifications.show({
                                  color: "green",
                                  message: "curl copied to your clipboard.",
                                  title: "Copied as curl",
                                });
                              } catch (error) {
                                setNotice({ message: getErrorMessage(error, "Unable to copy curl."), status: "error" });
                              }
                            })();
                          }}
                          size="lg"
                          variant="default"
                        >
                          <IconCopy size={16} />
                        </ActionIcon>
                      </Tooltip>
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
                    <UrlVariablePreview url={editor.url} vars={environmentVariables} />
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
                        description="Manual enabled Authorization headers override the selected credential. Credential URLs are not templated in this phase; create per-environment credentials instead."
                        label="Credential"
                        onChange={(value) => setEditor((current) => ({ ...current, credentialId: value }))}
                        placeholder="No credential"
                        value={editor.credentialId}
                      />
                    </Stack>
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
      <Modal
        closeOnClickOutside={false}
        onClose={() => setCurlImportModal({ open: false, value: "" })}
        opened={curlImportModal.open}
        title="Import from curl"
      >
        <Stack>
          <Textarea
            label="curl command"
            autosize
            minRows={10}
            onChange={(event) => setCurlImportModal((current) => ({ ...current, value: event.currentTarget.value }))}
            value={curlImportModal.value}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setCurlImportModal({ open: false, value: "" })}>
              Cancel
            </Button>
            <Button
              disabled={curlImportModal.value.trim().length === 0}
              onClick={() => {
                const parsed = parseCurl(curlImportModal.value);
                setEditor((current) => ({
                  ...current,
                  body: parsed.body,
                  headers: ensureHeaderRows(parsed.headers),
                  method: parsed.method,
                  queryParams: ensureQueryRows(parsed.queryParams),
                  url: parsed.url,
                }));
                setExecuteResponse(null);
                setCurlImportModal({ open: false, value: "" });
                notifications.show({
                  color: parsed.url ? "green" : "yellow",
                  message: parsed.url ? "curl imported into the request editor." : "curl imported, but no URL was detected.",
                  title: parsed.url ? "curl imported" : "curl imported with warnings",
                });
              }}
            >
              Import
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
