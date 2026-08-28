import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const agentClientMock = vi.hoisted(() => ({
  createBookmark: vi.fn(),
  deleteBookmark: vi.fn(),
  deleteNote: vi.fn(),
  getNotebookReminders: vi.fn(),
  getNotebookTree: vi.fn(),
  listNotes: vi.fn(),
  readNote: vi.fn(),
  reorderBookmarks: vi.fn(),
  renameBookmark: vi.fn(),
  searchNotes: vi.fn(),
  updateNote: vi.fn(),
  writeNote: vi.fn(),
}));

const getPreflightMock = vi.hoisted(() => vi.fn());

vi.mock("@/api/agentClient", async () => {
  const actual = await vi.importActual<typeof import("@/api/agentClient")>("@/api/agentClient");
  return {
    ...actual,
    agentClient: {
      ...actual.agentClient,
      ...agentClientMock,
    },
    getPreflight: getPreflightMock,
  };
});

import { AgentRequestError } from "@/api/agentClient";
import { PluginId } from "@/constants";
import { NotebookBrowsePanel } from "@/plugins/notebook/NotebookBrowsePanel";
import { clearNotebookNoteDrafts } from "@/plugins/notebook/notebookDrafts";
import { renderWithProviders } from "@/test/render";
import { resetAuthStoreState, useAuthStore } from "@/store/authStore";

const TOKEN = "token-123" as const;
const PORT = 47600 as const;
const BOOKMARK = "Research" as const;
const NOTE_NAME = "2026-08-25-14-30-05" as const;

