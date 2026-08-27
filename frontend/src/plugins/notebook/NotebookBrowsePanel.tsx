import { type DragEvent, useEffect, useRef, useState } from "react";
import {
  ActionIcon,
  Button,
  Grid,
  Group,
  Modal,
  Paper,
  Stack,
  Text,
  TextInput,
  Tooltip,
  Title,
} from "@mantine/core";
import { IconNote, IconPencil, IconPlus, IconRotateClockwise, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AgentRequestError, agentClient } from "@/api/agentClient";
import type {
  NotebookBookmarkNode,
  NotebookContentsResponse,
  NotebookNoteReadResponse,
  NotebookNotesResponse,
} from "@/api/types";
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
  BOOKMARK_CREATE: "Create bookmark",
  BOOKMARK_DELETE: "Delete bookmark",
  BOOKMARK_DELETE_CONFIRM: "Delete this bookmark and all its notes?",
  BOOKMARK_EMPTY: "No bookmarks exist yet.",
  BOOKMARK_MODAL_CANCEL: "Cancel",
  BOOKMARK_MODAL_CREATE_TITLE: "Create bookmark",
  BOOKMARK_MODAL_LABEL: "Bookmark name",
  BOOKMARK_RENAME: "Rename bookmark",
  BOOKMARK_MODAL_RENAME_TITLE: "Rename bookmark",
  BOOKMARK_MODAL_SAVE: "Save",
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
  REFRESH: "Refresh",
  SELECT_BOOKMARK_PROMPT: "Select a bookmark to list its notes.",
} as const;

type BookmarkModalState = {
  mode: "create" | "rename";
  open: boolean;
};

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

function buildPreviewLines(text: string): string[] {
  return text.split(/\r?\n/).slice(0, 3);
}

function buildNoteSummary(note: NotebookNoteReadResponse) {
  return {
    flags: note.flags,
    name: note.name,
    previewLines: note.previewLines,
  };
}

function applyMovedNoteToCache(
  queryClient: ReturnType<typeof useQueryClient>,
  token: string | null,
  agentPort: number | null,
  sourceBookmark: string,
  note: NotebookNoteReadResponse
): void {
  if (token === null || agentPort === null || sourceBookmark === note.bookmark) {
    return;
  }

  queryClient.setQueryData<NotebookContentsResponse | undefined>(
    [QueryKey.NOTEBOOK_CONTENTS, token, agentPort],
    (current) => {
      if (!current) {
        return current;
      }

      return {
        bookmarks: current.bookmarks.map((bookmark) => {
          if (bookmark.name === sourceBookmark) {
            return {
              ...bookmark,
              noteCount: Math.max(0, bookmark.noteCount - 1),
            };
          }
          if (bookmark.name === note.bookmark) {
            return {
              ...bookmark,
              noteCount: bookmark.noteCount + 1,
            };
          }
          return bookmark;
        }),
      };
    }
  );

  queryClient.setQueryData<NotebookNotesResponse | undefined>(
    [QueryKey.NOTEBOOK_NOTES, token, agentPort, sourceBookmark],
    (current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        notes: current.notes.filter((currentNote) => currentNote.name !== note.name),
      };
    }
  );

  queryClient.setQueryData<NotebookNotesResponse | undefined>(
    [QueryKey.NOTEBOOK_NOTES, token, agentPort, note.bookmark],
    (current) => {
      const movedNote = buildNoteSummary(note);
      if (!current) {
        return {
          bookmark: note.bookmark,
          notes: [movedNote],
        };
      }

      return {
        ...current,
        bookmark: note.bookmark,
        notes: [movedNote, ...current.notes.filter((currentNote) => currentNote.name !== note.name)],
      };
    }
  );

  queryClient.removeQueries({
    exact: true,
    queryKey: [QueryKey.NOTEBOOK_NOTE, token, agentPort, sourceBookmark, note.name],
  });
  queryClient.setQueryData<NotebookNoteReadResponse>(
    [QueryKey.NOTEBOOK_NOTE, token, agentPort, note.bookmark, note.name],
    note
  );
}

