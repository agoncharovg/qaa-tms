import { Badge, Group, HoverCard, Stack, Text } from "@mantine/core";
import { IconSnowflake } from "@tabler/icons-react";

import type { JenkinsFreezeRead } from "@/api/types";
import { JenkinsFreezeCopy } from "@/constants";
import { formatRelativeAgeFromIso } from "@/plugins/jenkins/relativeTime";

interface JenkinsFreezeBadgeProps {
  freezes: JenkinsFreezeRead[];
}

export function JenkinsFreezeBadge({ freezes }: JenkinsFreezeBadgeProps) {
  if (freezes.length === 0) {
    return null;
  }

  return (
    <HoverCard position="bottom-start" shadow="md" width={320} withArrow>
      <HoverCard.Target>
        <Badge color="cyan" leftSection={<IconSnowflake size={12} />} variant="light">
          {JenkinsFreezeCopy.BADGE}
        </Badge>
      </HoverCard.Target>
      <HoverCard.Dropdown>
        <Stack gap="sm">
          {freezes.map((freeze) => {
            const activeCount = freeze.snapshot.filter((item) => !item.wasDisabled).length;
            const disabledCount = freeze.snapshot.length - activeCount;

            return (
              <Stack gap={4} key={freeze.id}>
                <Text fw={600} size="sm">
                  {freeze.folderName}
                </Text>
                <Text size="sm">
                  {`Frozen by ${freeze.createdBy} · ${formatRelativeAgeFromIso(freeze.createdAt)}`}
                </Text>
                <Text c="dimmed" size="sm">
                  {freeze.reason}
                </Text>
                <Group gap="xs">
                  <Badge color="blue" size="sm" variant="light">
                    {`Active ${activeCount}`}
                  </Badge>
                  <Badge color="gray" size="sm" variant="light">
                    {`Already disabled ${disabledCount}`}
                  </Badge>
                </Group>
              </Stack>
            );
          })}
        </Stack>
      </HoverCard.Dropdown>
    </HoverCard>
  );
}
