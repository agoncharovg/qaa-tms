import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Group,
  Loader,
  NativeSelect,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";

import { agentClient } from "@/api/agentClient";
import { QueryKey } from "@/constants";
import { useAuthStore } from "@/store/authStore";

interface ReportPanelProps {
  agentPort: number;
}

interface ReportFilters {
  product: string;
  startDate: string;
  endDate: string;
  environment: string;
  testType: string;
}

const ReportPanelCopy = {
  EMPTY_BODY: "No Leonid products are available for reporting.",
  EMPTY_TITLE: "No report products",
  ERROR_TITLE: "Leonid report failed",
  LOAD_BUTTON: "Load report",
  LOADING: "Loading Leonid report.",
  NO_TOP_FAILURES: "No failed tests matched the selected filters.",
  NOT_CONFIGURED_BODY: "Set AGENT_LEONID_URL in the companion app to enable Leonid reports.",
  NOT_CONFIGURED_TITLE: "Leonid is not configured",
  SUBTITLE: "Review summary stability metrics for one Leonid product across a date range.",
  TITLE: "Stability report",
} as const;

const ENVIRONMENT_OPTIONS = [
  { label: "Any environment", value: "" },
  { label: "PREPROD", value: "PREPROD" },
  { label: "PROD", value: "PROD" },
] as const;

const TEST_TYPE_OPTIONS = [
  { label: "Any test type", value: "" },
  { label: "UI", value: "UI" },
  { label: "BACKEND", value: "BACKEND" },
] as const;

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function buildDefaultFilters(): ReportFilters {
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 7);

  return {
    product: "",
    startDate: formatDate(startDate),
    endDate: formatDate(endDate),
    environment: "",
    testType: "",
  };
}