export function NotebookBrowsePanel() {
  const queryClient = useQueryClient();
  const { agentPort, companionUnavailable, preflightQuery, probedPorts, token } = useNotebookAgent();
  const [bookmarkNotice, setBookmarkNotice] = useState<NotebookNotice | null>(null);
  const [noteNotice, setNoteNotice] = useState<NotebookNotice | null>(null);
  const [bookmarkModal, setBookmarkModal] = useState<BookmarkModalState>({
    mode: "create",
    open: false,
  });
  const [bookmarkModalName, setBookmarkModalName] = useState("");
  const [selectedBookmark, setSelectedBookmark] = useState<string | null>(null);
  const [selectedNoteName, setSelectedNoteName] = useState<string | null>(null);
  const [editorText, setEditorText] = useState("");
  const [draggedNoteName, setDraggedNoteName] = useState<string | null>(null);
  const [dragOverBookmarkName, setDragOverBookmarkName] = useState<string | null>(null);
  const pendingSelectedNoteNameRef = useRef<string | null>(null);

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
    setSelectedNoteName(pendingSelectedNoteNameRef.current);
    setEditorText("");
    pendingSelectedNoteNameRef.current = null;
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
      setBookmarkModal({
        mode: "create",
        open: false,
      });
      setBookmarkModalName("");
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
      setBookmarkModal({
        mode: "rename",
        open: false,
      });
      setBookmarkModalName("");
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

      return agentClient.updateNote(agentPort, token, selectedBookmark, selectedNoteName, {
        bookmark: selectedBookmark,
        text,
      });
    },
    onSuccess: async (response) => {
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

      return await agentClient.deleteNote(agentPort, token, selectedBookmark, selectedNoteName);
    },
    onSuccess: async (response) => {
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

  const moveNoteMutation = useMutation({
    mutationFn: async ({
      name,
      sourceBookmark,
      targetBookmark,
      text,
    }: {
      name: string;
      sourceBookmark: string;
      targetBookmark: string;
      text?: string;
    }) => {
      if (!token || agentPort === null) {
        throw new Error("Authentication is required.");
      }

      try {
        return await agentClient.updateNote(agentPort, token, sourceBookmark, name, {
          bookmark: targetBookmark,
          text,
        });
      } catch (error) {
        if (!(error instanceof AgentRequestError) || error.message !== "No note changes requested.") {
          throw error;
        }

        const targetNotes = await agentClient.listNotes(agentPort, token, targetBookmark);
        if (targetNotes.notes.some((note) => note.name === name)) {
          throw new Error(`Note already exists in bookmark ${targetBookmark}: ${name}`);
        }

        const sourceNote =
          sourceBookmark === selectedBookmark &&
          name === selectedNoteName &&
          noteQuery.data !== undefined &&
          noteQuery.data !== null
            ? noteQuery.data
            : await agentClient.readNote(agentPort, token, sourceBookmark, name);
        const movedText = text ?? sourceNote.text;
        const movedNote: NotebookNoteReadResponse = {
          ...sourceNote,
          bookmark: targetBookmark,
          name,
          previewLines: movedText === sourceNote.text ? sourceNote.previewLines : buildPreviewLines(movedText),
          text: movedText,
        };

        await agentClient.writeNote(agentPort, token, {
          bookmark: targetBookmark,
          flags: sourceNote.flags,
          name,
          text: movedText,
        });
        try {
          await agentClient.deleteNote(agentPort, token, sourceBookmark, name);
        } catch (deleteError) {
          const sourceNotes = await agentClient.listNotes(agentPort, token, sourceBookmark);
          if (sourceNotes.notes.some((sourceListNote) => sourceListNote.name === name)) {
            throw deleteError;
          }
        }
        return movedNote;
      }
    },
    onSuccess: async (response, variables) => {
      applyMovedNoteToCache(queryClient, token, agentPort, variables.sourceBookmark, response);
      pendingSelectedNoteNameRef.current = response.name;
      setSelectedNoteName(null);
      setSelectedBookmark(response.bookmark);
      setEditorText("");
      await invalidateNotebookQueries(queryClient);
    },
    onError: (error) => {
      setNoteNotice({
        message: error instanceof Error ? error.message : "Unable to move the note.",
        status: "error",
      });
    },
    onSettled: () => {
      setDraggedNoteName(null);
      setDragOverBookmarkName(null);
    },
  });

  const notes = notesQuery.data?.notes ?? [];
  const hasUnsavedChanges = editorText !== (noteQuery.data?.text ?? "");
  const bookmarkModalNameTrimmed = bookmarkModalName.trim();
  const bookmarkCreateDisabled =
    companionUnavailable || createBookmarkMutation.isPending || moveNoteMutation.isPending;
  const bookmarkRenameDisabled =
    companionUnavailable || !selectedBookmark || renameBookmarkMutation.isPending || moveNoteMutation.isPending;
  const bookmarkDeleteDisabled =
    companionUnavailable || !selectedBookmark || deleteBookmarkMutation.isPending || moveNoteMutation.isPending;
  const isBookmarkModalSaving =
    bookmarkModal.mode === "create" ? createBookmarkMutation.isPending : renameBookmarkMutation.isPending;
  const noteActionDisabled =
    companionUnavailable ||
    !selectedBookmark ||
    createNoteMutation.isPending ||
    updateNoteMutation.isPending ||
    deleteNoteMutation.isPending ||
    moveNoteMutation.isPending;

  function openCreateBookmarkModal(): void {
    setBookmarkModal({
      mode: "create",
      open: true,
    });
    setBookmarkModalName("");
  }

  function openRenameBookmarkModal(): void {
    if (!selectedBookmarkNode) {
      return;
    }

    setBookmarkModal({
      mode: "rename",
      open: true,
    });
    setBookmarkModalName(selectedBookmarkNode.name);
  }

  function closeBookmarkModal(): void {
    setBookmarkModal((current) => ({
      ...current,
      open: false,
    }));
  }

  function handleBookmarkModalSave(): void {
    setBookmarkNotice(null);
    if (bookmarkModal.mode === "create") {
      if (!bookmarkModalNameTrimmed) {
        return;
      }

      createBookmarkMutation.mutate(bookmarkModalNameTrimmed);
      return;
    }

    if (!bookmarkModalNameTrimmed || !selectedBookmark) {
      return;
    }

    renameBookmarkMutation.mutate(bookmarkModalNameTrimmed);
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

  function handleNoteDragStart(event: DragEvent<HTMLButtonElement>, noteName: string): void {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", noteName);
    setDraggedNoteName(noteName);
    setDragOverBookmarkName(null);
  }

  function handleNoteDragEnd(): void {
    setDraggedNoteName(null);
    setDragOverBookmarkName(null);
  }

  function handleBookmarkDragOver(event: DragEvent<HTMLButtonElement>, bookmarkName: string): void {
    if (!selectedBookmark || !draggedNoteName || selectedBookmark === bookmarkName || moveNoteMutation.isPending) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (dragOverBookmarkName !== bookmarkName) {
      setDragOverBookmarkName(bookmarkName);
    }
  }

  function handleBookmarkDrop(event: DragEvent<HTMLButtonElement>, bookmarkName: string): void {
    event.preventDefault();
    if (!selectedBookmark || !draggedNoteName || selectedBookmark === bookmarkName || moveNoteMutation.isPending) {
      setDragOverBookmarkName(null);
      return;
    }

    setNoteNotice(null);
    moveNoteMutation.mutate({
      name: draggedNoteName,
      sourceBookmark: selectedBookmark,
      targetBookmark: bookmarkName,
      text: draggedNoteName === selectedNoteName && hasUnsavedChanges ? editorText : undefined,
    });
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
      <Modal
        onClose={closeBookmarkModal}
        opened={bookmarkModal.open}
        title={
          bookmarkModal.mode === "create"
            ? NOTEBOOK_BROWSE_COPY.BOOKMARK_MODAL_CREATE_TITLE
            : NOTEBOOK_BROWSE_COPY.BOOKMARK_MODAL_RENAME_TITLE
        }
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            handleBookmarkModalSave();
          }}
        >
          <Stack gap="md">
            <TextInput
              autoFocus
              disabled={isBookmarkModalSaving}
              label={NOTEBOOK_BROWSE_COPY.BOOKMARK_MODAL_LABEL}
              onChange={(event) => setBookmarkModalName(event.currentTarget.value)}
              value={bookmarkModalName}
            />
            <Group justify="flex-end">
              <Button onClick={closeBookmarkModal} type="button" variant="default">
                {NOTEBOOK_BROWSE_COPY.BOOKMARK_MODAL_CANCEL}
              </Button>
              <Button
                disabled={bookmarkModalNameTrimmed.length === 0}
                loading={isBookmarkModalSaving}
                type="submit"
              >
                {NOTEBOOK_BROWSE_COPY.BOOKMARK_MODAL_SAVE}
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>

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
          <Grid.Col span={{ base: 12, lg: 2, md: 3 }}>
            <NotebookSurface title="Bookmarks">
              <NotebookNoticeAlert notice={bookmarkNotice} />
              <Stack gap="md">
                <Group gap="xs">
                  <Tooltip label={NOTEBOOK_BROWSE_COPY.BOOKMARK_CREATE}>
                    <ActionIcon
                      aria-label={NOTEBOOK_BROWSE_COPY.BOOKMARK_CREATE}
                      disabled={bookmarkCreateDisabled}
                      onClick={openCreateBookmarkModal}
                      size="lg"
                      variant="light"
                    >
                      <IconPlus size={18} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label={NOTEBOOK_BROWSE_COPY.BOOKMARK_RENAME}>
                    <ActionIcon
                      aria-label={NOTEBOOK_BROWSE_COPY.BOOKMARK_RENAME}
                      disabled={bookmarkRenameDisabled}
                      onClick={openRenameBookmarkModal}
                      size="lg"
                      variant="light"
                    >
                      <IconPencil size={18} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label={NOTEBOOK_BROWSE_COPY.BOOKMARK_DELETE}>
                    <ActionIcon
                      aria-label={NOTEBOOK_BROWSE_COPY.BOOKMARK_DELETE}
                      color="red"
                      disabled={bookmarkDeleteDisabled}
                      onClick={handleDeleteBookmark}
                      size="lg"
                      variant="light"
                    >
                      <IconTrash size={18} />
                    </ActionIcon>
                  </Tooltip>
                </Group>

                {contentsQuery.data?.bookmarks.length ? (
                  <Stack gap="xs">
                    {contentsQuery.data.bookmarks.map((bookmark) => {
                      const isDropTarget =
                        draggedNoteName !== null &&
                        dragOverBookmarkName === bookmark.name &&
                        selectedBookmark !== bookmark.name;

                      return (
                        <Button
                          fullWidth
                          key={bookmark.name}
                          onClick={() => setSelectedBookmark(bookmark.name)}
                          onDragOver={(event) => handleBookmarkDragOver(event, bookmark.name)}
                          onDrop={(event) => handleBookmarkDrop(event, bookmark.name)}
                          style={
                            isDropTarget
                              ? {
                                  outline: "2px dashed var(--mantine-color-blue-5)",
                                  outlineOffset: 2,
                                }
                              : undefined
                          }
                          variant={selectedBookmark === bookmark.name ? "filled" : "light"}
                        >
                          <Group justify="space-between" w="100%" wrap="nowrap">
                            <span>{bookmark.name}</span>
                            <span>{bookmark.noteCount}</span>
                          </Group>
                        </Button>
                      );
                    })}
                  </Stack>
                ) : (
                  <Paper p="lg" radius="md" withBorder>
                    <Text c="dimmed" ta="center">
                      {NOTEBOOK_BROWSE_COPY.BOOKMARK_EMPTY}
                    </Text>
                  </Paper>
                )}
              </Stack>
            </NotebookSurface>
          </Grid.Col>

          <Grid.Col span={{ base: 12, lg: 2, md: 3 }}>
            <NotebookSurface title="Notes">
              <NotebookNoticeAlert notice={noteNotice} />
              <Group gap="xs">
                <Tooltip label={NOTEBOOK_BROWSE_COPY.NOTE_CREATE}>
                  <ActionIcon
                    aria-label={NOTEBOOK_BROWSE_COPY.NOTE_CREATE}
                    disabled={noteActionDisabled}
                    onClick={handleCreateNote}
                    size="lg"
                    variant="light"
                  >
                    <IconNote size={18} />
                  </ActionIcon>
                </Tooltip>
              </Group>

              {!selectedBookmark ? (
                <Paper p="lg" radius="md" withBorder>
                  <Text c="dimmed" ta="center">
                    {NOTEBOOK_BROWSE_COPY.SELECT_BOOKMARK_PROMPT}
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
                <Stack gap="xs">
                  {notes.map((note) => {
                    const isSelected = selectedNoteName === note.name;

                    return (
                      <Button
                        draggable={!moveNoteMutation.isPending}
                        fullWidth
                        key={note.name}
                        onClick={() => setSelectedNoteName(note.name)}
                        onDragEnd={handleNoteDragEnd}
                        onDragStart={(event) => handleNoteDragStart(event, note.name)}
                        style={{
                          cursor: moveNoteMutation.isPending ? "default" : "grab",
                          height: "auto",
                          paddingBlock: "0.75rem",
                        }}
                        styles={{
                          inner: {
                            alignItems: "flex-start",
                            justifyContent: "flex-start",
                          },
                          label: {
                            whiteSpace: "normal",
                            width: "100%",
                          },
                        }}
                        variant={isSelected ? "filled" : "light"}
                      >
                        <Text
                          c={isSelected ? undefined : "dimmed"}
                          size="sm"
                          ta="left"
                          style={{ whiteSpace: "pre-wrap", width: "100%" }}
                        >
                          {buildPreviewText(note.previewLines)}
                        </Text>
                      </Button>
                    );
                  })}
                </Stack>
              )}
            </NotebookSurface>
          </Grid.Col>

          <Grid.Col span={{ base: 12, lg: 8, md: 6 }}>
            <NotebookNoteEditor
              bookmark={selectedBookmark}
              deleteButtonLabel={NOTEBOOK_BROWSE_COPY.NOTE_DELETE}
              deleteDisabled={!selectedNoteName || deleteNoteMutation.isPending || moveNoteMutation.isPending}
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
                deleteNoteMutation.isPending ||
                moveNoteMutation.isPending
              }
              text={editorText}
            />
          </Grid.Col>
        </Grid>
      )}
    </Stack>
  );
}
