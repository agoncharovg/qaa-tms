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
      ],
    });

    agentClientMock.readNote.mockResolvedValue({
      bookmark: BOOKMARK,
      flags: {},
      name: NOTE_NAME,
      previewLines: ["First line", "Second line"],
      text: "First line\nSecond line",
    });

    agentClientMock.updateNote.mockResolvedValue({
      bookmark: BOOKMARK,
      flags: {},
      name: NOTE_NAME,
      previewLines: ["Updated line"],
      text: "Updated line",
    });

    renderWithProviders(<NotebookBrowsePanel />);

    expect(await screen.findByRole("button", { name: /Research/i })).toBeInTheDocument();
    expect(await screen.findByText(NOTE_NAME)).toBeInTheDocument();

    const textarea = await screen.findByLabelText("Notebook note body");
    expect(textarea).toHaveValue("First line\nSecond line");

    await user.clear(textarea);
    await user.type(textarea, "Updated line");
    await user.click(screen.getByRole("button", { name: "Save note" }));

    await waitFor(() => {
      expect(agentClientMock.updateNote).toHaveBeenCalledWith(PORT, TOKEN, NOTE_NAME, {
        bookmark: BOOKMARK,
        text: "Updated line",
      });
    });
  });
});
