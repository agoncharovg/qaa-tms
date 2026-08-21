import {
  Accordion,
  Alert,
  Anchor,
  Badge,
  Card,
  Group,
  Loader,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import { useQueries, useQuery } from "@tanstack/react-query";

import { AgentRequestError, agentClient } from "@/api/agentClient";
import type { LeonidProductStatus } from "@/api/types";
import { QueryKey } from "@/constants";
import { useAuthStore } from "@/store/authStore";

interface DeployGatePanelProps {
  agentPort: number;
}

const DeployGateCopy = {
  EMPTY_BODY: "No Leonid products returned deploy gate data.",
  EMPTY_TITLE: "No deploy gate data",
  ERROR_TITLE: "Leonid deploy gate failed",
  LOADING: "Loading Leonid deploy gate.",
  NOT_CONFIGURED_BODY: "Set AGENT_LEONID_URL in the companion app to enable Leonid.",
  NOT_CONFIGURED_TITLE: "Leonid is not configured",
  REASON_FALLBACK: "No reason reported.",
  REFRESHING: "Refreshing product statuses.",
  SUBTITLE: "Read-only deploy gate statuses per Leonid product. Products without Leonid data stay hidden.",
  TITLE: "Deploy gate",
} as const;

function formatProductLabel(product: string): string {
  return product.toUpperCase();
}

function isHiddenProductError(error: unknown): boolean {
  return error instanceof AgentRequestError && error.status === 404;
}

export function DeployGatePanel({ agentPort }: DeployGatePanelProps) {
  const token = useAuthStore((state) => state.token);
  const productsQuery = useQuery({
    enabled: Boolean(token),
    queryFn: ({ signal }) => agentClient.getLeonidProducts(agentPort, token ?? "", signal),
    queryKey: [QueryKey.LEONID_PRODUCTS, agentPort, token],
    refetchOnWindowFocus: false,
    retry: false,
  });

  const statusQueries = useQueries({
    queries: (productsQuery.data?.products ?? []).map((product) => ({
      enabled: Boolean(token) && productsQuery.data?.configured === true,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        agentClient.getLeonidStatus(agentPort, token ?? "", product, signal),
      queryKey: [QueryKey.LEONID_STATUS, agentPort, token, product],
      refetchOnWindowFocus: false,
      retry: false,
    })),
  });

  const statuses = statusQueries
    .map((query) => query.data)
    .filter((status): status is LeonidProductStatus => Boolean(status));
  const loadingStatuses = statusQueries.some((query) => query.isLoading);
  const statusError = statusQueries.find(
    (query) => query.isError && !isHiddenProductError(query.error)
  )?.error;

  if (productsQuery.isLoading) {
    return (
      <Stack align="center" gap="md" py="xl">
        <Loader size="lg" />
        <Text c="dimmed">{DeployGateCopy.LOADING}</Text>
      </Stack>
    );
  }

  if (productsQuery.isError) {
    return (
      <Alert color="red" icon={<IconAlertCircle size={18} />} title={DeployGateCopy.ERROR_TITLE}>
        <Text>
          {productsQuery.error instanceof Error
            ? productsQuery.error.message
            : DeployGateCopy.ERROR_TITLE}
        </Text>
      </Alert>
    );
  }

  if (productsQuery.data?.configured !== true) {
    return (
      <Paper p="xl" radius="lg" withBorder>
        <Stack gap="sm">
          <Title order={3}>{DeployGateCopy.NOT_CONFIGURED_TITLE}</Title>
          <Text c="dimmed">{DeployGateCopy.NOT_CONFIGURED_BODY}</Text>
        </Stack>
      </Paper>
    );
  }

  if (productsQuery.data.products.length === 0) {
    return (
      <Paper p="xl" radius="lg" withBorder>
        <Stack gap="sm">
          <Title order={3}>{DeployGateCopy.EMPTY_TITLE}</Title>
          <Text c="dimmed">{DeployGateCopy.EMPTY_BODY}</Text>
        </Stack>
      </Paper>
    );
  }

  if (statusError) {
    return (
      <Alert color="red" icon={<IconAlertCircle size={18} />} title={DeployGateCopy.ERROR_TITLE}>
        <Text>{statusError instanceof Error ? statusError.message : DeployGateCopy.ERROR_TITLE}</Text>
      </Alert>
    );
  }

  if (loadingStatuses && statuses.length === 0) {
    return (
      <Stack align="center" gap="md" py="xl">
        <Loader size="lg" />
        <Text c="dimmed">{DeployGateCopy.LOADING}</Text>
      </Stack>
    );
  }

  if (!loadingStatuses && statuses.length === 0) {
    return (
      <Paper p="xl" radius="lg" withBorder>
        <Stack gap="sm">
          <Title order={3}>{DeployGateCopy.EMPTY_TITLE}</Title>
          <Text c="dimmed">{DeployGateCopy.EMPTY_BODY}</Text>
        </Stack>
      </Paper>
    );
  }

  return (
    <Stack gap="lg">
      <div>
        <Title order={3}>{DeployGateCopy.TITLE}</Title>
        <Text c="dimmed" size="sm">
          {DeployGateCopy.SUBTITLE}
        </Text>
      </div>

      {loadingStatuses ? (
        <Group gap="xs">
          <Loader size="xs" />
          <Text c="dimmed" size="sm">
            {DeployGateCopy.REFRESHING}
          </Text>
        </Group>
      ) : null}

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        {statuses.map((status) => (
          <Card key={status.product} padding="lg" radius="lg" withBorder>
            <Stack gap="md">
              <Group justify="space-between" wrap="nowrap">
                <div>
                  <Text fw={700}>{formatProductLabel(status.product)}</Text>
                  <Text c="dimmed" size="sm">
                    {status.reason ?? DeployGateCopy.REASON_FALLBACK}
                  </Text>
                </div>
                <Badge color={status.allow_to_deploy ? "teal" : "red"} variant="light">
                  {status.allow_to_deploy ? "Allowed" : "Blocked"}
                </Badge>
              </Group>

              <Group gap="xl" wrap="wrap">
                <div>
                  <Text c="dimmed" size="xs">
                    Last build
                  </Text>
                  {status.build_link ? (
                    <Anchor href={status.build_link} rel="noreferrer" target="_blank">
                      {status.last_build_date ?? "Open build"}
                    </Anchor>
                  ) : (
                    <Text size="sm">{status.last_build_date ?? "No build reported"}</Text>
                  )}
                </div>
                <div>
                  <Text c="dimmed" size="xs">
                    Force deploy
                  </Text>
                  <Text size="sm">
                    {status.force_deploy === null
                      ? "Unknown"
                      : status.force_deploy
                        ? "Enabled"
                        : "Disabled"}
                  </Text>
                </div>
              </Group>

              {status.failed_tests && status.failed_tests.length > 0 ? (
                <Accordion chevronPosition="right" variant="contained">
                  {status.failed_tests.map((failedTest, index) => (
                    <Accordion.Item
                      key={`${status.product}-${failedTest.test_name ?? index}`}
                      value={`${status.product}-${index}`}
                    >
                      <Accordion.Control>
                        {failedTest.test_name ?? `Failed test ${String(index + 1)}`}
                      </Accordion.Control>
                      <Accordion.Panel>
                        <Stack gap="xs">
                          {(failedTest.steps ?? []).map((step, stepIndex) => (
                            <div key={`${failedTest.test_name ?? index}-${stepIndex}`}>
                              <Text fw={600} size="sm">
                                {step.step_name ?? `Step ${String(stepIndex + 1)}`}
                              </Text>
                              <Text c="dimmed" size="sm">
                                {step.error_message ?? "No error message reported."}
                              </Text>
                            </div>
                          ))}
                        </Stack>
                      </Accordion.Panel>
                    </Accordion.Item>
                  ))}
                </Accordion>
              ) : null}
            </Stack>
          </Card>
        ))}
      </SimpleGrid>
    </Stack>
  );
}
