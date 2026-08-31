import { type CSSProperties, type DragEvent, type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  ActionIcon,
  Box,
  Button,
  Collapse,
  Grid,
  Group,
  Loader,
  Modal,
  Paper,
  Stack,
  Text,
  TextInput,
  Tooltip,
  Title,
  UnstyledButton,
} from "@mantine/core";
import {
  IconBell,
  IconBellRinging,
  IconChevronDown,
  IconChevronRight,
  IconFilter,
  IconFilterFilled,
  IconFolder,
  IconNote,
  IconPencil,
  IconPlus,
  IconRotateClockwise,
  IconTrash,
} from "@tabler/icons-react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";

import { usePalette } from "@/app/theme/usePalette";
import type { Palette } from "@/app/theme/tokens";
import { AgentRequestError, agentClient } from "@/api/agentClient";
import type {
  NotebookBookmarkNode,
  NotebookContentsResponse,
  NotebookNoteReadResponse,
  NotebookReminder,
  NotebookRemindersResponse,
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
import {
  clearNotebookNoteDraft,
  clearNotebookNoteDraftsForBookmark,
  getNotebookNoteDraft,
  renameNotebookNoteDraftBookmark,
  setNotebookNoteDraft,
} from "@/plugins/notebook/notebookDrafts";
import {
  clearReminderFlags,
  defaultReminderValue,
  dismissReminderFlags,
  formatReminder,
  formatReminderValue,
  getReminderFlagValue,
  hasActiveReminder,
  setReminderFlags,
  useNotebookReminders,
} from "@/plugins/notebook/reminders";
import { useNotebookNavStore } from "./notebookNavStore";

const NOTEBOOK_BROWSE_COPY = {
  BOOKMARK_CREATE: "Create bookmark",
  BOOKMARK_DELETE: "Delete bookmark",
  BOOKMARK_DELETE_CONFIRM: "Delete this bookmark and all its notes?",
  BOOKMARK_EMPTY: "No bookmarks exist yet.",
  BOOKMARK_MODAL_CANCEL: "Cancel",
  BOOKMARK_MODAL_CREATE_TITLE: "Create bookmark",
  BOOKMARK_MODAL_LABEL: "Bookmark name",
  BOOKMARK_REMINDER_HINT: "Contains a reminder",
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
  NOTE_FILTER_ALL: "Show all notes",
  NOTE_FILTER_REMINDERS: "Show only notes with reminders",
  NOTE_LEAF_EMPTY: "No notes",
  NOTE_REMINDER_CLEAR: "Clear reminder",
  NOTE_REMINDER_LABEL: "Reminder",
  NOTE_REMINDER_SET: "Set reminder",
  NOTE_FOLDER_LOADING: "Loading notes",
  REMINDER_DISMISS: "Dismiss",
  REMINDER_EMPTY: "Empty note.",
  REMINDER_TITLE: "Active reminders",
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

type BookmarkNotesState = {
  error: unknown;
  isError: boolean;
  isLoading: boolean;
  notes: NotebookNotesResponse["notes"];
  refetch: () => Promise<unknown>;
};

// Mirror the main sidebar nav rows (see app/layout/Sidebar.tsx): a neutral "chip"
// highlight for the parent (bookmark) rows and a soft accent tint for the child
// (note) rows, so the tree reads like the primary navigation menu.
function buildBookmarkRowStyle(active: boolean, palette: Palette): CSSProperties {
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

function buildNoteRowStyle(active: boolean, palette: Palette): CSSProperties {
  return {
    alignItems: "center",
    backgroundColor: active ? palette.accentSoft : "transparent",
    border: "1px solid transparent",
    borderRadius: "8px",
    color: active ? palette.accent : palette.inkSoft,
    display: "flex",
    justifyContent: "space-between",
    padding: "6px 10px",
    transition: "background-color 150ms ease, color 150ms ease",
    width: "100%",
  };
}

function findBookmark(bookmarks: NotebookBookmarkNode[], bookmarkName: string | null): NotebookBookmarkNode | null {
  return bookmarks.find((bookmark) => bookmark.name === bookmarkName) ?? null;
}

async function invalidateNotebookQueries(queryClient: ReturnType<typeof useQueryClient>): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: [QueryKey.NOTEBOOK_CONTENTS] }),
    queryClient.invalidateQueries({ queryKey: [QueryKey.NOTEBOOK_NOTES] }),
    queryClient.invalidateQueries({ queryKey: [QueryKey.NOTEBOOK_NOTE] }),
    queryClient.invalidateQueries({ queryKey: [QueryKey.NOTEBOOK_SEARCH] }),
    queryClient.invalidateQueries({ queryKey: [QueryKey.NOTEBOOK_REMINDERS] }),
  ]);
}

