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
import { IconSearch } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { agentClient } from "@/api/agentClient";
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

const NOTEBOOK_SEARCH_COPY = {
  COMPANION_LOADING: "Checking the local companion app before loading notebook search.",
  DELETE_CONFIRM: "Delete this note?",
  DELETE_LABEL: "Delete note",
  EDITOR_EMPTY_BODY: "Run a search and open a result to inspect or edit the note text.",
  EDITOR_EMPTY_TITLE: "Search result",
  EMPTY_RESULTS: "No notes matched the current query.",
  HEADER_DESCRIPTION: "Search note text across all bookmarks without sending the content anywhere except the local companion app on this machine.",
  HEADER_TITLE: "Notebook search",
  QUERY_LABEL: "Search text",
  QUERY_PLACEHOLDER: "Search across your local notes",
  RESULTS_DESCRIPTION: "Results show the bookmark, note filename, and the first matching preview lines.",
  RESULTS_ERROR: "Notebook search failed",
  RESULTS_FALLBACK: "Unable to search notebook notes.",
  RESULTS_PROMPT: "Enter a query to search across your notebook.",
  RESULTS_TITLE: "Matches",
  SEARCH_BUTTON: "Search",
} as const;

type SearchSelection = {
  bookmark: string;
  name: string;
};

async function invalidateNotebookQueries(queryClient: ReturnType<typeof useQueryClient>): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: [QueryKey.NOTEBOOK_CONTENTS] }),
    queryClient.invalidateQueries({ queryKey: [QueryKey.NOTEBOOK_NOTES] }),
    queryClient.invalidateQueries({ queryKey: [QueryKey.NOTEBOOK_NOTE] }),
    queryClient.invalidateQueries({ queryKey: [QueryKey.NOTEBOOK_SEARCH] }),
  ]);
}

