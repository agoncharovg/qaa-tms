import { Alert, Stack, Table, Text, Title } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";

import { useAuthStore } from "@/store/authStore";

export function UsersPage() {
  const currentUser = useAuthStore((state) => state.currentUser);

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Users</Title>
        <Text c="dimmed">
          The backend does not expose a user list yet, so this slice shows only the current user.
        </Text>
      </div>

      <Table.ScrollContainer minWidth={560}>
        <Table highlightOnHover striped withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>ID</Table.Th>
              <Table.Th>Username</Table.Th>
              <Table.Th>Display name</Table.Th>
              <Table.Th>Admin</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {currentUser ? (
              <Table.Tr key={currentUser.id}>
                <Table.Td>{currentUser.id}</Table.Td>
                <Table.Td>{currentUser.username}</Table.Td>
                <Table.Td>{currentUser.display_name}</Table.Td>
                <Table.Td>{currentUser.is_admin ? "Yes" : "No"}</Table.Td>
              </Table.Tr>
            ) : null}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      <Alert icon={<IconInfoCircle size={18} />} title="Later slice">
        Full user management is coming in a later slice.
      </Alert>
    </Stack>
  );
}
