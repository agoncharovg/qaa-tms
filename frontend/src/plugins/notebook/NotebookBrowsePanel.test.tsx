import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const agentClientMock = vi.hoisted(() => ({
  createBookmark: vi.fn(),
  deleteBookmark: vi.fn(),
  deleteNote: vi.fn(),
  getNotebookTree: vi.fn(),
  listNotes: vi.fn(),
  readNote: vi.fn(),
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

import { PluginId } from "@/constants";
import { NotebookBrowsePanel } from "@/plugins/notebook/NotebookBrowsePanel";
import { renderWithProviders } from "@/test/render";
import { resetAuthStoreState, useAuthStore } from "@/store/authStore";

const TOKEN = "token-123" as const;
const PORT = 47600 as const;
const BOOKMARK = "Research" as const;
const NOTE_NAME = "2026-08-25-14-30-05" as const;

describe("NotebookBrowsePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      expect(agentClientMock.updateNote).toHaveBeenCalledWith(PORT, TOKEN, SECOND_NOTE_NAME, {
        bookmark: BOOKMARK,
        text: "Updated line",
      });
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
});
