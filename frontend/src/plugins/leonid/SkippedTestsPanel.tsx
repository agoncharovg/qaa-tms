import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Loader,
  Modal,
  Pagination,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
  Tooltip,
} from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { agentClient, discoverAgent } from "@/api/agentClient";
import { backendClient } from "@/api/backendClient";
import type {
  JenkinsAllureSkipCandidate,
  JenkinsAllureSkipCandidatesError,
  LeonidSkippedSuite,
  LeonidSkippedTest,
} from "@/api/types";
import { PRODUCT_OPTIONS, QueryKey } from "@/constants";
import { useAuthStore } from "@/store/authStore";

const PAGE_SIZE = 20;
const MAX_SKIP_DAYS = 7;
const DAY_IN_MS = 24 * 60 * 60 * 1000;

type CreateInputMode = "manual" | "allure";
type StatusFilter = "all" | "active" | "finished";

interface ImportedCandidate extends JenkinsAllureSkipCandidate {
  checked: boolean;
}

interface CreateFormState {
  reason: string;
  product: string;
  expiresAt: string;
  tests: string;
  inputMode: CreateInputMode;
  reportUrls: string[];
  importedCandidates: ImportedCandidate[];
}

const STATUS_OPTIONS: { label: string; value: StatusFilter }[] = [
  { label: "All", value: "all" },
  { label: "Active", value: "active" },
  { label: "Finished", value: "finished" },
];

function formatError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function startOfLocalDay(date: Date): Date {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  return day;
}

function toLocalDateTimeInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function normalizeNow(date: Date): Date {
  const normalized = new Date(date);
  normalized.setSeconds(0, 0);
  return normalized;
}

function createDefaultExpiry(now: Date): string {
  return toLocalDateTimeInputValue(new Date(now.getTime() + MAX_SKIP_DAYS * DAY_IN_MS));
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value: string | null | undefined): string {
  const date = parseDate(value);
  return date ? date.toLocaleString() : "—";
}

function parseTestsInput(value: string): LeonidSkippedTest[] {
  const seen = new Set<string>();
  const tests: LeonidSkippedTest[] = [];

  for (const line of value.split("\n")) {
    const fullName = line.trim();
    if (!fullName || seen.has(fullName)) {
      continue;
    }
    seen.add(fullName);
    tests.push({ full_name: fullName });
  }

  return tests;
}

function mergeTests(
  manualTests: LeonidSkippedTest[],
  importedCandidates: ImportedCandidate[]
): LeonidSkippedTest[] {
  const merged = new Map<string, LeonidSkippedTest>();

  for (const test of manualTests) {
    merged.set(test.full_name, test);
  }

  for (const candidate of importedCandidates) {
    if (!candidate.checked) {
      continue;
    }
    merged.set(candidate.full_name, { full_name: candidate.full_name });
  }

  return [...merged.values()];
}

function isFinishedSuite(suite: LeonidSkippedSuite): boolean {
  return suite.status === "expired" || suite.status === "cancelled";
}

function isExpiringSoon(suite: LeonidSkippedSuite, now: Date): boolean {
  if (suite.status !== "active") {
    return false;
  }

  const expiresAt = parseDate(suite.expires_at);
  if (!expiresAt) {
    return false;
  }

  const today = startOfLocalDay(now).getTime();
  const tomorrow = today + DAY_IN_MS;
  const expiryDay = startOfLocalDay(expiresAt).getTime();
  return expiryDay === today || expiryDay === tomorrow;
}

function getStatusColor(suite: LeonidSkippedSuite): string {
  if (suite.status === "cancelled") {
    return "gray";
  }
  if (suite.status === "expired") {
    return "dark";
  }
  return "teal";
}

function getStatusLabel(suite: LeonidSkippedSuite): string {
  if (suite.status === "cancelled") {
    return "Cancelled";
  }
  if (suite.status === "expired") {
    return "Expired";
  }
  return "Active";
}

