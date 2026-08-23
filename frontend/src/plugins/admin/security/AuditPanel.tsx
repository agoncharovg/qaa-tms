import { useState } from "react";
import {
  Alert,
  Code,
  Group,
  Loader,
  Pagination,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";

import { backendClient } from "@/api/backendClient";
import { QueryKey } from "@/constants";
import { useAuthStore } from "@/store/authStore";

const PAGE_SIZE = 20;

export function AuditPanel() {
  const token = useAuthStore((state) => state.token);
  const [page, setPage] = useState(1);
  const offset = (page - 1) * PAGE_SIZE;

  const auditQuery = useQuery({
    queryKey: [QueryKey.SECURITY_AUDIT, token, page],
    queryFn: ({ signal }) =>
      backendClient.listSecurityAudit(token ?? "", PAGE_SIZE, offset, signal),
    enabled: Boolean(token),
  });

  if (auditQuery.isLoading) return <Loader />;

  if (auditQuery.error) {
    return (
      <Alert icon={<IconAlertCircle size={16} />} color="red">
        Failed to load audit log
      </Alert>
    );
  }

  const events = auditQuery.data?.items ?? [];
  const total = auditQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Stack gap="sm">
      <Title order={4}>Security Audit Log</Title>
      <Table striped>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Time</Table.Th>
            <Table.Th>Actor</Table.Th>
            <Table.Th>Event Type</Table.Th>
            <Table.Th>Target</Table.Th>
            <Table.Th>Details</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {events.map((event) => (
            <Table.Tr key={event.id}>
              <Table.Td style={{ whiteSpace: "nowrap", fontSize: 12 }}>
                {new Date(event.created_at).toLocaleString()}
              </Table.Td>
              <Table.Td>
                {event.actor_user ? (
                  <Text size="sm">{event.actor_user.username}</Text>
                ) : (
                  <Text size="sm" c="dimmed">
                    system
                  </Text>
                )}
              </Table.Td>
              <Table.Td>
                <Text size="sm" ff="monospace">
                  {event.event_type}
                </Text>
              </Table.Td>
              <Table.Td>
                <Text size="sm">
                  {event.target_type}
                  {event.target_id ? ` #${event.target_id}` : ""}
                </Text>
              </Table.Td>
              <Table.Td>
                <Code style={{ fontSize: 11 }}>
                  {JSON.stringify(event.payload).slice(0, 120)}
                </Code>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {events.length === 0 && <Text c="dimmed">No audit events found.</Text>}
      {totalPages > 1 && (
        <Group justify="center">
          <Pagination total={totalPages} value={page} onChange={setPage} size="sm" />
        </Group>
      )}
    </Stack>
  );
}