function buildPreviewLines(text: string): string[] {
  return text.split(/\r?\n/).slice(0, 3);
}

function buildNotePreviewLine(previewLines: string[], fallback: string): string {
  const firstNonEmptyLine = previewLines.find((line) => line.trim().length > 0);
  return firstNonEmptyLine?.trim() || fallback;
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
  const palette = usePalette();
  const queryClient = useQueryClient();
  const { agentPort, companionUnavailable, preflightQuery, probedPorts, token } = useNotebookAgent();
  const remindersQuery = useNotebookReminders();
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
  const [remindersFilter, setRemindersFilter] = useState(false);
  const [reminderDraft, setReminderDraft] = useState("");
  const [reminderOpen, setReminderOpen] = useState(false);
  const [draggedNoteName, setDraggedNoteName] = useState<string | null>(null);
  const [dragOverBookmarkName, setDragOverBookmarkName] = useState<string | null>(null);
  const [draggedBookmarkName, setDraggedBookmarkName] = useState<string | null>(null);
  const [bookmarkDropIndex, setBookmarkDropIndex] = useState<number | null>(null);
  const [expandedBookmarks, setExpandedBookmarks] = useState<Set<string>>(() => new Set());
  const pendingSelectedNoteNameRef = useRef<string | null>(null);
  const pendingSelection = useNotebookNavStore((state) => state.pendingSelection);
  const clearPendingSelection = useNotebookNavStore((state) => state.clearPendingSelection);

  const contentsQuery = useQuery({
    enabled: Boolean(token && agentPort !== null),
    queryFn: ({ signal }) => agentClient.getNotebookTree(agentPort ?? 0, token ?? "", signal),
    queryKey: [QueryKey.NOTEBOOK_CONTENTS, token, agentPort],
    refetchOnWindowFocus: false,
    retry: false,
  });

  const bookmarks = contentsQuery.data?.bookmarks ?? [];
  const selectedBookmarkNode = findBookmark(bookmarks, selectedBookmark);
  const expandedBookmarkNames = bookmarks
    .filter((bookmark) => expandedBookmarks.has(bookmark.name))
    .map((bookmark) => bookmark.name);
  const bookmarkNotesQueries = useQueries({
    queries: expandedBookmarkNames.map((bookmarkName) => ({
      enabled: Boolean(token && agentPort !== null),
      queryFn: ({ signal }) => agentClient.listNotes(agentPort ?? 0, token ?? "", bookmarkName, signal),
      queryKey: [QueryKey.NOTEBOOK_NOTES, token, agentPort, bookmarkName],
      refetchOnWindowFocus: false,
      retry: false,
    })),
  });
  const bookmarkNotesByName = new Map<string, BookmarkNotesState>(
    expandedBookmarkNames.map((bookmarkName, index) => {
      const query = bookmarkNotesQueries[index];
      return [
        bookmarkName,
        {
          error: query.error,
          isError: query.isError,
          isLoading: query.isLoading,
          notes: query.data?.notes ?? [],
          refetch: async () => query.refetch(),
        },
      ];
    })
  );
  const selectedBookmarkNotesState = selectedBookmark ? bookmarkNotesByName.get(selectedBookmark) ?? null : null;

  const noteQuery = useQuery({
    enabled: Boolean(token && agentPort !== null && selectedBookmark && selectedNoteName),
    queryFn: ({ signal }) =>
      agentClient.readNote(agentPort ?? 0, token ?? "", selectedBookmark ?? "", selectedNoteName ?? "", signal),
    queryKey: [QueryKey.NOTEBOOK_NOTE, token, agentPort, selectedBookmark, selectedNoteName],
    refetchOnWindowFocus: false,
    retry: false,
  });

  useEffect(() => {
    const currentBookmarks = contentsQuery.data?.bookmarks ?? [];
    if (currentBookmarks.length === 0) {
      setSelectedBookmark(null);
      return;
    }

    if (!findBookmark(currentBookmarks, selectedBookmark)) {
      setSelectedBookmark(currentBookmarks[0]?.name ?? null);
    }
  }, [contentsQuery.data?.bookmarks, selectedBookmark]);

  useEffect(() => {
    if (!selectedBookmark) {
      return;
    }

    setExpandedBookmarks((current) => {
      if (current.has(selectedBookmark)) {
        return current;
      }

      const next = new Set(current);
      next.add(selectedBookmark);
      return next;
    });
  }, [selectedBookmark]);

  useEffect(() => {
    const currentBookmarks = contentsQuery.data?.bookmarks ?? [];
    const bookmarkNames = new Set(currentBookmarks.map((bookmark) => bookmark.name));
    setExpandedBookmarks((current) => {
      let changed = false;
      const next = new Set<string>();
      for (const name of current) {
        if (bookmarkNames.has(name)) {
          next.add(name);
        } else {
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [contentsQuery.data?.bookmarks]);

  useEffect(() => {
    setSelectedNoteName(pendingSelectedNoteNameRef.current);
    setEditorText("");
    pendingSelectedNoteNameRef.current = null;
  }, [selectedBookmark]);

  useEffect(() => {
    setReminderDraft("");
  }, [selectedNoteName]);

  const openNote = useCallback(
    (bookmark: string, noteName: string): void => {
      setNoteNotice(null);
      if (bookmark === selectedBookmark) {
        setSelectedNoteName(noteName);
        return;
      }

      pendingSelectedNoteNameRef.current = noteName;
      setSelectedNoteName(null);
      setSelectedBookmark(bookmark);
      setEditorText("");
    },
    [selectedBookmark]
  );

  useEffect(() => {
    if (!pendingSelection) {
      return;
    }
    if (!contentsQuery.data) {
      return;
    }

    const target = pendingSelection;
    const bookmarkExists = (contentsQuery.data.bookmarks ?? []).some(
      (bookmark) => bookmark.name === target.bookmark
    );
    clearPendingSelection();
    if (bookmarkExists) {
      openNote(target.bookmark, target.name);
    }
  }, [clearPendingSelection, contentsQuery.data, openNote, pendingSelection]);

  useEffect(() => {
    // Initialise the toggle from the loaded note's real flags (keyed on note
    // identity, not selectedNoteName, so it runs once the new note's data lands
    // and does NOT collapse the open field on a same-note save-refetch).
    setReminderOpen(hasActiveReminder(noteQuery.data?.flags));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteQuery.data?.bookmark, noteQuery.data?.name]);

  useEffect(() => {
    if (!selectedBookmark || !selectedBookmarkNotesState) {
      return;
    }

    if (selectedBookmarkNotesState.isLoading || selectedBookmarkNotesState.isError) {
      return;
    }

    const notes = selectedBookmarkNotesState.notes;
    if (notes.length === 0) {
      setSelectedNoteName(null);
      return;
    }

    if (!notes.some((note) => note.name === selectedNoteName)) {
      setSelectedNoteName(notes[0]?.name ?? null);
    }
  }, [
    selectedBookmark,
    selectedBookmarkNotesState,
    selectedBookmarkNotesState?.isError,
    selectedBookmarkNotesState?.isLoading,
    selectedBookmarkNotesState?.notes,
    selectedNoteName,
  ]);

  useEffect(() => {
    if (noteQuery.data) {
      const draft = getNotebookNoteDraft({
        bookmark: noteQuery.data.bookmark,
        noteName: noteQuery.data.name,
        token,
      });
      if (draft === undefined) {
        setEditorText(noteQuery.data.text);
      } else if (draft === noteQuery.data.text) {
        clearNotebookNoteDraft({
          bookmark: noteQuery.data.bookmark,
          noteName: noteQuery.data.name,
          token,
        });
        setEditorText(noteQuery.data.text);
      } else {
        setEditorText(draft);
      }
      setReminderDraft(getReminderFlagValue(noteQuery.data.flags) ?? "");
    }
  }, [noteQuery.data, token]);

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
      if (selectedBookmark) {
        renameNotebookNoteDraftBookmark(token, selectedBookmark, name);
      }
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
      if (selectedBookmark) {
        clearNotebookNoteDraftsForBookmark(token, selectedBookmark);
      }
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
      clearNotebookNoteDraft({
        bookmark: response.bookmark,
        noteName: response.name,
        token,
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

      return agentClient.updateNote(agentPort, token, selectedBookmark, selectedNoteName, {
        bookmark: selectedBookmark,
        text,
      });
    },
    onSuccess: async (response) => {
      clearNotebookNoteDraft({
        bookmark: response.bookmark,
        noteName: response.name,
        token,
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

  const updateReminderMutation = useMutation({
    mutationFn: async (flags: Record<string, unknown>) => {
      if (!token || agentPort === null || !selectedBookmark || !selectedNoteName) {
        throw new Error("Select a note first.");
      }

      return agentClient.updateNote(agentPort, token, selectedBookmark, selectedNoteName, {
        bookmark: selectedBookmark,
        flags,
      });
    },
    onSuccess: async (response) => {
      setReminderDraft(getReminderFlagValue(response.flags) ?? "");
      await invalidateNotebookQueries(queryClient);
    },
    onError: (error) => {
      setNoteNotice({
        message: error instanceof Error ? error.message : "Unable to update the reminder.",
        status: "error",
      });
    },
  });

  const dismissReminderMutation = useMutation({
    mutationFn: async (reminder: NotebookReminder) => {
      if (!token || agentPort === null) {
        throw new Error("Authentication is required.");
      }

      const sourceNote =
        reminder.bookmark === selectedBookmark && reminder.name === selectedNoteName && noteQuery.data
          ? noteQuery.data
          : await agentClient.readNote(agentPort, token, reminder.bookmark, reminder.name);

      return agentClient.updateNote(agentPort, token, reminder.bookmark, reminder.name, {
        bookmark: reminder.bookmark,
        flags: dismissReminderFlags(sourceNote.flags, formatReminderValue(new Date())),
      });
    },
    onMutate: async (reminder) => {
      await queryClient.cancelQueries({ queryKey: [QueryKey.NOTEBOOK_REMINDERS, token, agentPort] });
      const previous = queryClient.getQueryData<NotebookRemindersResponse>([
        QueryKey.NOTEBOOK_REMINDERS,
        token,
        agentPort,
      ]);
      queryClient.setQueryData<NotebookRemindersResponse | undefined>(
        [QueryKey.NOTEBOOK_REMINDERS, token, agentPort],
        (current) =>
          current
            ? {
                ...current,
                reminders: current.reminders.filter(
                  (item) => item.bookmark !== reminder.bookmark || item.name !== reminder.name
                ),
              }
            : current
      );
      return { previous };
    },
    onSuccess: async (response) => {
      if (response.bookmark === selectedBookmark && response.name === selectedNoteName) {
        setReminderDraft(getReminderFlagValue(response.flags) ?? "");
      }
      await invalidateNotebookQueries(queryClient);
    },
    onError: (error, _reminder, context) => {
      if (context?.previous) {
        queryClient.setQueryData([QueryKey.NOTEBOOK_REMINDERS, token, agentPort], context.previous);
      }
      setNoteNotice({
        message: error instanceof Error ? error.message : "Unable to dismiss the reminder.",
        status: "error",
      });
    },
    onSettled: async () => {
      await invalidateNotebookQueries(queryClient);
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
      clearNotebookNoteDraft({
        bookmark: selectedBookmark,
        noteName: selectedNoteName,
        token,
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
      clearNotebookNoteDraft({
        bookmark: variables.sourceBookmark,
        noteName: variables.name,
        token,
      });
      clearNotebookNoteDraft({
        bookmark: response.bookmark,
        noteName: response.name,
        token,
      });
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

  const reorderBookmarksMutation = useMutation({
    mutationFn: async (names: string[]) => {
      if (!token || agentPort === null) {
        throw new Error("Authentication is required.");
      }

      return agentClient.reorderBookmarks(agentPort, token, names);
    },
    onMutate: async (names) => {
      await queryClient.cancelQueries({ queryKey: [QueryKey.NOTEBOOK_CONTENTS, token, agentPort] });
      const previous = queryClient.getQueryData<NotebookContentsResponse>([
        QueryKey.NOTEBOOK_CONTENTS,
        token,
        agentPort,
      ]);
      if (previous) {
        const byName = new Map(previous.bookmarks.map((b) => [b.name, b]));
        const reordered = names.map((name) => byName.get(name)).filter(Boolean) as NotebookBookmarkNode[];
        for (const b of previous.bookmarks) {
          if (!names.includes(b.name)) {
            reordered.push(b);
          }
        }
        queryClient.setQueryData<NotebookContentsResponse>(
          [QueryKey.NOTEBOOK_CONTENTS, token, agentPort],
          { bookmarks: reordered }
        );
      }
      return { previous };
    },
    onError: (_error, _names, context) => {
      if (context?.previous) {
        queryClient.setQueryData<NotebookContentsResponse>(
          [QueryKey.NOTEBOOK_CONTENTS, token, agentPort],
          context.previous
        );
      }
      setBookmarkNotice({
        message: "Unable to reorder bookmarks.",
        status: "error",
      });
    },
    onSettled: () => {
      setDraggedBookmarkName(null);
      setBookmarkDropIndex(null);
      void queryClient.invalidateQueries({ queryKey: [QueryKey.NOTEBOOK_CONTENTS] });
    },
  });

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

  const dueReminders = remindersQuery.dueReminders;
  const bookmarksWithReminders = new Set(remindersQuery.reminders.map((reminder) => reminder.bookmark));
  const hasAnyReminders = remindersQuery.reminders.length > 0;
  const reminderActionDisabled =
    companionUnavailable ||
    !selectedBookmark ||
    !selectedNoteName ||
    updateReminderMutation.isPending ||
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

  function handleEditorTextChange(value: string): void {
    setEditorText(value);
    if (!selectedBookmark || !selectedNoteName) {
      return;
    }

    const currentIdentity = {
      bookmark: selectedBookmark,
      noteName: selectedNoteName,
      token,
    };
    if (
      noteQuery.data &&
      noteQuery.data.bookmark === selectedBookmark &&
      noteQuery.data.name === selectedNoteName &&
      value === noteQuery.data.text
    ) {
      clearNotebookNoteDraft(currentIdentity);
      return;
    }

    setNotebookNoteDraft(currentIdentity, value);
  }

  function handleClearReminder(): void {
    if (!noteQuery.data) {
      return;
    }

    setNoteNotice(null);
    setReminderDraft("");
    updateReminderMutation.mutate(clearReminderFlags(noteQuery.data.flags));
  }

  function handleToggleReminder(): void {
    if (!noteQuery.data) {
      return;
    }

    setNoteNotice(null);
    if (reminderOpen) {
      setReminderOpen(false);
      handleClearReminder();
      return;
    }

    const value = reminderDraft.trim() || defaultReminderValue();
    setReminderDraft(value);
    setReminderOpen(true);
    updateReminderMutation.mutate(setReminderFlags(noteQuery.data.flags, value));
  }

  function handleReminderInputChange(value: string): void {
    setReminderDraft(value);
    if (!noteQuery.data || value.trim().length === 0) {
      return;
    }

    setNoteNotice(null);
    updateReminderMutation.mutate(setReminderFlags(noteQuery.data.flags, value.trim()));
  }

  function handleDismissReminder(reminder: NotebookReminder): void {
    setNoteNotice(null);
    dismissReminderMutation.mutate(reminder);
  }

  function toggleBookmarkExpanded(bookmarkName: string): void {
    setExpandedBookmarks((current) => {
      const next = new Set(current);
      if (next.has(bookmarkName)) {
        next.delete(bookmarkName);
      } else {
        next.add(bookmarkName);
      }
      return next;
    });
  }

  function handleBookmarkRowClick(bookmarkName: string): void {
    setSelectedBookmark(bookmarkName);
    setExpandedBookmarks((current) => {
      if (current.has(bookmarkName)) {
        return current;
      }

      const next = new Set(current);
      next.add(bookmarkName);
      return next;
    });
  }

  function handleBookmarkRowKeyDown(event: KeyboardEvent<HTMLDivElement>, bookmarkName: string): void {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    handleBookmarkRowClick(bookmarkName);
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

  function handleBookmarkDragOver(event: DragEvent<HTMLElement>, bookmarkName: string): void {
    if (draggedBookmarkName !== null) {
      handleBookmarkReorderDragOver(
        event,
        bookmarks.findIndex((bookmark) => bookmark.name === bookmarkName)
      );
      return;
    }

    if (!selectedBookmark || !draggedNoteName || selectedBookmark === bookmarkName || moveNoteMutation.isPending) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (dragOverBookmarkName !== bookmarkName) {
      setDragOverBookmarkName(bookmarkName);
    }
  }

  function handleBookmarkDrop(event: DragEvent<HTMLElement>, bookmarkName: string): void {
    if (draggedBookmarkName !== null) {
      handleBookmarkReorderDrop(event);
      return;
    }

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
      text: getNotebookNoteDraft({
        bookmark: selectedBookmark,
        noteName: draggedNoteName,
        token,
      }),
    });
  }

  function handleBookmarkReorderDragStart(event: DragEvent<HTMLElement>, bookmarkName: string): void {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-bookmark-reorder", bookmarkName);
    setDraggedBookmarkName(bookmarkName);
    setBookmarkDropIndex(null);
  }

  function handleBookmarkReorderDragEnd(): void {
    setDraggedBookmarkName(null);
    setBookmarkDropIndex(null);
  }

  function handleBookmarkReorderDragOver(event: DragEvent<HTMLElement>, bookmarkIndex: number): void {
    if (draggedBookmarkName === null || bookmarkIndex < 0) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const dropIndex = event.clientY <= rect.top + rect.height / 2 ? bookmarkIndex : bookmarkIndex + 1;

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (bookmarkDropIndex !== dropIndex) {
      setBookmarkDropIndex(dropIndex);
    }
  }

  function handleBookmarkReorderDrop(event: DragEvent<HTMLElement>): void {
    event.preventDefault();

    if (draggedBookmarkName === null || bookmarkDropIndex === null || reorderBookmarksMutation.isPending) {
      setDraggedBookmarkName(null);
      setBookmarkDropIndex(null);
      return;
    }

    const currentIndex = bookmarks.findIndex((bookmark) => bookmark.name === draggedBookmarkName);
    if (currentIndex < 0) {
      setDraggedBookmarkName(null);
      setBookmarkDropIndex(null);
      return;
    }

    const reordered = [...bookmarks];
    const [draggedBookmark] = reordered.splice(currentIndex, 1);
    const insertIndex = currentIndex < bookmarkDropIndex ? bookmarkDropIndex - 1 : bookmarkDropIndex;
    reordered.splice(insertIndex, 0, draggedBookmark);

    const newOrder = reordered.map((bookmark) => bookmark.name);
    const existingOrder = bookmarks.map((bookmark) => bookmark.name);
    if (newOrder.every((name, index) => name === existingOrder[index])) {
      setDraggedBookmarkName(null);
      setBookmarkDropIndex(null);
      return;
    }

    reorderBookmarksMutation.mutate(newOrder);
    setDraggedBookmarkName(null);
    setBookmarkDropIndex(null);
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

      {dueReminders.length > 0 ? (
        <NotebookSurface title={NOTEBOOK_BROWSE_COPY.REMINDER_TITLE}>
          <Stack gap="sm">
            {dueReminders.map((reminder) => (
              <Group
                align="flex-start"
                justify="space-between"
                key={reminder.bookmark + "::" + reminder.name + "::" + reminder.remindAt}
                wrap="nowrap"
              >
                <Button
                  fullWidth
                  justify="flex-start"
                  onClick={() => openNote(reminder.bookmark, reminder.name)}
                  style={{ height: "auto", paddingBlock: "0.75rem" }}
                  styles={{ label: { whiteSpace: "normal", width: "100%" } }}
                  variant="light"
                >
                  <Stack gap={4} w="100%">
                    <Text fw={600}>{reminder.name}</Text>
                    <Text c="dimmed" size="sm">
                      {reminder.bookmark}
                    </Text>
                    <Text c="dimmed" size="sm">
                      {formatReminder(reminder.remindAt)}
                    </Text>
                    <Text size="sm">
                      {reminder.previewLines[0] ?? NOTEBOOK_BROWSE_COPY.REMINDER_EMPTY}
                    </Text>
                  </Stack>
                </Button>
                <Button onClick={() => handleDismissReminder(reminder)} variant="light">
                  {NOTEBOOK_BROWSE_COPY.REMINDER_DISMISS}
                </Button>
              </Group>
            ))}
          </Stack>
        </NotebookSurface>
      ) : null}
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
        <Grid columns={15}>
          <Grid.Col span={{ base: 15, md: 5, lg: 4 }}>
            <NotebookSurface>
              <Stack gap="md">
                <Group gap="xs" wrap="wrap">
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
                  {hasAnyReminders ? (
                    <Tooltip
                      label={
                        remindersFilter
                          ? NOTEBOOK_BROWSE_COPY.NOTE_FILTER_ALL
                          : NOTEBOOK_BROWSE_COPY.NOTE_FILTER_REMINDERS
                      }
                    >
                      <ActionIcon
                        aria-label={
                          remindersFilter
                            ? NOTEBOOK_BROWSE_COPY.NOTE_FILTER_ALL
                            : NOTEBOOK_BROWSE_COPY.NOTE_FILTER_REMINDERS
                        }
                        color={remindersFilter ? "yellow" : "gray"}
                        onClick={() => setRemindersFilter((value) => !value)}
                        size="lg"
                        variant={remindersFilter ? "filled" : "light"}
                      >
                        {remindersFilter ? <IconFilterFilled size={18} /> : <IconFilter size={18} />}
                      </ActionIcon>
                    </Tooltip>
                  ) : null}
                </Group>

                <NotebookNoticeAlert notice={bookmarkNotice} />
                <NotebookNoticeAlert notice={noteNotice} />

                {bookmarks.length > 0 ? (
                  <Stack gap="xs">
                    {bookmarks.map((bookmark, index) => {
                      const isExpanded = expandedBookmarks.has(bookmark.name);
                      const notesState = bookmarkNotesByName.get(bookmark.name);
                      const visibleNotes =
                        remindersFilter && notesState
                          ? notesState.notes.filter((note) => hasActiveReminder(note.flags))
                          : (notesState?.notes ?? []);
                      const isDropTarget =
                        draggedNoteName !== null &&
                        dragOverBookmarkName === bookmark.name &&
                        selectedBookmark !== bookmark.name;
                      const showReorderIndicator =
                        bookmarkDropIndex === index &&
                        draggedBookmarkName !== null &&
                        draggedBookmarkName !== bookmark.name;
                      const bookmarkDraggable =
                        !moveNoteMutation.isPending && !reorderBookmarksMutation.isPending;

                      return (
                        <div key={bookmark.name}>
                          {showReorderIndicator ? (
                            <div
                              style={{
                                background: "var(--mantine-color-blue-5)",
                                borderRadius: "1px",
                                height: "2px",
                              }}
                            />
                          ) : null}
                          <Box
                            aria-current={selectedBookmark === bookmark.name ? "page" : undefined}
                            draggable={bookmarkDraggable}
                            onClick={() => handleBookmarkRowClick(bookmark.name)}
                            onDragEnd={handleBookmarkReorderDragEnd}
                            onDragOver={(event) => handleBookmarkDragOver(event, bookmark.name)}
                            onDragStart={(event) => handleBookmarkReorderDragStart(event, bookmark.name)}
                            onDrop={(event) => handleBookmarkDrop(event, bookmark.name)}
                            onKeyDown={(event) => handleBookmarkRowKeyDown(event, bookmark.name)}
                            role="button"
                            style={{
                              ...buildBookmarkRowStyle(selectedBookmark === bookmark.name, palette),
                              cursor: bookmarkDraggable ? "grab" : "default",
                              ...(isDropTarget
                                ? {
                                    outline: "2px dashed var(--mantine-color-blue-5)",
                                    outlineOffset: 2,
                                  }
                                : {}),
                            }}
                            tabIndex={0}
                          >
                            <ActionIcon
                              aria-label={isExpanded ? `Collapse ${bookmark.name}` : `Expand ${bookmark.name}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedBookmark(bookmark.name);
                                toggleBookmarkExpanded(bookmark.name);
                              }}
                              size="md"
                              variant="subtle"
                            >
                              {isExpanded ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
                            </ActionIcon>
                            <Group gap={8} style={{ flex: 1, minWidth: 0 }} wrap="nowrap">
                              <Group gap={8} style={{ flex: 1, minWidth: 0 }} wrap="nowrap">
                                <IconFolder size={16} style={{ flexShrink: 0 }} />
                                <Text c="inherit" fw={selectedBookmark === bookmark.name ? 600 : 500} truncate>
                                  {bookmark.name}
                                </Text>
                                {bookmarksWithReminders.has(bookmark.name) ? (
                                  <Tooltip label={NOTEBOOK_BROWSE_COPY.BOOKMARK_REMINDER_HINT}>
                                    <IconBell
                                      aria-label={NOTEBOOK_BROWSE_COPY.BOOKMARK_REMINDER_HINT}
                                      color="var(--mantine-color-yellow-6)"
                                      size={14}
                                      style={{ flexShrink: 0 }}
                                    />
                                  </Tooltip>
                                ) : null}
                              </Group>
                              <Text c="inherit" ml="auto" size="sm">
                                {bookmark.noteCount}
                              </Text>
                            </Group>
                          </Box>

                          <Collapse in={isExpanded}>
                            <Box ml="md" mt="xs" pl="md" style={{ borderLeft: `1px solid ${palette.line}` }}>
                              <Stack gap={6}>
                                {notesState?.isLoading ? (
                                  <Group c="dimmed" gap="xs" wrap="nowrap">
                                    <Loader size="xs" />
                                    <Text size="sm">{NOTEBOOK_BROWSE_COPY.NOTE_FOLDER_LOADING}</Text>
                                  </Group>
                                ) : null}
                                {notesState?.isError ? (
                                  <NotebookErrorAlert
                                    error={notesState.error}
                                    fallback={NOTEBOOK_BROWSE_COPY.NOTE_LOAD_FALLBACK}
                                    onRetry={() => void notesState.refetch()}
                                    title={NOTEBOOK_BROWSE_COPY.NOTE_LOAD_ERROR}
                                  />
                                ) : null}
                                {!notesState?.isLoading && !notesState?.isError && visibleNotes.length === 0 ? (
                                  <Text c="dimmed" size="sm">
                                    {NOTEBOOK_BROWSE_COPY.NOTE_LEAF_EMPTY}
                                  </Text>
                                ) : null}
                                {!notesState?.isLoading && !notesState?.isError
                                  ? visibleNotes.map((note) => {
                                      const previewLine = buildNotePreviewLine(note.previewLines, note.name);
                                      const isSelected =
                                        selectedBookmark === bookmark.name && selectedNoteName === note.name;

                                      return (
                                        <Tooltip key={note.name} label={buildPreviewText(note.previewLines)} multiline>
                                          <UnstyledButton
                                            aria-current={isSelected ? "page" : undefined}
                                            draggable={!moveNoteMutation.isPending}
                                            onClick={() => openNote(bookmark.name, note.name)}
                                            onDragEnd={handleNoteDragEnd}
                                            onDragStart={(event) => handleNoteDragStart(event, note.name)}
                                            style={{
                                              ...buildNoteRowStyle(isSelected, palette),
                                              cursor: moveNoteMutation.isPending ? "default" : "grab",
                                            }}
                                          >
                                            <Group gap="xs" style={{ minWidth: 0 }} wrap="nowrap">
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
                                              <Text c="inherit" size="sm" truncate>
                                                {previewLine}
                                              </Text>
                                            </Group>
                                            {hasActiveReminder(note.flags) ? (
                                              <span aria-label={NOTEBOOK_BROWSE_COPY.BOOKMARK_REMINDER_HINT}>
                                                <IconBell
                                                  color="var(--mantine-color-yellow-6)"
                                                  size={14}
                                                  style={{ flexShrink: 0 }}
                                                />
                                              </span>
                                            ) : null}
                                          </UnstyledButton>
                                        </Tooltip>
                                      );
                                    })
                                  : null}
                              </Stack>
                            </Box>
                          </Collapse>

                          {bookmarkDropIndex === bookmarks.length &&
                          index === bookmarks.length - 1 &&
                          draggedBookmarkName !== null ? (
                            <div
                              style={{
                                background: "var(--mantine-color-blue-5)",
                                borderRadius: "1px",
                                height: "2px",
                              }}
                            />
                          ) : null}
                        </div>
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

          <Grid.Col span={{ base: 15, md: 10, lg: 11 }}>
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
              onTextChange={handleEditorTextChange}
              reminderControl={
                selectedNoteName ? (
                  <>
                    <Tooltip
                      label={
                        reminderOpen
                          ? NOTEBOOK_BROWSE_COPY.NOTE_REMINDER_CLEAR
                          : NOTEBOOK_BROWSE_COPY.NOTE_REMINDER_SET
                      }
                    >
                      <ActionIcon
                        aria-label={
                          reminderOpen
                            ? NOTEBOOK_BROWSE_COPY.NOTE_REMINDER_CLEAR
                            : NOTEBOOK_BROWSE_COPY.NOTE_REMINDER_SET
                        }
                        color={reminderOpen ? "yellow" : "gray"}
                        disabled={reminderActionDisabled}
                        loading={updateReminderMutation.isPending}
                        onClick={handleToggleReminder}
                        variant={reminderOpen ? "filled" : "subtle"}
                      >
                        {reminderOpen ? <IconBellRinging size={18} /> : <IconBell size={18} />}
                      </ActionIcon>
                    </Tooltip>
                    {reminderOpen ? (
                      <TextInput
                        aria-label={NOTEBOOK_BROWSE_COPY.NOTE_REMINDER_LABEL}
                        onChange={(event) => handleReminderInputChange(event.currentTarget.value)}
                        size="xs"
                        type="datetime-local"
                        value={reminderDraft}
                        w={210}
                      />
                    ) : null}
                  </>
                ) : null
              }
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
