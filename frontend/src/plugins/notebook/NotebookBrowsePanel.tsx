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
import {
  IconBell,
  IconBellRinging,
  IconFilter,
  IconFilterFilled,
  IconNote,
  IconPencil,
  IconPlus,
  IconRotateClockwise,
  IconTrash,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

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
  NOTE_REMINDER_CLEAR: "Clear reminder",
  NOTE_REMINDER_LABEL: "Reminder",
  NOTE_REMINDER_SET: "Set reminder",
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


function findBookmark(bookmarks: NotebookBookmarkNode[], bookmarkName: string | null): NotebookBookmarkNode | null {
  if (!bookmarkName) {
    return null;
  }

  for (const bookmark of bookmarks) {
    if (bookmark.name === bookmarkName) {
      return bookmark;
    }

    const childMatch = findBookmark(bookmark.children, bookmarkName);
    if (childMatch) {
      return childMatch;
    }
  }

  return null;
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

    if (!findBookmark(bookmarks, selectedBookmark)) {
      setSelectedBookmark(bookmarks[0]?.name ?? null);
    }
  }, [contentsQuery.data?.bookmarks, selectedBookmark]);

  useEffect(() => {
    setSelectedNoteName(pendingSelectedNoteNameRef.current);
    setEditorText("");
    setRemindersFilter(false);
    pendingSelectedNoteNameRef.current = null;
  }, [selectedBookmark]);
  useEffect(() => {
    setReminderDraft("");
  }, [selectedNoteName]);
  useEffect(() => {
    // Initialise the toggle from the loaded note's real flags (keyed on note
    // identity, not selectedNoteName, so it runs once the new note's data lands
    // and does NOT collapse the open field on a same-note save-refetch).
    setReminderOpen(hasActiveReminder(noteQuery.data?.flags));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteQuery.data?.bookmark, noteQuery.data?.name]);

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

  const dueReminders = remindersQuery.dueReminders;
  const bookmarksWithReminders = new Set(remindersQuery.reminders.map((reminder) => reminder.bookmark));
  const bookmarkHasReminders = notes.some((note) => hasActiveReminder(note.flags));
  const displayedNotes =
    remindersFilter && bookmarkHasReminders ? notes.filter((note) => hasActiveReminder(note.flags)) : notes;
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

  function openNote(bookmark: string, noteName: string): void {
    setNoteNotice(null);
    if (bookmark === selectedBookmark) {
      setSelectedNoteName(noteName);
      return;
    }

    pendingSelectedNoteNameRef.current = noteName;
    setSelectedNoteName(null);
    setSelectedBookmark(bookmark);
    setEditorText("");
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
    if (draggedBookmarkName !== null) {
      handleBookmarkReorderDragOver(
        event,
        (contentsQuery.data?.bookmarks ?? []).findIndex((bookmark) => bookmark.name === bookmarkName)
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

  function handleBookmarkDrop(event: DragEvent<HTMLButtonElement>, bookmarkName: string): void {
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

  function handleBookmarkReorderDragStart(event: DragEvent<HTMLButtonElement>, bookmarkName: string): void {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-bookmark-reorder", bookmarkName);
    setDraggedBookmarkName(bookmarkName);
    setBookmarkDropIndex(null);
  }

  function handleBookmarkReorderDragEnd(): void {
    setDraggedBookmarkName(null);
    setBookmarkDropIndex(null);
  }

  function handleBookmarkReorderDragOver(event: DragEvent<HTMLButtonElement>, bookmarkIndex: number): void {
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

  function handleBookmarkReorderDrop(event: DragEvent<HTMLButtonElement>): void {
    event.preventDefault();

    const bookmarks = contentsQuery.data?.bookmarks ?? [];
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
                    {contentsQuery.data.bookmarks.map((bookmark, index, bookmarks) => {
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
                          <Button
                            draggable={bookmarkDraggable}
                            fullWidth
                            onClick={() => setSelectedBookmark(bookmark.name)}
                            onDragEnd={handleBookmarkReorderDragEnd}
                            onDragOver={(event) => handleBookmarkDragOver(event, bookmark.name)}
                            onDragStart={(event) => handleBookmarkReorderDragStart(event, bookmark.name)}
                            onDrop={(event) => handleBookmarkDrop(event, bookmark.name)}
                            style={{
                              ...(isDropTarget
                                ? {
                                    outline: "2px dashed var(--mantine-color-blue-5)",
                                    outlineOffset: 2,
                                  }
                                : {}),
                              cursor: bookmarkDraggable ? "grab" : "default",
                            }}
                            variant={selectedBookmark === bookmark.name ? "filled" : "light"}
                          >
                            <Group justify="space-between" w="100%" wrap="nowrap">
                              <Group gap={6} wrap="nowrap">
                                <span>{bookmark.name}</span>
                                {bookmarksWithReminders.has(bookmark.name) ? (
                                  <Tooltip label={NOTEBOOK_BROWSE_COPY.BOOKMARK_REMINDER_HINT}>
                                    <IconBell
                                      aria-label={NOTEBOOK_BROWSE_COPY.BOOKMARK_REMINDER_HINT}
                                      color="var(--mantine-color-yellow-6)"
                                      size={14}
                                    />
                                  </Tooltip>
                                ) : null}
                              </Group>
                              <span>{bookmark.noteCount}</span>
                            </Group>
                          </Button>
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

          <Grid.Col span={{ base: 12, lg: 2, md: 3 }}>
            <NotebookSurface title="Notes">
              <NotebookNoticeAlert notice={noteNotice} />
              <Group gap="xs" justify="space-between" wrap="nowrap">
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
                {bookmarkHasReminders ? (
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
                  {displayedNotes.map((note) => {
                    const isSelected = selectedNoteName === note.name;
                    const noteHasReminder = hasActiveReminder(note.flags);
                    const noteReminder = getReminderFlagValue(note.flags);

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
                          {noteHasReminder && noteReminder ? (
                            <>
                              <IconBell
                                size={12}
                                style={{ display: "inline-block", marginRight: 4, verticalAlign: "text-bottom" }}
                              />
                              {formatReminder(noteReminder)}
                              {"\n"}
                            </>
                          ) : null}
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
