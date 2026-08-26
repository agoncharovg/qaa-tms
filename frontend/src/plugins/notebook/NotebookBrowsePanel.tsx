import { useEffect, useState } from "react";
import {
  Button,
  Grid,
  Group,
  Paper,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconNote, IconPlus, IconRotateClockwise } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { agentClient } from "@/api/agentClient";
import type { NotebookBookmarkNode } from "@/api/types";
import { QueryKey } from "@/constants";

import {
  NotebookCompanionUnavailableAlert,
  NotebookErrorAlert,
  NotebookLoadingState,
  NotebookNoteEditor,
  NotebookNoticeAlert,
  NotebookSurface,
} from "@/plugins/notebook/NotebookShared";
import {
  buildPreviewText,
  type NotebookNotice,
  useNotebookAgent,
} from "@/plugins/notebook/notebookShared";

const NOTEBOOK_BROWSE_COPY = {
  BOOKMARKS_DESCRIPTION: "Top-level bookmarks only for v1. Nested children are ignored in the UI but remain safe in the stored tree.",
  BOOKMARKS_TITLE: "Bookmarks",
  BOOKMARK_CREATE: "Create bookmark",
  BOOKMARK_DELETE: "Delete bookmark",
  BOOKMARK_DELETE_CONFIRM: "Delete this bookmark and all its notes?",
  BOOKMARK_EMPTY: "No bookmarks exist yet.",
  BOOKMARK_FORM_LABEL: "New bookmark name",
  BOOKMARK_RENAME: "Rename bookmark",
  BOOKMARK_SELECTED_LABEL: "Selected bookmark name",
  COMPANION_LOADING: "Checking the local companion app before loading notebook bookmarks.",
  CONTENTS_ERROR: "Notebook contents failed",
  CONTENTS_FALLBACK: "Unable to load notebook bookmarks.",
  EDITOR_EMPTY_BODY: "Select a note to read or edit its full text.",
  EDITOR_EMPTY_TITLE: "Note",
  NOTEBOOK_DESCRIPTION: "Personal notes are read from and written to local files through the companion agent on this machine.",
  NOTEBOOK_TITLE: "Notebook",
  NOTE_CREATE: "New note",
  NOTE_DELETE: "Delete note",
  NOTE_DELETE_CONFIRM: "Delete this note?",
  NOTE_EMPTY: "No notes were returned for the selected bookmark.",
  NOTE_LOAD_ERROR: "Notes failed",
  NOTE_LOAD_FALLBACK: "Unable to load notes for the selected bookmark.",
  NOTE_TABLE_DESCRIPTION: "Each note is a timestamp-named local text file. The preview shows the first three lines.",
  NOTE_TABLE_TITLE: "Notes",
  REFRESH: "Refresh",
} as const;

function findBookmark(bookmarks: NotebookBookmarkNode[], bookmarkName: string | null): NotebookBookmarkNode | null {
  if (!bookmarkName) {
    return null;
  }

  return bookmarks.find((bookmark) => bookmark.name === bookmarkName) ?? null;
}

async function invalidateNotebookQueries(queryClient: ReturnType<typeof useQueryClient>): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: [QueryKey.NOTEBOOK_CONTENTS] }),
    queryClient.invalidateQueries({ queryKey: [QueryKey.NOTEBOOK_NOTES] }),
    queryClient.invalidateQueries({ queryKey: [QueryKey.NOTEBOOK_NOTE] }),
    queryClient.invalidateQueries({ queryKey: [QueryKey.NOTEBOOK_SEARCH] }),
  ]);
}