function isProductMismatch(expectedProduct: string, candidateProduct: string | null): boolean {
  const normalizedExpected = expectedProduct.trim();
  if (!normalizedExpected) {
    return false;
  }

  return candidateProduct !== normalizedExpected;
}

function createEmptyForm(now: Date): CreateFormState {
  return {
    reason: "",
    product: "",
    expiresAt: createDefaultExpiry(now),
    tests: "",
    inputMode: "manual",
    reportUrls: [""],
    importedCandidates: [],
  };
}

export function SkippedTestsPanel() {
  const token = useAuthStore((state) => state.token) ?? "";
  const queryClient = useQueryClient();
  const [productFilter, setProductFilter] = useState<string | null>(null);
  const [authorFilter, setAuthorFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<LeonidSkippedSuite | null>(null);
  const [createForm, setCreateForm] = useState<CreateFormState>(() => createEmptyForm(normalizeNow(new Date())));
  const [allureAgentPort, setAllureAgentPort] = useState<number | null>(null);
  const [allureLoadErrors, setAllureLoadErrors] = useState<JenkinsAllureSkipCandidatesError[]>([]);
  const [allureLoadMessage, setAllureLoadMessage] = useState<string | null>(null);

  const suitesQuery = useQuery({
    queryFn: ({ signal }) => backendClient.listLeonidSkippedSuites(token, signal),
    queryKey: [QueryKey.LEONID_SKIPPED_SUITES, token],
  });

  const invalidateSuites = () =>
    queryClient.invalidateQueries({ queryKey: [QueryKey.LEONID_SKIPPED_SUITES] });

  const createMutation = useMutation({
    mutationFn: (payload: {
      reason: string;
      product: string;
      expires_at: string;
      tests: LeonidSkippedTest[];
    }) => backendClient.createLeonidSkippedSuite(token, payload),
    onSuccess: async () => {
      await invalidateSuites();
      const now = normalizeNow(new Date());
      setCreateForm(createEmptyForm(now));
      setAllureLoadErrors([]);
      setAllureLoadMessage(null);
      setCreateModalOpen(false);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (suiteId: number) => backendClient.cancelLeonidSkippedSuite(token, suiteId),
    onSuccess: async () => {
      await invalidateSuites();
      setCancelTarget(null);
    },
  });

  const loadAllureMutation = useMutation({
    mutationFn: async () => {
      const reportUrls = createForm.reportUrls.map((url) => url.trim()).filter((url) => url.length > 0);
      if (reportUrls.length === 0) {
        throw new Error("Enter at least one Allure report URL.");
      }

      let port = allureAgentPort;
      if (port === null) {
        const discovery = await discoverAgent();
        if (!discovery) {
          throw new Error("The local agent is unavailable. Use manual test entry instead.");
        }
        port = discovery.port;
        setAllureAgentPort(discovery.port);
      }

      return agentClient.getAllureSkipCandidates(port, token, {
        product: createForm.product.trim() || null,
        reportUrls,
      });
    },
    onMutate: () => {
      setAllureLoadErrors([]);
      setAllureLoadMessage(null);
    },
    onSuccess: (response) => {
      setCreateForm((current) => ({
        ...current,
        importedCandidates: response.candidates.map((candidate) => ({ ...candidate, checked: true })),
      }));
      setAllureLoadErrors(response.errors);
      setAllureLoadMessage(
        response.candidates.length === 0 ? "No tests were found in the selected reports." : null
      );
    },
    onError: (error) => {
      setCreateForm((current) => ({
        ...current,
        importedCandidates: [],
      }));
      setAllureLoadErrors([]);
      setAllureLoadMessage(formatError(error, "Unable to load Allure tests."));
    },
  });

  const now = normalizeNow(new Date());
  const maxExpiryDate = new Date(now.getTime() + MAX_SKIP_DAYS * DAY_IN_MS);
  const parsedManualTests = parseTestsInput(createForm.tests);
  const mergedTests = mergeTests(
    parsedManualTests,
    createForm.inputMode === "allure" ? createForm.importedCandidates : []
  );
  const selectedImportedCount = createForm.importedCandidates.filter((candidate) => candidate.checked).length;
  const expiryDate = parseDate(createForm.expiresAt);
  const expiryTooEarly = expiryDate === null || expiryDate.getTime() <= now.getTime();
  const expiryTooLate = expiryDate !== null && expiryDate.getTime() > maxExpiryDate.getTime();
  const createFormError = expiryTooEarly
    ? "Expiry must be in the future."
    : expiryTooLate
      ? "Expiry cannot be more than 7 days ahead."
      : createForm.inputMode === "allure" &&
          createForm.importedCandidates.length > 0 &&
          selectedImportedCount === 0 &&
          parsedManualTests.length === 0
        ? "Select at least one imported test or add one manually."
        : null;
  const createFormValid =
    createForm.reason.trim().length > 0 &&
    createForm.product.trim().length > 0 &&
    mergedTests.length > 0 &&
    !expiryTooEarly &&
    !expiryTooLate;

  const suites = [...(suitesQuery.data ?? [])].sort((left, right) => {
    return Date.parse(right.created_at) - Date.parse(left.created_at);
  });

  const productOptions = Array.from(new Set(suites.map((suite) => suite.product)))
    .sort((left, right) => left.localeCompare(right))
    .map((product) => ({ label: product, value: product }));

  const createProductOptions = Array.from(new Set([...PRODUCT_OPTIONS, ...suites.map((suite) => suite.product)]))
    .sort((left, right) => left.localeCompare(right))
    .map((product) => ({ label: product, value: product }));

  const filteredSuites = suites.filter((suite) => {
    if (productFilter && suite.product !== productFilter) {
      return false;
    }

    if (authorFilter.trim()) {
      const authorNeedle = authorFilter.trim().toLowerCase();
      if (!suite.author.toLowerCase().includes(authorNeedle)) {
        return false;
      }
    }

    if (statusFilter === "active" && suite.status !== "active") {
      return false;
    }

    if (statusFilter === "finished" && !isFinishedSuite(suite)) {
      return false;
    }

    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filteredSuites.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visibleSuites = filteredSuites.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const mutationError = createMutation.error ?? cancelMutation.error;
  const emptyStateMessage = suitesQuery.error
    ? "Skipped suites are unavailable right now."
    : suites.length === 0
      ? "No skipped suites were returned."
      : "No skipped suites matched the current filters.";

  function openCreateModal(): void {
    setCreateForm(createEmptyForm(normalizeNow(new Date())));
    setAllureLoadErrors([]);
    setAllureLoadMessage(null);
    loadAllureMutation.reset();
    setCreateModalOpen(true);
  }

  function updateReportUrl(index: number, value: string): void {
    setCreateForm((current) => ({
      ...current,
      reportUrls: current.reportUrls.map((reportUrl, reportIndex) =>
        reportIndex === index ? value : reportUrl
      ),
    }));
  }

  function addReportUrl(): void {
    setCreateForm((current) => ({
      ...current,
      reportUrls: [...current.reportUrls, ""],
    }));
  }

  function removeReportUrl(index: number): void {
    setCreateForm((current) => ({
      ...current,
      reportUrls:
        current.reportUrls.length > 1
          ? current.reportUrls.filter((_, reportIndex) => reportIndex !== index)
          : [""],
    }));
  }

  function toggleImportedCandidate(fullName: string, checked: boolean): void {
    setCreateForm((current) => ({
      ...current,
      importedCandidates: current.importedCandidates.map((candidate) =>
        candidate.full_name === fullName ? { ...candidate, checked } : candidate
      ),
    }));
  }

  function submitCreate(): void {
    if (!createFormValid || expiryDate === null) {
      return;
    }

    createMutation.mutate({
      reason: createForm.reason.trim(),
      product: createForm.product.trim(),
      expires_at: expiryDate.toISOString(),
      tests: mergedTests,
    });
  }

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Skipped tests</Title>
        <Text c="dimmed">Create and cancel temporary Leonid skip suites for E2E tests.</Text>
      </div>

      {mutationError ? (
        <Alert color="red" title="Leonid skipped tests failed">
          {formatError(mutationError, "Unable to update Leonid skipped suites.")}
        </Alert>
      ) : null}

      {suitesQuery.isLoading ? (
        <Stack align="center" py="xl">
          <Loader />
          <Text c="dimmed">Loading Leonid skipped suites.</Text>
        </Stack>
      ) : (
        <Paper p="md" withBorder>
          <Stack gap="md">
            <Group justify="space-between">
              <div>
                <Text fw={600}>Suites</Text>
                <Text c="dimmed" size="sm">
                  Filter active and finished skips, or create a new manual suite.
                </Text>
              </div>
              <Button aria-label="Add skipped suite" onClick={openCreateModal} size="xs">
                Add skipped suite
              </Button>
            </Group>

            <Group align="end" grow>
              <Select
                clearable
                data={productOptions}
                label="Product"
                onChange={(value) => {
                  setProductFilter(value);
                  setPage(1);
                }}
                placeholder="All products"
                searchable
                value={productFilter}
              />
              <TextInput
                label="Author"
                onChange={(event) => {
                  setAuthorFilter(event.target.value);
                  setPage(1);
                }}
                placeholder="Filter by author"
                value={authorFilter}
              />
              <Select
                data={STATUS_OPTIONS}
                label="Status"
                onChange={(value) => {
                  setStatusFilter((value as StatusFilter | null) ?? "all");
                  setPage(1);
                }}
                value={statusFilter}
              />
            </Group>

            {visibleSuites.length > 0 ? (
              <>
                <Table highlightOnHover striped withTableBorder>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Product</Table.Th>
                      <Table.Th>Author</Table.Th>
                      <Table.Th>Reason</Table.Th>
                      <Table.Th>Tests</Table.Th>
                      <Table.Th>Created</Table.Th>
                      <Table.Th>Expires</Table.Th>
                      <Table.Th>Status</Table.Th>
                      <Table.Th>Actions</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {visibleSuites.map((suite) => {
                      const finished = isFinishedSuite(suite);
                      const expiringSoon = isExpiringSoon(suite, now);
                      return (
                        <Table.Tr
                          data-expiring-soon={expiringSoon ? "true" : "false"}
                          data-suite-status={suite.status}
                          key={suite.id}
                          style={{
                            backgroundColor: finished
                              ? "rgba(134, 142, 150, 0.08)"
                              : expiringSoon
                                ? "rgba(250, 176, 5, 0.12)"
                                : undefined,
                            opacity: finished ? 0.7 : 1,
                          }}
                        >
                          <Table.Td>{suite.product}</Table.Td>
                          <Table.Td>{suite.author}</Table.Td>
                          <Table.Td maw={320}>
                            <Tooltip disabled={suite.reason.length <= 80} label={suite.reason} multiline>
                              <Text lineClamp={2}>{suite.reason}</Text>
                            </Tooltip>
                          </Table.Td>
                          <Table.Td>
                            <details>
                              <summary>{suite.tests.length} tests</summary>
                              <Stack gap={4} mt="xs">
                                {suite.tests.map((test) => (
                                  <Text c={finished ? "dimmed" : undefined} key={test.full_name} size="sm">
                                    {test.full_name}
                                  </Text>
                                ))}
                              </Stack>
                            </details>
                          </Table.Td>
                          <Table.Td>{formatDate(suite.created_at)}</Table.Td>
                          <Table.Td>
                            <Group gap="xs">
                              <Text>{formatDate(suite.expires_at)}</Text>
                              {expiringSoon ? (
                                <Badge color="yellow" variant="light">
                                  Soon
                                </Badge>
                              ) : null}
                            </Group>
                          </Table.Td>
                          <Table.Td>
                            <Stack gap={4}>
                              <Badge color={getStatusColor(suite)} variant="light">
                                {getStatusLabel(suite)}
                              </Badge>
                              {suite.status === "cancelled" ? (
                                <Text c="dimmed" size="sm">
                                  by {suite.cancelled_by ?? "unknown"} at {formatDate(suite.cancelled_at)}
                                </Text>
                              ) : null}
                            </Stack>
                          </Table.Td>
                          <Table.Td>
                            <Button
                              aria-label={`Cancel skipped suite ${suite.id}`}
                              disabled={finished}
                              onClick={() => setCancelTarget(suite)}
                              size="xs"
                              variant="light"
                            >
                              Cancel
                            </Button>
                          </Table.Td>
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>

                {filteredSuites.length > PAGE_SIZE ? (
                  <Group justify="center">
                    <Pagination onChange={setPage} total={totalPages} value={currentPage} />
                  </Group>
                ) : null}
              </>
            ) : (
              <Text c="dimmed">{emptyStateMessage}</Text>
            )}
          </Stack>
        </Paper>
      )}

      <Modal
        onClose={() => setCreateModalOpen(false)}
        opened={createModalOpen}
        title="Add skipped suite"
      >
        <Stack>
          <Textarea
            label="Reason"
            minRows={3}
            onChange={(event) => setCreateForm((current) => ({ ...current, reason: event.target.value }))}
            value={createForm.reason}
          />
          <Select
            data={createProductOptions}
            label="Product"
            onChange={(value) => setCreateForm((current) => ({ ...current, product: value ?? "" }))}
            placeholder="Select a product"
            searchable
            value={createForm.product || null}
          />
          <TextInput
            description="Maximum 7 days from now."
            label="Expires at"
            max={toLocalDateTimeInputValue(maxExpiryDate)}
            min={toLocalDateTimeInputValue(now)}
            onChange={(event) =>
              setCreateForm((current) => ({ ...current, expiresAt: event.target.value }))
            }
            type="datetime-local"
            value={createForm.expiresAt}
          />
          <Stack gap={4}>
            <Text fw={500} size="sm">
              Populate tests
            </Text>
            <SegmentedControl
              data={[
                { label: "Manual", value: "manual" },
                { label: "From Allure", value: "allure" },
              ]}
              fullWidth
              onChange={(value) =>
                setCreateForm((current) => ({
                  ...current,
                  inputMode: value as CreateInputMode,
                }))
              }
              value={createForm.inputMode}
            />
          </Stack>

          {createForm.inputMode === "allure" ? (
            <Stack gap="sm">
              <Text c="dimmed" size="sm">
                Load one or more published Allure reports, then uncheck unrelated flaky tests before saving.
              </Text>
              {createForm.reportUrls.map((reportUrl, index) => (
                <Group align="end" key={`${index}-${createForm.reportUrls.length}`}>
                  <TextInput
                    aria-label={`Report URL ${index + 1}`}
                    label={index === 0 ? "Report URLs" : undefined}
                    onChange={(event) => updateReportUrl(index, event.target.value)}
                    placeholder="https://jenkins.../42/allure/"
                    style={{ flex: 1 }}
                    value={reportUrl}
                  />
                  <Button onClick={addReportUrl} size="xs" variant="default">
                    Add URL
                  </Button>
                  <Button
                    disabled={createForm.reportUrls.length === 1}
                    onClick={() => removeReportUrl(index)}
                    size="xs"
                    variant="default"
                  >
                    Remove
                  </Button>
                </Group>
              ))}
              <Group justify="space-between">
                <Text c="dimmed" size="sm">
                  Loaded {selectedImportedCount} of {createForm.importedCandidates.length} imported tests.
                </Text>
                <Button
                  disabled={createForm.reportUrls.every((url) => url.trim().length === 0)}
                  loading={loadAllureMutation.isPending}
                  onClick={() => loadAllureMutation.mutate()}
                  size="xs"
                  variant="light"
                >
                  Load tests
                </Button>
              </Group>

              {loadAllureMutation.isPending ? (
                <Group>
                  <Loader size="sm" />
                  <Text c="dimmed" size="sm">
                    Loading tests from Allure.
                  </Text>
                </Group>
              ) : null}

              {loadAllureMutation.isError && allureLoadMessage ? (
                <Alert color="red" title="Allure import failed">
                  {allureLoadMessage}
                </Alert>
              ) : null}

              {!loadAllureMutation.isError && allureLoadErrors.length > 0 ? (
                <Alert color="yellow" title="Some reports could not be imported">
                  <Stack gap={4}>
                    {allureLoadErrors.map((error) => (
                      <Text key={`${error.report_url}-${error.message}`} size="sm">
                        {error.report_url}: {error.message}
                      </Text>
                    ))}
                  </Stack>
                </Alert>
              ) : null}

              {!loadAllureMutation.isError && allureLoadMessage ? (
                <Text c="dimmed" size="sm">
                  {allureLoadMessage}
                </Text>
              ) : null}

              {createForm.importedCandidates.length > 0 ? (
                <Table highlightOnHover striped withTableBorder>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Use</Table.Th>
                      <Table.Th>Test</Table.Th>
                      <Table.Th>Product</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {createForm.importedCandidates.map((candidate) => {
                      const mismatch = isProductMismatch(createForm.product, candidate.product);
                      return (
                        <Table.Tr
                          data-product-mismatch={mismatch ? "true" : "false"}
                          key={candidate.full_name}
                          style={{
                            backgroundColor: mismatch ? "rgba(250, 82, 82, 0.08)" : undefined,
                          }}
                        >
                          <Table.Td>
                            <Checkbox
                              aria-label={`Include test ${candidate.full_name}`}
                              checked={candidate.checked}
                              onChange={(event) =>
                                toggleImportedCandidate(candidate.full_name, event.currentTarget.checked)
                              }
                            />
                          </Table.Td>
                          <Table.Td>
                            <Stack gap={2}>
                              <Text size="sm">{candidate.full_name}</Text>
                              <Text c="dimmed" size="xs">
                                {candidate.name}
                              </Text>
                            </Stack>
                          </Table.Td>
                          <Table.Td>
                            <Group gap="xs">
                              <Badge color={mismatch ? "red" : "gray"} variant="light">
                                {candidate.product ?? "Unknown"}
                              </Badge>
                              {mismatch ? (
                                <Badge color="yellow" variant="light">
                                  Mismatch
                                </Badge>
                              ) : null}
                            </Group>
                          </Table.Td>
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              ) : null}
            </Stack>
          ) : null}

          <Textarea
            description={
              createForm.inputMode === "allure"
                ? "Optional. These full names will be merged with the checked imported tests."
                : "One test full name per line."
            }
            label={createForm.inputMode === "allure" ? "Manual additions" : "Tests"}
            minRows={6}
            onChange={(event) => setCreateForm((current) => ({ ...current, tests: event.target.value }))}
            placeholder={"tests.api.test_example#test_case\nother.module#test_case"}
            value={createForm.tests}
          />
          {createFormError ? (
            <Alert color="yellow" title="Form validation">
              {createFormError}
            </Alert>
          ) : null}
          <Group justify="space-between">
            <Text c="dimmed" size="sm">
              {mergedTests.length} unique tests will be saved.
            </Text>
            <Group>
              <Button onClick={() => setCreateModalOpen(false)} variant="default">
                Cancel
              </Button>
              <Button
                disabled={!createFormValid}
                loading={createMutation.isPending}
                onClick={submitCreate}
              >
                Save
              </Button>
            </Group>
          </Group>
        </Stack>
      </Modal>

      <Modal onClose={() => setCancelTarget(null)} opened={cancelTarget !== null} title="Confirm cancel">
        <Stack>
          <Text>Cancel skipped suite for {cancelTarget?.product}?</Text>
          <Group justify="flex-end">
            <Button onClick={() => setCancelTarget(null)} variant="default">
              Keep active
            </Button>
            <Button
              color="red"
              loading={cancelMutation.isPending}
              onClick={() => {
                if (cancelTarget) {
                  cancelMutation.mutate(cancelTarget.id);
                }
              }}
            >
              Cancel suite
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