export function ReportPanel({ agentPort }: ReportPanelProps) {
  const token = useAuthStore((state) => state.token);
  const [filters, setFilters] = useState<ReportFilters>(() => buildDefaultFilters());
  const [submittedFilters, setSubmittedFilters] = useState<ReportFilters>(() => buildDefaultFilters());

  const productsQuery = useQuery({
    enabled: Boolean(token),
    queryFn: ({ signal }) => agentClient.getLeonidProducts(agentPort, token ?? "", signal),
    queryKey: [QueryKey.LEONID_PRODUCTS, agentPort, token, "report"],
    refetchOnWindowFocus: false,
    retry: false,
  });

  const firstProduct = useMemo(() => productsQuery.data?.products[0] ?? "", [productsQuery.data]);

  useEffect(() => {
    if (!firstProduct) {
      return;
    }

    setFilters((current) => (current.product ? current : { ...current, product: firstProduct }));
    setSubmittedFilters((current) =>
      current.product ? current : { ...current, product: firstProduct }
    );
  }, [firstProduct]);

  const reportQuery = useQuery({
    enabled: Boolean(token) && Boolean(submittedFilters.product) && productsQuery.data?.configured === true,
    queryFn: ({ signal }) =>
      agentClient.getLeonidReport(
        agentPort,
        token ?? "",
        submittedFilters.product,
        {
          endDate: submittedFilters.endDate,
          environment: submittedFilters.environment || null,
          startDate: submittedFilters.startDate,
          testType: submittedFilters.testType || null,
        },
        signal
      ),
    queryKey: [QueryKey.LEONID_REPORT, agentPort, token, submittedFilters],
    refetchOnWindowFocus: false,
    retry: false,
  });

  if (productsQuery.isLoading) {
    return (
      <Stack align="center" gap="md" py="xl">
        <Loader size="lg" />
        <Text c="dimmed">{ReportPanelCopy.LOADING}</Text>
      </Stack>
    );
  }

  if (productsQuery.isError) {
    return (
      <Alert color="red" icon={<IconAlertCircle size={18} />} title={ReportPanelCopy.ERROR_TITLE}>
        <Text>
          {productsQuery.error instanceof Error
            ? productsQuery.error.message
            : ReportPanelCopy.ERROR_TITLE}
        </Text>
      </Alert>
    );
  }

  if (productsQuery.data?.configured !== true) {
    return (
      <Paper p="xl" radius="lg" withBorder>
        <Stack gap="sm">
          <Title order={3}>{ReportPanelCopy.NOT_CONFIGURED_TITLE}</Title>
          <Text c="dimmed">{ReportPanelCopy.NOT_CONFIGURED_BODY}</Text>
        </Stack>
      </Paper>
    );
  }

  if ((productsQuery.data.products.length ?? 0) === 0) {
    return (
      <Paper p="xl" radius="lg" withBorder>
        <Stack gap="sm">
          <Title order={3}>{ReportPanelCopy.EMPTY_TITLE}</Title>
          <Text c="dimmed">{ReportPanelCopy.EMPTY_BODY}</Text>
        </Stack>
      </Paper>
    );
  }

  return (
    <Stack gap="lg">
      <div>
        <Title order={3}>{ReportPanelCopy.TITLE}</Title>
        <Text c="dimmed" size="sm">
          {ReportPanelCopy.SUBTITLE}
        </Text>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          setSubmittedFilters(filters);
        }}
      >
        <Stack gap="md">
          <SimpleGrid cols={{ base: 1, md: 2 }}>
            <NativeSelect
              data={productsQuery.data.products.map((product) => ({
                label: product.toUpperCase(),
                value: product,
              }))}
              label="Product"
              onChange={(event) => setFilters({ ...filters, product: event.currentTarget.value })}
              value={filters.product}
            />
            <NativeSelect
              data={ENVIRONMENT_OPTIONS}
              label="Environment"
              onChange={(event) => setFilters({ ...filters, environment: event.currentTarget.value })}
              value={filters.environment}
            />
            <TextInput
              label="Start date"
              onChange={(event) => setFilters({ ...filters, startDate: event.currentTarget.value })}
              type="date"
              value={filters.startDate}
            />
            <TextInput
              label="End date"
              onChange={(event) => setFilters({ ...filters, endDate: event.currentTarget.value })}
              type="date"
              value={filters.endDate}
            />
            <NativeSelect
              data={TEST_TYPE_OPTIONS}
              label="Test type"
              onChange={(event) => setFilters({ ...filters, testType: event.currentTarget.value })}
              value={filters.testType}
            />
          </SimpleGrid>

          <Group justify="flex-end">
            <Button type="submit">{ReportPanelCopy.LOAD_BUTTON}</Button>
          </Group>
        </Stack>
      </form>

      {reportQuery.isError ? (
        <Alert color="red" icon={<IconAlertCircle size={18} />} title={ReportPanelCopy.ERROR_TITLE}>
          <Text>
            {reportQuery.error instanceof Error
              ? reportQuery.error.message
              : ReportPanelCopy.ERROR_TITLE}
          </Text>
        </Alert>
      ) : null}

      {reportQuery.isLoading ? (
        <Group gap="sm" py="xl">
          <Loader size="sm" />
          <Text c="dimmed">{ReportPanelCopy.LOADING}</Text>
        </Group>
      ) : null}

      {reportQuery.data ? (
        <Stack gap="lg">
          <SimpleGrid cols={{ base: 1, md: 3 }}>
            <Card padding="lg" radius="lg" withBorder>
              <Text c="dimmed" size="sm">
                Failed total
              </Text>
              <Text fw={700} size="xl">
                {reportQuery.data.failed_total}
              </Text>
            </Card>
            <Card padding="lg" radius="lg" withBorder>
              <Text c="dimmed" size="sm">
                Success total
              </Text>
              <Text fw={700} size="xl">
                {reportQuery.data.success_total}
              </Text>
            </Card>
            <Card padding="lg" radius="lg" withBorder>
              <Text c="dimmed" size="sm">
                Tests added
              </Text>
              <Text fw={700} size="xl">
                {reportQuery.data.test_added}
              </Text>
            </Card>
          </SimpleGrid>

          <Card padding="lg" radius="lg" withBorder>
            <Stack gap="sm">
              <Title order={4}>Top failed tests</Title>
              {reportQuery.data.top_failed_tests.length > 0 ? (
                reportQuery.data.top_failed_tests.map((test) => (
                  <Group justify="space-between" key={test.name} wrap="nowrap">
                    <Text>{test.name}</Text>
                    <Text c="dimmed">{test.count}</Text>
                  </Group>
                ))
              ) : (
                <Text c="dimmed">{ReportPanelCopy.NO_TOP_FAILURES}</Text>
              )}
            </Stack>
          </Card>
        </Stack>
      ) : null}
    </Stack>
  );
}
