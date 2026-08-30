import { type ReactNode } from "react";
import { Alert, Button, Card, Group, Loader, Stack, Text, Title } from "@mantine/core";
import { IconAlertCircle, IconPlugConnectedX, IconRotateClockwise } from "@tabler/icons-react";

import { getErrorMessage, type RequestsNotice } from "@/plugins/requests/requestsShared";

const ALERT_ICON_SIZE_PX = 18 as const;

export function RequestsLoadingState({ message }: { message: string }) {
  return (
    <Stack align="center" gap="md" py="xl">
      <Loader size="lg" />
      <Text c="dimmed">{message}</Text>
    </Stack>
  );
}

export function RequestsErrorAlert({
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

export function RequestsCompanionUnavailableAlert({
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
        <Text>Start the local companion app, then retry discovery before opening Requests data.</Text>
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

export function RequestsNoticeAlert({ notice }: { notice: RequestsNotice | null }) {
  if (!notice || notice.status === "success") {
    return null;
  }

  return (
    <Alert color="red" icon={<IconAlertCircle size={ALERT_ICON_SIZE_PX} />} title="Request failed">
      {notice.message}
    </Alert>
  );
}

export function RequestsSurface({
  children,
  description,
  title,
  titleRight,
}: {
  children: ReactNode;
  description?: string;
  title?: string;
  titleRight?: ReactNode;
}) {
  return (
    <Card padding="lg" radius="lg" withBorder>
      <Stack gap="md">
        {title || description || titleRight ? (
          <div>
            {title || titleRight ? (
              <Group align="center" justify="space-between">
                {title ? <Title order={3}>{title}</Title> : null}
                {titleRight ?? null}
              </Group>
            ) : null}
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

export function RequestsEmptyCard({
  body,
  title,
}: {
  body: string;
  title: string;
}) {
  return (
    <Card padding="lg" radius="lg" withBorder>
      <Stack gap="xs" justify="center" mih={220}>
        <Title order={4}>{title}</Title>
        <Text c="dimmed">{body}</Text>
      </Stack>
    </Card>
  );
}

