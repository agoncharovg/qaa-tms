import { useMemo } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { IconAlertCircle, IconPlugConnectedX, IconRotateClockwise } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";

import { getPreflight } from "@/api/agentClient";
import { PreflightLabel, QueryKey } from "@/constants";
import { useAuthStore } from "@/store/authStore";

export function PreflightPanel() {
  const token = useAuthStore((state) => state.token);

  const query = useQuery({
    enabled: Boolean(token),
    queryFn: ({ signal }) => getPreflight(token ?? "", signal),
    queryKey: [QueryKey.AGENT_PREFLIGHT, token],
    refetchOnWindowFocus: false,
    retry: false,
  });

  const lastCheckedAt = useMemo(
    () => (query.dataUpdatedAt ? new Date(query.dataUpdatedAt).toLocaleTimeString() : "Not checked yet"),
    [query.dataUpdatedAt]
  );

  if (query.isLoading) {
    return (
      <Stack align="center" gap="md" py="xl">
        <Loader size="lg" />
        <Text c="dimmed">Checking the local companion app and staging prerequisites.</Text>
      </Stack>
    );
  }

  if (query.isError) {
    return (
      <Alert color="red" icon={<IconAlertCircle size={18} />} title="Preflight request failed">
        <Stack gap="sm">
          <Text>{query.error instanceof Error ? query.error.message : "Unable to load preflight."}</Text>
          <Group>
            <Button leftSection={<IconRotateClockwise size={16} />} onClick={() => void query.refetch()}>
              Retry
            </Button>
          </Group>
        </Stack>
      </Alert>
    );
  }

  if (!query.data?.detected) {
    return (
      <Alert
        color="yellow"
        icon={<IconPlugConnectedX size={18} />}
        title="Companion app is not running"
      >
        <Stack gap="sm">
          <Text>
            Start the local companion app, then retry the probe. This empty state is expected until
            the companion app exists.
          </Text>
          <Text c="dimmed" size="sm">
            Probed ports: {query.data?.ports.join(", ")}
          </Text>
          <Group>
            <Button leftSection={<IconRotateClockwise size={16} />} onClick={() => void query.refetch()}>
              Retry
            </Button>
          </Group>
        </Stack>
      </Alert>
    );
  }

  return (
    <Stack gap="lg">
      <SimpleGrid cols={{ base: 1, md: 3 }}>
        <Card padding="lg" radius="lg" withBorder>
          <Text c="dimmed" size="sm">
            Agent version
          </Text>
          <Title order={4}>{query.data.agent.version}</Title>
        </Card>
        <Card padding="lg" radius="lg" withBorder>
          <Text c="dimmed" size="sm">
            Listening port
          </Text>
          <Title order={4}>{query.data.port}</Title>
        </Card>
        <Card padding="lg" radius="lg" withBorder>
          <Text c="dimmed" size="sm">
            Checked at
          </Text>
          <Title order={4}>{lastCheckedAt}</Title>
        </Card>
      </SimpleGrid>

      <Table.ScrollContainer minWidth={720}>
        <Table highlightOnHover striped withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Check</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Detail</Table.Th>
              <Table.Th>Hint</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {query.data.checklist.map((item) => (
              <Table.Tr key={item.key}>
                <Table.Td>{PreflightLabel[item.key]}</Table.Td>
                <Table.Td>
                  <Badge color={item.ok ? "teal" : "red"} variant="light">
                    {item.ok ? "OK" : "Not ready"}
                  </Badge>
                </Table.Td>
                <Table.Td>{item.detail}</Table.Td>
                <Table.Td>{item.howTo}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Stack>
  );
}