export function NotebookSearchPanel() {
  const queryClient = useQueryClient();
  const { agentPort, companionUnavailable, preflightQuery, probedPorts, token } = useNotebookAgent();
  const [queryDraft, setQueryDraft] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [selectedMatch, setSelectedMatch] = useState<SearchSelection | null>(null);
  const [editorText, setEditorText] = useState("");
  const [noteNotice, setNoteNotice] = useState<NotebookNotice | null>(null);

  const searchQuery = useQuery({
    enabled: Boolean(token && agentPort !== null && submittedQuery.length > 0),
    queryFn: ({ signal }) => agentClient.searchNotes(agentPort ?? 0, token ?? "", submittedQuery, signal),
    queryKey: [QueryKey.NOTEBOOK_SEARCH, token, agentPort, submittedQuery],
    refetchOnWindowFocus: false,
    retry: false,
  });

  const noteQuery = useQuery({
    enabled: Boolean(token && agentPort !== null && selectedMatch),
    queryFn: ({ signal }) =>
      agentClient.readNote(
        agentPort ?? 0,
        token ?? "",
        selectedMatch?.bookmark ?? "",
        selectedMatch?.name ?? "",
        signal
      ),
    queryKey: [QueryKey.NOTEBOOK_NOTE, token, agentPort, selectedMatch?.bookmark, selectedMatch?.name],
    refetchOnWindowFocus: false,
    retry: false,
  });

  useEffect(() => {
    const matches = searchQuery.data?.matches ?? [];
    if (!selectedMatch) {
      return;
    }

    if (!matches.some((match) => match.bookmark === selectedMatch.bookmark && match.name === selectedMatch.name)) {
      setSelectedMatch(null);
    }
  }, [searchQuery.data?.matches, selectedMatch]);

  useEffect(() => {
    if (noteQuery.data) {
      setEditorText(noteQuery.data.text);
    }
  }, [noteQuery.data]);

  const updateNoteMutation = useMutation({
    mutationFn: async (text: string) => {
      if (!token || agentPort === null || !selectedMatch) {
        throw new Error("Select a note first.");
      }

      return agentClient.updateNote(agentPort, token, selectedMatch.bookmark, selectedMatch.name, {
        bookmark: selectedMatch.bookmark,
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
      if (!token || agentPort === null || !selectedMatch) {
        throw new Error("Select a note first.");
      }

      return agentClient.deleteNote(agentPort, token, selectedMatch.bookmark, selectedMatch.name);
    },
    onSuccess: async () => {
      setNoteNotice({
        message: "Note deleted.",
        status: "success",
      });
      setSelectedMatch(null);
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

  const hasUnsavedChanges = editorText !== (noteQuery.data?.text ?? "");

  function handleSearch(): void {
    setSubmittedQuery(queryDraft.trim());
    setSelectedMatch(null);
    setEditorText("");
    setNoteNotice(null);
  }

  function handleDelete(): void {
    if (!selectedMatch || !window.confirm(NOTEBOOK_SEARCH_COPY.DELETE_CONFIRM)) {
      return;
    }

    setNoteNotice(null);
    deleteNoteMutation.mutate();
  }

  function handleSave(): void {
    setNoteNotice(null);
    updateNoteMutation.mutate(editorText);
  }

  if (preflightQuery.isLoading) {
    return <NotebookLoadingState message={NOTEBOOK_SEARCH_COPY.COMPANION_LOADING} />;
  }

  if (preflightQuery.isError) {
    return (
      <NotebookErrorAlert
        error={preflightQuery.error}
        fallback="Unable to reach the companion app."
        onRetry={() => void preflightQuery.refetch()}
        title={NOTEBOOK_SEARCH_COPY.RESULTS_ERROR}
      />
    );
  }

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>{NOTEBOOK_SEARCH_COPY.HEADER_TITLE}</Title>
        <Text c="dimmed">{NOTEBOOK_SEARCH_COPY.HEADER_DESCRIPTION}</Text>
      </div>

      <Group align="flex-end">
        <TextInput
          label={NOTEBOOK_SEARCH_COPY.QUERY_LABEL}
          onChange={(event) => setQueryDraft(event.currentTarget.value)}
          placeholder={NOTEBOOK_SEARCH_COPY.QUERY_PLACEHOLDER}
          value={queryDraft}
        />
        <Button
          disabled={companionUnavailable || queryDraft.trim().length === 0}
          leftSection={<IconSearch size={16} />}
          loading={searchQuery.isFetching}
          onClick={handleSearch}
        >
          {NOTEBOOK_SEARCH_COPY.SEARCH_BUTTON}
        </Button>
      </Group>

      {companionUnavailable ? (
        <NotebookCompanionUnavailableAlert
          onRetry={() => void preflightQuery.refetch()}
          probedPorts={probedPorts}
        />
      ) : submittedQuery.length === 0 ? (
        <Paper p="lg" radius="md" withBorder>
          <Text c="dimmed" ta="center">
            {NOTEBOOK_SEARCH_COPY.RESULTS_PROMPT}
          </Text>
        </Paper>
      ) : searchQuery.isLoading ? (
        <NotebookLoadingState message="Searching local notebook files through the companion app." />
      ) : searchQuery.isError ? (
        <NotebookErrorAlert
          error={searchQuery.error}
          fallback={NOTEBOOK_SEARCH_COPY.RESULTS_FALLBACK}
          onRetry={() => void searchQuery.refetch()}
          title={NOTEBOOK_SEARCH_COPY.RESULTS_ERROR}
        />
      ) : (
        <Grid>
          <Grid.Col span={{ base: 12, md: 5 }}>
            <NotebookSurface
              description={NOTEBOOK_SEARCH_COPY.RESULTS_DESCRIPTION}
              title={`${NOTEBOOK_SEARCH_COPY.RESULTS_TITLE}: ${submittedQuery}`}
            >
              <NotebookNoticeAlert notice={noteNotice} />
              {searchQuery.data?.matches.length ? (
                <Table.ScrollContainer minWidth={480}>
                  <Table highlightOnHover striped withTableBorder>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Bookmark</Table.Th>
                        <Table.Th>Note</Table.Th>
                        <Table.Th>Preview</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {searchQuery.data.matches.map((match) => (
                        <Table.Tr
                          key={`${match.bookmark}:${match.name}`}
                          onClick={() => setSelectedMatch({ bookmark: match.bookmark, name: match.name })}
                          style={{
                            backgroundColor:
                              selectedMatch?.bookmark === match.bookmark && selectedMatch?.name === match.name
                                ? "var(--mantine-color-blue-light)"
                                : undefined,
                            cursor: "pointer",
                          }}
                        >
                          <Table.Td style={{ verticalAlign: "top", whiteSpace: "nowrap" }}>
                            {match.bookmark}
                          </Table.Td>
                          <Table.Td style={{ verticalAlign: "top", whiteSpace: "nowrap" }}>
                            {match.name}
                          </Table.Td>
                          <Table.Td>
                            <Text c="dimmed" size="sm" style={{ whiteSpace: "pre-wrap" }}>
                              {buildPreviewText(match.previewLines)}
                            </Text>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              ) : (
                <Paper p="lg" radius="md" withBorder>
                  <Text c="dimmed" ta="center">
                    {NOTEBOOK_SEARCH_COPY.EMPTY_RESULTS}
                  </Text>
                </Paper>
              )}
            </NotebookSurface>
          </Grid.Col>

          <Grid.Col span={{ base: 12, md: 7 }}>
            <NotebookNoteEditor
              bookmark={selectedMatch?.bookmark ?? null}
              deleteButtonLabel={NOTEBOOK_SEARCH_COPY.DELETE_LABEL}
              deleteDisabled={!selectedMatch || deleteNoteMutation.isPending}
              emptyBody={NOTEBOOK_SEARCH_COPY.EDITOR_EMPTY_BODY}
              emptyTitle={NOTEBOOK_SEARCH_COPY.EDITOR_EMPTY_TITLE}
              error={noteQuery.error}
              hasSelection={Boolean(selectedMatch)}
              hasUnsavedChanges={hasUnsavedChanges}
              isDeleting={deleteNoteMutation.isPending}
              isLoading={noteQuery.isLoading}
              isSaving={updateNoteMutation.isPending}
              note={noteQuery.data}
              onDelete={handleDelete}
              onRetry={() => void noteQuery.refetch()}
              onSave={handleSave}
              onTextChange={setEditorText}
              saveDisabled={
                !selectedMatch ||
                !hasUnsavedChanges ||
                updateNoteMutation.isPending ||
                deleteNoteMutation.isPending
              }
              text={editorText}
            />
          </Grid.Col>
        </Grid>
      )}
    </Stack>
  );
}
