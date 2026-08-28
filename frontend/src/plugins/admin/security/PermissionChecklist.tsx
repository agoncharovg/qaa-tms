import { Box, Checkbox, Divider, Stack } from "@mantine/core";

import type { PermissionDomain } from "@/plugins/admin/security/permissionCatalog";

export function PermissionChecklist({
  domains,
  selected,
  inherited,
  disabled = false,
  onToggle,
}: {
  domains: PermissionDomain[];
  selected: Set<string>;
  inherited?: Set<string>;
  disabled?: boolean;
  onToggle: (key: string) => void;
}) {
  return (
    <Stack gap="md">
      {domains.map((domain) => (
        <Box key={domain.key}>
          <Divider label={domain.label} labelPosition="left" mb="xs" />
          <Stack gap={4}>
            {domain.permissions.map((permission) => {
              const isInherited = inherited?.has(permission.key) ?? false;
              return (
                <Checkbox
                  key={permission.key}
                  label={permission.key}
                  description={isInherited ? "Inherited from selected roles" : undefined}
                  checked={selected.has(permission.key) || isInherited}
                  disabled={disabled || isInherited}
                  onChange={() => onToggle(permission.key)}
                  size="sm"
                />
              );
            })}
          </Stack>
        </Box>
      ))}
    </Stack>
  );
}
