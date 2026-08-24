import { Tabs } from "@mantine/core";

import { GroupsPanel } from "@/plugins/admin/security/GroupsPanel";
import { RolesPanel } from "@/plugins/admin/security/RolesPanel";
import { UsersMatrix } from "@/plugins/admin/security/UsersMatrix";

export function SecurityPage() {
  return (
    <Tabs defaultValue="users">
      <Tabs.List>
        <Tabs.Tab value="users">Users</Tabs.Tab>
        <Tabs.Tab value="roles">Roles</Tabs.Tab>
        <Tabs.Tab value="groups">Groups</Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="users" pt="md">
        <UsersMatrix />
      </Tabs.Panel>
      <Tabs.Panel value="roles" pt="md">
        <RolesPanel />
      </Tabs.Panel>
      <Tabs.Panel value="groups" pt="md">
        <GroupsPanel />
      </Tabs.Panel>
    </Tabs>
  );
}