describe("NotebookBrowsePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearNotebookNoteDrafts();
    agentClientMock.getNotebookReminders.mockResolvedValue({ reminders: [] });
    localStorage.clear();
    resetAuthStoreState();

    useAuthStore.setState({
      currentUser: {
        auto_login: false,
        created_at: "2026-08-26T00:00:00Z",
        display_name: "Test User",
        enabled_plugins: [PluginId.NOTEBOOK],
        id: 2,
        is_admin: false,
        updated_at: "2026-08-26T00:00:00Z",
        username: "test",
      },
      token: TOKEN,
    });

    getPreflightMock.mockResolvedValue({
      agent: {
        app: "qaa-tms-agent",
        os: "linux",
        stagingsInstalled: true,
        stagingsSha: "abc123",
        version: "0.1.0",
      },
      checklist: [],
      detected: true,
      port: PORT,
    });
  });

  it("loads the first bookmark, renders notes, and saves note edits through the agent client", async () => {
    const user = userEvent.setup();
    const SECOND_NOTE_NAME = "2026-08-25-15-45-10";

    agentClientMock.getNotebookTree.mockResolvedValue({
      bookmarks: [
        {
          children: [],
          flags: {},
          name: BOOKMARK,
          noteCount: 1,
        },
        {
          children: [],
          flags: {},
          name: "Ops",
          noteCount: 0,
        },
      ],
    });

    agentClientMock.listNotes.mockResolvedValue({
      bookmark: BOOKMARK,
      notes: [
        {
          flags: {},
          name: NOTE_NAME,
          previewLines: ["First line", "Second line"],
        },
        {
          flags: {},
          name: SECOND_NOTE_NAME,
          previewLines: ["Other preview", "Second note"],
        },
      ],
    });

    agentClientMock.readNote.mockImplementation((_port, _token, _bookmark, noteName) => {
      if (noteName === SECOND_NOTE_NAME) {
        return {
          bookmark: BOOKMARK,
          flags: {},
          name: SECOND_NOTE_NAME,
          previewLines: ["Other preview", "Second note"],
          text: "Other preview\nSecond note",
        };
      }

      return {
        bookmark: BOOKMARK,
        flags: {},
        name: NOTE_NAME,
        previewLines: ["First line", "Second line"],
        text: "First line\nSecond line",
      };
    });

    agentClientMock.updateNote.mockResolvedValue({
      bookmark: BOOKMARK,
      flags: {},
      name: SECOND_NOTE_NAME,
      previewLines: ["Updated line"],
      text: "Updated line",
    });

    renderWithProviders(<NotebookBrowsePanel />);

    expect(await screen.findByRole("button", { name: /Research/i })).toBeInTheDocument();
    expect(await screen.findByText(NOTE_NAME)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Other preview/i })).toBeInTheDocument();

    const textarea = await screen.findByLabelText("Notebook note body");
    expect(textarea).toHaveValue("First line\nSecond line");

    await user.click(screen.getByRole("button", { name: /Other preview/i }));

    await waitFor(() => {
      expect(agentClientMock.readNote).toHaveBeenCalledWith(PORT, TOKEN, BOOKMARK, SECOND_NOTE_NAME, expect.anything());
    });

    expect(await screen.findByText(SECOND_NOTE_NAME)).toBeInTheDocument();

    const selectedTextarea = await screen.findByLabelText("Notebook note body");
    expect(selectedTextarea).toHaveValue("Other preview\nSecond note");

    await user.clear(selectedTextarea);
    await user.type(selectedTextarea, "Updated line");
    await user.click(screen.getByRole("button", { name: "Save note" }));

    await waitFor(() => {
      expect(agentClientMock.updateNote).toHaveBeenCalledWith(PORT, TOKEN, BOOKMARK, SECOND_NOTE_NAME, {
        bookmark: BOOKMARK,
        text: "Updated line",
      });
    });
  });

  it("keeps an unsaved draft when switching between notes", async () => {
    const user = userEvent.setup();
    const SECOND_NOTE_NAME = "2026-08-25-15-45-10";

    agentClientMock.getNotebookTree.mockResolvedValue({
      bookmarks: [
        {
          children: [],
          flags: {},
          name: BOOKMARK,
          noteCount: 2,
        },
      ],
    });
    agentClientMock.listNotes.mockResolvedValue({
      bookmark: BOOKMARK,
      notes: [
        {
          flags: {},
          name: NOTE_NAME,
          previewLines: ["First line"],
        },
        {
          flags: {},
          name: SECOND_NOTE_NAME,
          previewLines: ["Second line"],
        },
      ],
    });
    agentClientMock.readNote.mockImplementation((_port, _token, _bookmark, noteName) => {
      if (noteName === SECOND_NOTE_NAME) {
        return {
          bookmark: BOOKMARK,
          flags: {},
          name: SECOND_NOTE_NAME,
          previewLines: ["Second line"],
          text: "Second line",
        };
      }

      return {
        bookmark: BOOKMARK,
        flags: {},
        name: NOTE_NAME,
        previewLines: ["First line"],
        text: "First line",
      };
    });

    renderWithProviders(<NotebookBrowsePanel />);

    const textarea = await screen.findByLabelText("Notebook note body");
    await user.type(textarea, "\nUnsaved draft");
    expect(textarea).toHaveValue("First line\nUnsaved draft");

    await user.click(screen.getByRole("button", { name: /Second line/i }));
    await waitFor(() => {
      expect(screen.getByLabelText("Notebook note body")).toHaveValue("Second line");
    });

    await user.click(screen.getByRole("button", { name: /First line/i }));
    await waitFor(() => {
      expect(screen.getByLabelText("Notebook note body")).toHaveValue("First line\nUnsaved draft");
    });
  });

  it("keeps an unsaved draft after the notebook panel remounts", async () => {
    const user = userEvent.setup();

    agentClientMock.getNotebookTree.mockResolvedValue({
      bookmarks: [
        {
          children: [],
          flags: {},
          name: BOOKMARK,
          noteCount: 1,
        },
      ],
    });
    agentClientMock.listNotes.mockResolvedValue({
      bookmark: BOOKMARK,
      notes: [
        {
          flags: {},
          name: NOTE_NAME,
          previewLines: ["First line"],
        },
      ],
    });
    agentClientMock.readNote.mockResolvedValue({
      bookmark: BOOKMARK,
      flags: {},
      name: NOTE_NAME,
      previewLines: ["First line"],
      text: "First line",
    });

    const firstRender = renderWithProviders(<NotebookBrowsePanel />);
    const textarea = await screen.findByLabelText("Notebook note body");
    await user.type(textarea, "\nUnsaved draft");
    expect(textarea).toHaveValue("First line\nUnsaved draft");

    firstRender.unmount();

    renderWithProviders(<NotebookBrowsePanel />);

    await waitFor(() => {
      expect(screen.getByLabelText("Notebook note body")).toHaveValue("First line\nUnsaved draft");
    });
  });

  it("moves a note to another bookmark through drag and drop", async () => {
    agentClientMock.getNotebookTree.mockResolvedValue({
      bookmarks: [
        {
          children: [],
          flags: {},
          name: BOOKMARK,
          noteCount: 1,
        },
        {
          children: [],
          flags: {},
          name: "Ops",
          noteCount: 1,
        },
      ],
    });

    agentClientMock.listNotes.mockImplementation((_port, _token, bookmark) => {
      if (bookmark === "Ops") {
        return {
          bookmark: "Ops",
          notes: [
            {
              flags: {},
              name: NOTE_NAME,
              previewLines: ["Moved line"],
            },
          ],
        };
      }

      return {
        bookmark: BOOKMARK,
        notes: [
          {
            flags: {},
            name: NOTE_NAME,
            previewLines: ["Drag me"],
          },
        ],
      };
    });

    agentClientMock.readNote.mockResolvedValue({
      bookmark: BOOKMARK,
      flags: {},
      name: NOTE_NAME,
      previewLines: ["Drag me"],
      text: "Drag me",
    });

    agentClientMock.updateNote.mockResolvedValue({
      bookmark: "Ops",
      flags: {},
      name: NOTE_NAME,
      previewLines: ["Drag me"],
      text: "Drag me",
    });

    renderWithProviders(<NotebookBrowsePanel />);

    const noteButton = await screen.findByRole("button", { name: /Drag me/i });
    const targetBookmarkButton = await screen.findByRole("button", { name: /Ops/i });
    const dataTransfer = {
      dropEffect: "none",
      effectAllowed: "all",
      getData: vi.fn(),
      setData: vi.fn(),
    };

    fireEvent.dragStart(noteButton, { dataTransfer });
    fireEvent.dragOver(targetBookmarkButton, { dataTransfer });
    fireEvent.drop(targetBookmarkButton, { dataTransfer });

    await waitFor(() => {
      expect(agentClientMock.updateNote).toHaveBeenCalledWith(PORT, TOKEN, BOOKMARK, NOTE_NAME, {
        bookmark: "Ops",
        text: undefined,
      });
    });
  });

  it("reorders bookmarks through drag and drop", async () => {
    agentClientMock.getNotebookTree.mockResolvedValue({
      bookmarks: [
        { children: [], flags: {}, name: "Alpha", noteCount: 0 },
        { children: [], flags: {}, name: "Beta", noteCount: 0 },
        { children: [], flags: {}, name: "Gamma", noteCount: 0 },
      ],
    });
    agentClientMock.listNotes.mockResolvedValue({ bookmark: "Alpha", notes: [] });
    agentClientMock.reorderBookmarks.mockResolvedValue({
      bookmarks: [
        { children: [], flags: {}, name: "Gamma", noteCount: 0 },
        { children: [], flags: {}, name: "Alpha", noteCount: 0 },
        { children: [], flags: {}, name: "Beta", noteCount: 0 },
      ],
    });

    renderWithProviders(<NotebookBrowsePanel />);

    const gammaButton = await screen.findByRole("button", { name: /Gamma/i });
    const alphaButton = await screen.findByRole("button", { name: /Alpha/i });
    vi.spyOn(alphaButton, "getBoundingClientRect").mockReturnValue({
      bottom: 40,
      height: 40,
      left: 0,
      right: 100,
      top: 0,
      width: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const dataTransfer = {
      dropEffect: "none",
      effectAllowed: "all",
      getData: vi.fn().mockReturnValue("Gamma"),
      setData: vi.fn(),
      types: ["application/x-bookmark-reorder"],
    };

    fireEvent.dragStart(gammaButton, { dataTransfer });
    fireEvent.dragOver(alphaButton, { clientY: 5, dataTransfer });
    fireEvent.drop(alphaButton, { dataTransfer });

    await waitFor(() => {
      expect(agentClientMock.reorderBookmarks).toHaveBeenCalledWith(PORT, TOKEN, ["Alpha", "Gamma", "Beta"]);
    });
  });

  it("falls back to copy-delete move for an older companion agent", async () => {
    const user = userEvent.setup();
    const bookmarks = [
      {
        children: [],
        flags: {},
        name: BOOKMARK,
        noteCount: 1,
      },
      {
        children: [],
        flags: {},
        name: "Ops",
        noteCount: 0,
      },
    ];
    const notesByBookmark = {
      Ops: [] as Array<{ flags: Record<string, unknown>; name: string; previewLines: string[] }>,
      [BOOKMARK]: [
        {
          flags: { important: true },
          name: NOTE_NAME,
          previewLines: ["Drag me"],
        },
      ],
    };

    agentClientMock.getNotebookTree.mockImplementation(() => ({
      bookmarks: bookmarks.map((bookmark) => ({ ...bookmark })),
    }));

    agentClientMock.listNotes.mockImplementation((_port: number, _token: string, bookmark: string) => ({
      bookmark,
      notes: [...(notesByBookmark[bookmark as keyof typeof notesByBookmark] ?? [])],
    }));

    agentClientMock.readNote.mockImplementation(
      (_port: number, _token: string, bookmark: string, name: string) => ({
        bookmark,
        flags: { important: true },
        name,
        previewLines: ["Drag me"],
        text: "Drag me",
      })
    );

    agentClientMock.updateNote.mockRejectedValue(new AgentRequestError("No note changes requested.", 400));
    agentClientMock.writeNote.mockImplementation(
      (_port: number, _token: string, payload: { name?: string; text: string }) => {
      bookmarks[0].noteCount = 0;
      bookmarks[1].noteCount = 1;
      notesByBookmark["Ops"] = [
        {
          flags: { important: true },
          name: payload.name ?? NOTE_NAME,
          previewLines: ["Drag me"],
        },
      ];
      return {
        bookmark: "Ops",
        flags: { important: true },
        name: payload.name ?? NOTE_NAME,
        previewLines: ["Drag me"],
        text: payload.text,
      };
      }
    );
    agentClientMock.deleteNote.mockImplementation(() => {
      bookmarks[0].noteCount = 0;
      notesByBookmark[BOOKMARK] = [];
      return Promise.reject(new TypeError("Failed to fetch"));
    });

    renderWithProviders(<NotebookBrowsePanel />);

    const noteButton = await screen.findByRole("button", { name: /Drag me/i });
    const targetBookmarkButton = await screen.findByRole("button", { name: /Ops/i });
    const dataTransfer = {
      dropEffect: "none",
      effectAllowed: "all",
      getData: vi.fn(),
      setData: vi.fn(),
    };

    fireEvent.dragStart(noteButton, { dataTransfer });
    fireEvent.dragOver(targetBookmarkButton, { dataTransfer });
    fireEvent.drop(targetBookmarkButton, { dataTransfer });

    await waitFor(() => {
      expect(agentClientMock.writeNote).toHaveBeenCalledWith(PORT, TOKEN, {
        bookmark: "Ops",
        flags: { important: true },
        name: NOTE_NAME,
        text: "Drag me",
      });
    });

    await user.click(screen.getByRole("button", { name: /^Research\s*0$/i }));
    expect(screen.queryByRole("button", { name: /Drag me/i })).not.toBeInTheDocument();
    expect(screen.getByText("No notes were returned for the selected bookmark.")).toBeInTheDocument();
  });

  it("deletes the selected note and shows the empty state", async () => {
    const user = userEvent.setup();

    agentClientMock.getNotebookTree.mockResolvedValue({
      bookmarks: [
        {
          children: [],
          flags: {},
          name: BOOKMARK,
          noteCount: 1,
        },
      ],
    });

    let deleted = false;

    agentClientMock.listNotes.mockImplementation(() => ({
      bookmark: BOOKMARK,
      notes: deleted
        ? []
        : [
            {
              flags: {},
              name: NOTE_NAME,
              previewLines: ["Delete me"],
            },
          ],
    }));

    agentClientMock.readNote.mockResolvedValue({
      bookmark: BOOKMARK,
      flags: {},
      name: NOTE_NAME,
      previewLines: ["Delete me"],
      text: "Delete me",
    });

    agentClientMock.deleteNote.mockImplementation(() => {
      deleted = true;
      return Promise.resolve({ bookmark: BOOKMARK, notes: [] });
    });

    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderWithProviders(<NotebookBrowsePanel />);

    await screen.findByRole("button", { name: /Delete me/i });
    await screen.findByLabelText("Notebook note body");
    await user.click(screen.getByRole("button", { name: "Delete note" }));

    await waitFor(() => {
      expect(agentClientMock.deleteNote).toHaveBeenCalledWith(PORT, TOKEN, BOOKMARK, NOTE_NAME);
    });

    await waitFor(() => {
      expect(screen.getByText("No notes were returned for the selected bookmark.")).toBeInTheDocument();
    });
  });

  it("creates a bookmark through the modal", async () => {
    const user = userEvent.setup();

    agentClientMock.getNotebookTree.mockResolvedValue({
      bookmarks: [
        {
          children: [],
          flags: {},
          name: BOOKMARK,
          noteCount: 0,
        },
      ],
    });

    agentClientMock.listNotes.mockResolvedValue({
      bookmark: BOOKMARK,
      notes: [],
    });

    agentClientMock.createBookmark.mockResolvedValue({
      bookmarks: [],
    });

    renderWithProviders(<NotebookBrowsePanel />);

    await screen.findByRole("button", { name: /Research/i });

    await user.click(screen.getByRole("button", { name: "Create bookmark" }));

    const nameInput = await screen.findByLabelText("Bookmark name");
    await user.type(nameInput, "  Reading list  ");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(agentClientMock.createBookmark).toHaveBeenCalledWith(PORT, TOKEN, "Reading list");
    });

    await waitFor(() => {
      expect(screen.queryByLabelText("Bookmark name")).not.toBeInTheDocument();
    });
  });

  describe("reminders", () => {
    it("renders due reminders in the banner", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-02T10:00:00"));

      try {
        agentClientMock.getNotebookReminders.mockResolvedValue({
          reminders: [
            {
              bookmark: BOOKMARK,
              name: NOTE_NAME,
              previewLines: ["Remember the release"],
              remindAt: "2026-09-01T18:00",
            },
          ],
        });
        agentClientMock.getNotebookTree.mockResolvedValue({
          bookmarks: [
            {
              children: [],
              flags: {},
              name: BOOKMARK,
              noteCount: 1,
            },
          ],
        });
        agentClientMock.listNotes.mockResolvedValue({
          bookmark: BOOKMARK,
          notes: [
            {
              flags: {},
              name: NOTE_NAME,
              previewLines: ["Remember the release"],
            },
          ],
        });
        agentClientMock.readNote.mockResolvedValue({
          bookmark: BOOKMARK,
          flags: {},
          name: NOTE_NAME,
          previewLines: ["Remember the release"],
          text: "Remember the release",
        });

        renderWithProviders(<NotebookBrowsePanel />);
        vi.useRealTimers();

        const reminderTitle = await screen.findByText("Active reminders");
        expect(reminderTitle).toBeInTheDocument();
        expect(await screen.findByText(NOTE_NAME)).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it("dismisses a due reminder through updateNote while keeping remindAt", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-02T10:00:00"));

      try {
        const SELECTED_NOTE_NAME = "2026-08-25-09-00-00";

        agentClientMock.getNotebookReminders.mockResolvedValue({
          reminders: [
            {
              bookmark: BOOKMARK,
              name: NOTE_NAME,
              previewLines: ["Remember the release"],
              remindAt: "2026-09-01T18:00",
            },
          ],
        });
        agentClientMock.getNotebookTree.mockResolvedValue({
          bookmarks: [
            {
              children: [],
              flags: {},
              name: BOOKMARK,
              noteCount: 2,
            },
          ],
        });
        agentClientMock.listNotes.mockResolvedValue({
          bookmark: BOOKMARK,
          notes: [
            {
              flags: {},
              name: SELECTED_NOTE_NAME,
              previewLines: ["Selected note"],
            },
            {
              flags: { remindAt: "2026-09-01T18:00" },
              name: NOTE_NAME,
              previewLines: ["Remember the release"],
            },
          ],
        });
        agentClientMock.readNote.mockImplementation((_port, _token, _bookmark, noteName) => {
          if (noteName === NOTE_NAME) {
            return {
              bookmark: BOOKMARK,
              flags: { remindAt: "2026-09-01T18:00" },
              name: NOTE_NAME,
              previewLines: ["Remember the release"],
              text: "body",
            };
          }

          return {
            bookmark: BOOKMARK,
            flags: {},
            name: SELECTED_NOTE_NAME,
            previewLines: ["Selected note"],
            text: "Selected note",
          };
        });
        agentClientMock.updateNote.mockResolvedValue({
          bookmark: BOOKMARK,
          flags: {
            remindAt: "2026-09-01T18:00",
            remindDismissedAt: "2026-09-02T10:00",
          },
          name: NOTE_NAME,
          previewLines: ["Remember the release"],
          text: "body",
        });

        renderWithProviders(<NotebookBrowsePanel />);
        vi.useRealTimers();
        const user = userEvent.setup();

        await screen.findByText("Active reminders");
        await user.click(await screen.findByRole("button", { name: "Dismiss" }));

        await waitFor(() => {
          expect(agentClientMock.updateNote).toHaveBeenCalled();
        });

        const payload = agentClientMock.updateNote.mock.calls.at(-1)?.at(-1) as
          | { flags: { remindAt?: string; remindDismissedAt?: string } }
          | undefined;
        expect(payload?.flags).toHaveProperty("remindDismissedAt");
        expect(payload?.flags.remindAt).toBe("2026-09-01T18:00");
      } finally {
        vi.useRealTimers();
      }
    });

    it("re-arms a reminder from the picker by setting remindAt and clearing dismissed state", async () => {
      const user = userEvent.setup();
      const SECOND_NOTE_NAME = "2026-08-25-15-45-10";

      agentClientMock.getNotebookTree.mockResolvedValue({
        bookmarks: [
          {
            children: [],
            flags: {},
            name: BOOKMARK,
            noteCount: 2,
          },
        ],
      });
      agentClientMock.listNotes.mockResolvedValue({
        bookmark: BOOKMARK,
        notes: [
          {
            flags: {},
            name: SECOND_NOTE_NAME,
            previewLines: ["Other preview"],
          },
          {
            flags: {},
            name: NOTE_NAME,
            previewLines: ["Reminder target"],
          },
        ],
      });
      agentClientMock.readNote.mockImplementation((_port, _token, _bookmark, noteName) => {
        if (noteName === NOTE_NAME) {
          return {
            bookmark: BOOKMARK,
            flags: { remindDismissedAt: "2026-08-01T00:00" },
            name: NOTE_NAME,
            previewLines: ["Reminder target"],
            text: "Reminder target",
          };
        }

        return {
          bookmark: BOOKMARK,
          flags: {},
          name: SECOND_NOTE_NAME,
          previewLines: ["Other preview"],
          text: "Other preview",
        };
      });
      agentClientMock.updateNote.mockImplementation(
        (_port, _token, _bookmark, _noteName, payload: { flags?: Record<string, unknown> }) => ({
          bookmark: BOOKMARK,
          flags: payload.flags ?? {},
          name: NOTE_NAME,
          previewLines: ["Reminder target"],
          text: "Reminder target",
        })
      );

      renderWithProviders(<NotebookBrowsePanel />);

      await screen.findByRole("button", { name: /Other preview/i });
      await user.click(screen.getByRole("button", { name: /Reminder target/i }));

      await user.click(await screen.findByRole("button", { name: "Set reminder" }));

      const input = await screen.findByLabelText("Reminder");
      fireEvent.change(input, { target: { value: "2026-09-05T09:30" } });

      await waitFor(() => {
        expect(agentClientMock.updateNote).toHaveBeenCalledTimes(2);
      });

      const payload = agentClientMock.updateNote.mock.calls.at(-1)?.at(-1) as
        | { flags: { remindAt?: string; remindDismissedAt?: string } }
        | undefined;
      expect(payload?.flags.remindAt).toBe("2026-09-05T09:30");
      expect(payload?.flags).not.toHaveProperty("remindDismissedAt");
    });

    it("keeps an unsaved draft after updating a reminder", async () => {
      const user = userEvent.setup();
      let currentFlags: Record<string, unknown> = {};

      agentClientMock.getNotebookTree.mockResolvedValue({
        bookmarks: [
          {
            children: [],
            flags: {},
            name: BOOKMARK,
            noteCount: 1,
          },
        ],
      });
      agentClientMock.listNotes.mockResolvedValue({
        bookmark: BOOKMARK,
        notes: [
          {
            flags: currentFlags,
            name: NOTE_NAME,
            previewLines: ["Saved body"],
          },
        ],
      });
      agentClientMock.readNote.mockImplementation(() => ({
        bookmark: BOOKMARK,
        flags: currentFlags,
        name: NOTE_NAME,
        previewLines: ["Saved body"],
        text: "Saved body",
      }));
      agentClientMock.updateNote.mockImplementation(
        (_port, _token, _bookmark, _noteName, payload: { flags?: Record<string, unknown> }) => {
          currentFlags = payload.flags ?? {};
          return {
            bookmark: BOOKMARK,
            flags: currentFlags,
            name: NOTE_NAME,
            previewLines: ["Saved body"],
            text: "Saved body",
          };
        }
      );

      renderWithProviders(<NotebookBrowsePanel />);

      const textarea = await screen.findByLabelText("Notebook note body");
      await user.type(textarea, "\nUnsaved draft");
      expect(textarea).toHaveValue("Saved body\nUnsaved draft");

      await user.click(screen.getByRole("button", { name: "Set reminder" }));

      await waitFor(() => {
        expect(agentClientMock.updateNote).toHaveBeenCalledTimes(1);
      });
      await waitFor(() => {
        expect(screen.getByLabelText("Notebook note body")).toHaveValue("Saved body\nUnsaved draft");
      });
    });

    it("marks bookmarks that contain a reminder", async () => {
      agentClientMock.getNotebookReminders.mockResolvedValue({
        reminders: [
          {
            bookmark: BOOKMARK,
            name: NOTE_NAME,
            previewLines: ["x"],
            remindAt: "2026-09-01T18:00",
          },
        ],
      });
      agentClientMock.getNotebookTree.mockResolvedValue({
        bookmarks: [
          {
            children: [],
            flags: {},
            name: BOOKMARK,
            noteCount: 1,
          },
        ],
      });
      agentClientMock.listNotes.mockResolvedValue({
        bookmark: BOOKMARK,
        notes: [
          {
            flags: { remindAt: "2026-09-01T18:00" },
            name: NOTE_NAME,
            previewLines: [NOTE_NAME],
          },
        ],
      });
      agentClientMock.readNote.mockResolvedValue({
        bookmark: BOOKMARK,
        flags: { remindAt: "2026-09-01T18:00" },
        name: NOTE_NAME,
        previewLines: [NOTE_NAME],
        text: NOTE_NAME,
      });

      renderWithProviders(<NotebookBrowsePanel />);

      expect(await screen.findByLabelText("Contains a reminder")).toBeInTheDocument();
    });

    it("filters notes by reminder and hides the filter when none exist", async () => {
      const user = userEvent.setup();
      const PLAIN_NOTE_NAME = "plain-note";

      agentClientMock.getNotebookReminders.mockResolvedValue({
        reminders: [
          {
            bookmark: BOOKMARK,
            name: NOTE_NAME,
            previewLines: [NOTE_NAME],
            remindAt: "2026-09-01T18:00",
          },
        ],
      });
      agentClientMock.getNotebookTree.mockResolvedValue({
        bookmarks: [
          {
            children: [],
            flags: {},
            name: BOOKMARK,
            noteCount: 2,
          },
        ],
      });
      agentClientMock.listNotes.mockResolvedValue({
        bookmark: BOOKMARK,
        notes: [
          {
            flags: { remindAt: "2026-09-01T18:00" },
            name: NOTE_NAME,
            previewLines: [NOTE_NAME],
          },
          {
            flags: {},
            name: PLAIN_NOTE_NAME,
            previewLines: [PLAIN_NOTE_NAME],
          },
        ],
      });
      agentClientMock.readNote.mockResolvedValue({
        bookmark: BOOKMARK,
        flags: { remindAt: "2026-09-01T18:00" },
        name: NOTE_NAME,
        previewLines: [NOTE_NAME],
        text: NOTE_NAME,
      });

      renderWithProviders(<NotebookBrowsePanel />);

      const btn = await screen.findByRole("button", { name: "Show only notes with reminders" });
      expect((await screen.findAllByText(NOTE_NAME)).length).toBeGreaterThan(0);
      expect(await screen.findByText(PLAIN_NOTE_NAME)).toBeInTheDocument();

      await user.click(btn);

      expect((await screen.findAllByText(NOTE_NAME)).length).toBeGreaterThan(0);
      await waitFor(() => {
        expect(screen.queryByText(PLAIN_NOTE_NAME)).not.toBeInTheDocument();
      });

      await user.click(await screen.findByRole("button", { name: "Show all notes" }));

      expect((await screen.findAllByText(NOTE_NAME)).length).toBeGreaterThan(0);
      expect(await screen.findByText(PLAIN_NOTE_NAME)).toBeInTheDocument();
    });

    it("hides the reminder filter for a bookmark without reminders", async () => {
      const PLAIN_NOTE_NAME = "plain-note";

      agentClientMock.getNotebookReminders.mockResolvedValue({ reminders: [] });
      agentClientMock.getNotebookTree.mockResolvedValue({
        bookmarks: [
          {
            children: [],
            flags: {},
            name: BOOKMARK,
            noteCount: 1,
          },
        ],
      });
      agentClientMock.listNotes.mockResolvedValue({
        bookmark: BOOKMARK,
        notes: [
          {
            flags: {},
            name: PLAIN_NOTE_NAME,
            previewLines: [PLAIN_NOTE_NAME],
          },
        ],
      });
      agentClientMock.readNote.mockResolvedValue({
        bookmark: BOOKMARK,
        flags: {},
        name: PLAIN_NOTE_NAME,
        previewLines: [PLAIN_NOTE_NAME],
        text: PLAIN_NOTE_NAME,
      });

      renderWithProviders(<NotebookBrowsePanel />);

      await screen.findByText(PLAIN_NOTE_NAME);
      expect(screen.queryByRole("button", { name: "Show only notes with reminders" })).not.toBeInTheDocument();
    });
  });
});
