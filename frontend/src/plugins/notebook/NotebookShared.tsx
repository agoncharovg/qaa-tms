import { type ReactNode } from "react";
import {
  Alert,
  Button,
  Card,
  Group,
  Loader,
  Stack,
  Text,
  Textarea,
  Title,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconPlugConnectedX,
  IconRotateClockwise,
} from "@tabler/icons-react";

import type { NotebookNoteReadResponse } from "@/api/types";
import { getErrorMessage, type NotebookNotice } from "@/plugins/notebook/notebookShared";

const ALERT_ICON_SIZE_PX = 18 as const;
const NOTE_TITLE_ORDER = 4 as const;

export function NotebookLoadingState({ message }: { message: string }) {
  return (
    <Stack align="center" gap="md" py="xl">
      <Loader size="lg" />
      <Text c="dimmed">{message}</Text>
    </Stack>
  );
}

export function NotebookErrorAlert({
  error,
  fallback,
  onRetry,
  title,
}: {
  error: unknown;
  fallback: string;
  onRetry?: () => void;
  title: string;
}) {
  return (
    <Alert color="red" icon={<IconAlertCircle size={ALERT_ICON_SIZE_PX} />} title={title}>
      <Stack gap="sm">
        <Text>{getErrorMessage(error, fallback)}</Text>
        {onRetry ? (
          <Group>
            <Button leftSection={<IconRotateClockwise size={16} />} onClick={onRetry}>
              Retry
            </Button>
          </Group>
        ) : null}
      </Stack>
    </Alert>
  );
}

export function NotebookCompanionUnavailableAlert({
  onRetry,
  probedPorts,
}: {
  onRetry: () => void;
  probedPorts: string;
}) {
  return (
    <Alert
      color="yellow"
      icon={<IconPlugConnectedX size={ALERT_ICON_SIZE_PX} />}
      title="Companion app is not running"
    >
      <Stack gap="sm">
        <Text>Start the local companion app, then retry discovery before opening notebook data.</Text>
        <Text c="dimmed" size="sm">
          Probed ports: {probedPorts}
        </Text>
        <Group>
          <Button leftSection={<IconRotateClockwise size={16} />} onClick={onRetry} variant="light">
            Retry
          </Button>
        </Group>
      </Stack>
    </Alert>
  );
}

export function NotebookNoticeAlert({ notice }: { notice: NotebookNotice | null }) {
  if (!notice || notice.status === "success") {
    return null;
  }

  return (
    <Alert
      color="red"
      icon={<IconAlertCircle size={ALERT_ICON_SIZE_PX} />}
      title="Request failed"
    >
      {notice.message}
    </Alert>
  );
}

export function NotebookSurface({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description?: string;
  title?: string;
}) {
  return (
    <Card padding="lg" radius="lg" withBorder>
      <Stack gap="md">
        {title || description ? (
          <div>
            {title ? <Title order={3}>{title}</Title> : null}
            {description ? (
              <Text c="dimmed" size="sm">
                {description}
              </Text>
            ) : null}
          </div>
        ) : null}
        {children}
      </Stack>
    </Card>
  );
}

export function NotebookEmptyCard({
  body,
  title,
}: {
  body: string;
  title: string;
}) {
  return (
    <Card padding="lg" radius="lg" withBorder>
      <Stack gap="xs" justify="center" mih={220}>
        <Title order={NOTE_TITLE_ORDER}>{title}</Title>
        <Text c="dimmed">{body}</Text>
      </Stack>
    </Card>
  );
}

export function NotebookNoteEditor({
  bookmark,
  deleteButtonLabel,
  deleteDisabled,
  emptyBody,
  emptyTitle,
  error,
  hasUnsavedChanges,
  hasSelection,
  isDeleting,
  isLoading,
  isSaving,
  note,
  onDelete,
  onRetry,
  onSave,
  onTextChange,
  saveDisabled,
  text,
}: {
  bookmark: string | null;
  deleteButtonLabel: string;
  deleteDisabled: boolean;
  emptyBody: string;
  emptyTitle: string;
  error: unknown;
  hasUnsavedChanges: boolean;
  hasSelection: boolean;
  isDeleting: boolean;
  isLoading: boolean;
  isSaving: boolean;
  note: NotebookNoteReadResponse | null | undefined;
  onDelete: () => void;
  onRetry: () => void;
  onSave: () => void;
  onTextChange: (value: string) => void;
  saveDisabled: boolean;
  text: string;
}) {
  if (isLoading) {
    return <NotebookLoadingState message="Loading note text from the companion app." />;
  }

  if (error) {
    return (
      <NotebookErrorAlert
        error={error}
        fallback="Unable to load the selected note."
        onRetry={onRetry}
        title="Note load failed"
      />
    );
  }

  if (!bookmark || !hasSelection || !note) {
    return <NotebookEmptyCard body={emptyBody} title={emptyTitle} />;
  }

  return (
    <NotebookSurface
      description={`Bookmark: ${bookmark}`}
      title={note.name}
    >
      <Textarea
        aria-label="Notebook note body"
        autosize
        minRows={18}
        onChange={(event) => onTextChange(event.currentTarget.value)}
        value={text}
      />
      <Group justify="space-between">
        {hasUnsavedChanges ? <Text c="yellow" size="sm">Unsaved changes.</Text> : null}
        <Group style={{ marginLeft: "auto" }}>
          <Button
            color="red"
            disabled={deleteDisabled}
            loading={isDeleting}
            onClick={onDelete}
            variant="light"
          >
            {deleteButtonLabel}
          </Button>
          <Button disabled={saveDisabled} loading={isSaving} onClick={onSave}>
            Save note
          </Button>
        </Group>
      </Group>
    </NotebookSurface>
  );
}