export function NotebookBrowsePanel() {
  const queryClient = useQueryClient();
  const { agentPort, companionUnavailable, preflightQuery, probedPorts, token } = useNotebookAgent();
  const [bookmarkNotice, setBookmarkNotice] = useState<NotebookNotice | null>(null);
  const [noteNotice, setNoteNotice] = useState<NotebookNotice | null>(null);
  const [newBookmarkName, setNewBookmarkName] = useState("");
  const [bookmarkNameDraft, setBookmarkNameDraft] = useState("");
  const [selectedBookmark, setSelectedBookmark] = useState<string | null>(null);
  const [selectedNoteName, setSelectedNoteName] = useState<string | null>(null);
  const [editorText, setEditorText] = useState("");

  const contentsQuery = useQuery({
    enabled: Boolean(token && agentPort !== null),
    queryFn: ({ signal }) => agentClient.getNotebookTree(agentPort ?? 0, token ?? "", signal),
    queryKey: [QueryKey.NOTEBOOK_CONTENTS, token, agentPort],
    refetchOnWindowFocus: false,
    retry: false,
  });

  const selectedBookmarkNode = findBookmark(contentsQuery.data?.bookmarks ?? [], selectedBookmark);

  const notesQuery = useQuery({
    enabled: Boolean(token && agentPort !== null && selectedBookmark),
    queryFn: ({ signal }) => agentClient.listNotes(agentPort ?? 0, token ?? "", selectedBookmark ?? "", signal),
    queryKey: [QueryKey.NOTEBOOK_NOTES, token, agentPort, selectedBookmark],
    refetchOnWindowFocus: false,
    retry: false,
  });

  const noteQuery = useQuery({
    enabled: Boolean(token && agentPort !== null && selectedBookmark && selectedNoteName),
    queryFn: ({ signal }) =>
      agentClient.readNote(agentPort ?? 0, token ?? "", selectedBookmark ?? "", selectedNoteName ?? "", signal),
    queryKey: [QueryKey.NOTEBOOK_NOTE, token, agentPort, selectedBookmark, selectedNoteName],
    refetchOnWindowFocus: false,
    retry: false,
  });

  useEffect(() => {
    const bookmarks = contentsQuery.data?.bookmarks ?? [];
    if (bookmarks.length === 0) {
      setSelectedBookmark(null);
      return;
    }

    if (!bookmarks.some((bookmark) => bookmark.name === selectedBookmark)) {
      setSelectedBookmark(bookmarks[0]?.name ?? null);
    }
  }, [contentsQuery.data?.bookmarks, selectedBookmark]);

  useEffect(() => {
    setBookmarkNameDraft(selectedBookmarkNode?.name ?? "");
  }, [selectedBookmarkNode?.name]);

  useEffect(() => {
    setSelectedNoteName(null);
    setEditorText("");
  }, [selectedBookmark]);

  useEffect(() => {
    const notes = notesQuery.data?.notes ?? [];
    if (notes.length === 0) {
      setSelectedNoteName(null);
      return;
    }

    if (!notes.some((note) => note.name === selectedNoteName)) {
      setSelectedNoteName(notes[0]?.name ?? null);
    }
  }, [notesQuery.data?.notes, selectedNoteName]);

  useEffect(() => {
    if (noteQuery.data) {
      setEditorText(noteQuery.data.text);
    }
  }, [noteQuery.data]);

  const createBookmarkMutation = useMutation({
    mutationFn: async (name: string) => {
      if (!token || agentPort === null) {
        throw new Error("Authentication is required.");
      }

      return agentClient.createBookmark(agentPort, token, name);
    },
    onSuccess: async (_response, name) => {
      setBookmarkNotice({
        message: "Bookmark created.",
        status: "success",
      });
      setNewBookmarkName("");
      setSelectedBookmark(name);
      await invalidateNotebookQueries(queryClient);
    },
    onError: (error) => {
      setBookmarkNotice({
        message: error instanceof Error ? error.message : "Unable to create the bookmark.",
        status: "error",
      });
    },
  });

  const renameBookmarkMutation = useMutation({
    mutationFn: async (name: string) => {
      if (!token || agentPort === null || !selectedBookmark) {
        throw new Error("Select a bookmark first.");
      }

      return agentClient.renameBookmark(agentPort, token, selectedBookmark, name);
    },
    onSuccess: async (_response, name) => {
      setBookmarkNotice({
        message: "Bookmark renamed.",
        status: "success",
      });
      setSelectedBookmark(name);
      await invalidateNotebookQueries(queryClient);
    },
    onError: (error) => {
      setBookmarkNotice({
        message: error instanceof Error ? error.message : "Unable to rename the bookmark.",
        status: "error",
      });
    },
  });

  const deleteBookmarkMutation = useMutation({
    mutationFn: async () => {
      if (!token || agentPort === null || !selectedBookmark) {
        throw new Error("Select a bookmark first.");
      }

      return agentClient.deleteBookmark(agentPort, token, selectedBookmark);
    },
    onSuccess: async (response) => {
      setBookmarkNotice({
        message: "Bookmark deleted.",
        status: "success",
      });
      setSelectedBookmark(response.bookmarks[0]?.name ?? null);
      setSelectedNoteName(null);
      await invalidateNotebookQueries(queryClient);
    },
    onError: (error) => {
      setBookmarkNotice({
        message: error instanceof Error ? error.message : "Unable to delete the bookmark.",
        status: "error",
      });
    },
  });

  const createNoteMutation = useMutation({
    mutationFn: async () => {
      if (!token || agentPort === null || !selectedBookmark) {
        throw new Error("Select a bookmark first.");
      }

      return agentClient.writeNote(agentPort, token, {
        bookmark: selectedBookmark,
        text: "",
      });
    },
    onSuccess: async (response) => {
      setNoteNotice({
        message: "Note created.",
        status: "success",
      });
      setSelectedNoteName(response.name);
      setEditorText(response.text);
      await invalidateNotebookQueries(queryClient);
    },
    onError: (error) => {
      setNoteNotice({
        message: error instanceof Error ? error.message : "Unable to create the note.",
        status: "error",
      });
    },
  });

  const updateNoteMutation = useMutation({
    mutationFn: async (text: string) => {
      if (!token || agentPort === null || !selectedBookmark || !selectedNoteName) {
        throw new Error("Select a note first.");
      }

      return agentClient.updateNote(agentPort, token, selectedNoteName, {
        bookmark: selectedBookmark,
        text,
      });
    },
    onSuccess: async (response) => {
      setNoteNotice({
        message: "Note saved.",
        status: "success",
      });
      setEditorText(response.text);
      await invalidateNotebookQueries(queryClient);
    },
    onError: (error) => {
      setNoteNotice({
        message: error instanceof Error ? error.message : "Unable to save the note.",
        status: "error",
      });
    },
  });

  const deleteNoteMutation = useMutation({
    mutationFn: async () => {
      if (!token || agentPort === null || !selectedBookmark || !selectedNoteName) {
        throw new Error("Select a note first.");
      }

      return agentClient.deleteNote(agentPort, token, selectedBookmark, selectedNoteName);
    },
    onSuccess: async (response) => {
      setNoteNotice({
        message: "Note deleted.",
        status: "success",
      });
      setSelectedNoteName(response.notes[0]?.name ?? null);
      setEditorText("");
      await invalidateNotebookQueries(queryClient);
    },
    onError: (error) => {
      setNoteNotice({
        message: error instanceof Error ? error.message : "Unable to delete the note.",
        status: "error",
      });
    },
  });

  const notes = notesQuery.data?.notes ?? [];
  const hasUnsavedChanges = editorText !== (noteQuery.data?.text ?? "");
  const bookmarkActionDisabled = companionUnavailable || createBookmarkMutation.isPending;
  const noteActionDisabled =
    companionUnavailable ||
    !selectedBookmark ||
    createNoteMutation.isPending ||
    updateNoteMutation.isPending ||
    deleteNoteMutation.isPending;

  function handleCreateBookmark(): void {
    const trimmedName = newBookmarkName.trim();
    if (!trimmedName) {
      return;
    }

    setBookmarkNotice(null);
    createBookmarkMutation.mutate(trimmedName);
  }

  function handleRenameBookmark(): void {
    const trimmedName = bookmarkNameDraft.trim();
    if (!trimmedName || !selectedBookmark) {
      return;
    }

    setBookmarkNotice(null);
    renameBookmarkMutation.mutate(trimmedName);
  }

  function handleDeleteBookmark(): void {
    if (!selectedBookmark || !window.confirm(NOTEBOOK_BROWSE_COPY.BOOKMARK_DELETE_CONFIRM)) {
      return;
    }

    setBookmarkNotice(null);
    deleteBookmarkMutation.mutate();
  }

  function handleCreateNote(): void {
    setNoteNotice(null);
    createNoteMutation.mutate();
  }

  function handleSaveNote(): void {
    setNoteNotice(null);
    updateNoteMutation.mutate(editorText);
  }

  function handleDeleteNote(): void {
    if (!selectedNoteName || !window.confirm(NOTEBOOK_BROWSE_COPY.NOTE_DELETE_CONFIRM)) {
      return;
    }

    setNoteNotice(null);
    deleteNoteMutation.mutate();
  }

  if (preflightQuery.isLoading) {
    return <NotebookLoadingState message={NOTEBOOK_BROWSE_COPY.COMPANION_LOADING} />;
  }

  if (preflightQuery.isError) {
    return (
      <NotebookErrorAlert
        error={preflightQuery.error}
        fallback="Unable to reach the companion app."
        onRetry={() => void preflightQuery.refetch()}
        title={NOTEBOOK_BROWSE_COPY.CONTENTS_ERROR}
      />
    );
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <div>
          <Title order={2}>{NOTEBOOK_BROWSE_COPY.NOTEBOOK_TITLE}</Title>
          <Text c="dimmed">{NOTEBOOK_BROWSE_COPY.NOTEBOOK_DESCRIPTION}</Text>
        </div>
        <Button
          disabled={companionUnavailable || contentsQuery.isFetching}
          leftSection={<IconRotateClockwise size={16} />}
          onClick={() => void contentsQuery.refetch()}
          variant="light"
        >
          {NOTEBOOK_BROWSE_COPY.REFRESH}
        </Button>
      </Group>

      {companionUnavailable ? (
        <NotebookCompanionUnavailableAlert
          onRetry={() => void preflightQuery.refetch()}
          probedPorts={probedPorts}
        />
      ) : contentsQuery.isLoading ? (
        <NotebookLoadingState message="Loading notebook bookmarks from the companion app." />
      ) : contentsQuery.isError ? (
        <NotebookErrorAlert
          error={contentsQuery.error}
          fallback={NOTEBOOK_BROWSE_COPY.CONTENTS_FALLBACK}
          onRetry={() => void contentsQuery.refetch()}
          title={NOTEBOOK_BROWSE_COPY.CONTENTS_ERROR}
        />
      ) : (
        <Grid>
          <Grid.Col span={{ base: 12, lg: 3 }}>
            <NotebookSurface
              description={NOTEBOOK_BROWSE_COPY.BOOKMARKS_DESCRIPTION}
              title={NOTEBOOK_BROWSE_COPY.BOOKMARKS_TITLE}
            >
              <NotebookNoticeAlert notice={bookmarkNotice} />
              <Stack gap="md">
                <Group align="flex-end">
                  <TextInput
                    label={NOTEBOOK_BROWSE_COPY.BOOKMARK_FORM_LABEL}
                    onChange={(event) => setNewBookmarkName(event.currentTarget.value)}
                    value={newBookmarkName}
                  />
                  <Button
                    disabled={bookmarkActionDisabled || newBookmarkName.trim().length === 0}
                    leftSection={<IconPlus size={16} />}
                    onClick={handleCreateBookmark}
                  >
                    {NOTEBOOK_BROWSE_COPY.BOOKMARK_CREATE}
                  </Button>
                </Group>

                {contentsQuery.data?.bookmarks.length ? (
                  <Stack gap="xs">
                    {contentsQuery.data.bookmarks.map((bookmark) => (
                      <Button
                        fullWidth
                        key={bookmark.name}
                        onClick={() => setSelectedBookmark(bookmark.name)}
                        variant={selectedBookmark === bookmark.name ? "filled" : "light"}
                      >
                        <Group justify="space-between" w="100%" wrap="nowrap">
                          <span>{bookmark.name}</span>
                          <span>{bookmark.noteCount}</span>
                        </Group>
                      </Button>
                    ))}
                  </Stack>
                ) : (
                  <Paper p="lg" radius="md" withBorder>
                    <Text c="dimmed" ta="center">
                      {NOTEBOOK_BROWSE_COPY.BOOKMARK_EMPTY}
                    </Text>
                  </Paper>
                )}

                <TextInput
                  disabled={!selectedBookmark}
                  label={NOTEBOOK_BROWSE_COPY.BOOKMARK_SELECTED_LABEL}
                  onChange={(event) => setBookmarkNameDraft(event.currentTarget.value)}
                  value={bookmarkNameDraft}
                />
                <Group grow>
                  <Button
                    disabled={!selectedBookmark || bookmarkNameDraft.trim().length === 0}
                    loading={renameBookmarkMutation.isPending}
                    onClick={handleRenameBookmark}
                    variant="light"
                  >
                    {NOTEBOOK_BROWSE_COPY.BOOKMARK_RENAME}
                  </Button>
                  <Button
                    color="red"
                    disabled={!selectedBookmark}
                    loading={deleteBookmarkMutation.isPending}
                    onClick={handleDeleteBookmark}
                    variant="light"
                  >
                    {NOTEBOOK_BROWSE_COPY.BOOKMARK_DELETE}
                  </Button>
                </Group>
              </Stack>
            </NotebookSurface>
          </Grid.Col>

          <Grid.Col span={{ base: 12, lg: 9 }}>
            <Grid>
              <Grid.Col span={{ base: 12, md: 4 }}>
                <NotebookSurface
                  description={NOTEBOOK_BROWSE_COPY.NOTE_TABLE_DESCRIPTION}
                  title={selectedBookmark ?? NOTEBOOK_BROWSE_COPY.NOTE_TABLE_TITLE}
                >
                  <NotebookNoticeAlert notice={noteNotice} />
                  <Group justify="space-between">
                    <Text c="dimmed" size="sm">
                      {selectedBookmarkNode ? `${selectedBookmarkNode.noteCount} note(s)` : "Choose a bookmark first."}
                    </Text>
                    <Button
                      disabled={!selectedBookmark || noteActionDisabled}
                      leftSection={<IconNote size={16} />}
                      loading={createNoteMutation.isPending}
                      onClick={handleCreateNote}
                      size="xs"
                    >
                      {NOTEBOOK_BROWSE_COPY.NOTE_CREATE}
                    </Button>
                  </Group>

                  {!selectedBookmark ? (
                    <Paper p="lg" radius="md" withBorder>
                      <Text c="dimmed" ta="center">
                        Select a bookmark to list its notes.
                      </Text>
                    </Paper>
                  ) : notesQuery.isLoading ? (
                    <NotebookLoadingState message="Loading notes from the companion app." />
                  ) : notesQuery.isError ? (
                    <NotebookErrorAlert
                      error={notesQuery.error}
                      fallback={NOTEBOOK_BROWSE_COPY.NOTE_LOAD_FALLBACK}
                      onRetry={() => void notesQuery.refetch()}
                      title={NOTEBOOK_BROWSE_COPY.NOTE_LOAD_ERROR}
                    />
                  ) : notes.length === 0 ? (
                    <Paper p="lg" radius="md" withBorder>
                      <Text c="dimmed" ta="center">
                        {NOTEBOOK_BROWSE_COPY.NOTE_EMPTY}
                      </Text>
                    </Paper>
                  ) : (
                    <Table.ScrollContainer minWidth={420}>
                      <Table highlightOnHover striped withTableBorder>
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th>Name</Table.Th>
                            <Table.Th>Preview</Table.Th>
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {notes.map((note) => (
                            <Table.Tr
                              key={note.name}
                              onClick={() => setSelectedNoteName(note.name)}
                              style={{
                                backgroundColor: selectedNoteName === note.name ? "var(--mantine-color-dark-6)" : undefined,
                                cursor: "pointer",
                              }}
                            >
                              <Table.Td style={{ verticalAlign: "top", whiteSpace: "nowrap" }}>
                                {note.name}
                              </Table.Td>
                              <Table.Td>
                                <Text c="dimmed" size="sm" style={{ whiteSpace: "pre-wrap" }}>
                                  {buildPreviewText(note.previewLines)}
                                </Text>
                              </Table.Td>
                            </Table.Tr>
                          ))}
                        </Table.Tbody>
                      </Table>
                    </Table.ScrollContainer>
                  )}
                </NotebookSurface>
              </Grid.Col>

              <Grid.Col span={{ base: 12, md: 8 }}>
                <NotebookNoteEditor
                  bookmark={selectedBookmark}
                  deleteButtonLabel={NOTEBOOK_BROWSE_COPY.NOTE_DELETE}
                  deleteDisabled={!selectedNoteName || deleteNoteMutation.isPending}
                  emptyBody={NOTEBOOK_BROWSE_COPY.EDITOR_EMPTY_BODY}
                  emptyTitle={NOTEBOOK_BROWSE_COPY.EDITOR_EMPTY_TITLE}
                  error={noteQuery.error}
                  hasSelection={Boolean(selectedNoteName)}
                  hasUnsavedChanges={hasUnsavedChanges}
                  isDeleting={deleteNoteMutation.isPending}
                  isLoading={noteQuery.isLoading}
                  isSaving={updateNoteMutation.isPending}
                  note={noteQuery.data}
                  onDelete={handleDeleteNote}
                  onRetry={() => void noteQuery.refetch()}
                  onSave={handleSaveNote}
                  onTextChange={setEditorText}
                  saveDisabled={
                    !selectedNoteName ||
                    !hasUnsavedChanges ||
                    updateNoteMutation.isPending ||
                    deleteNoteMutation.isPending
                  }
                  text={editorText}
                />
              </Grid.Col>
            </Grid>
          </Grid.Col>
        </Grid>
      )}
    </Stack>
  );
}
