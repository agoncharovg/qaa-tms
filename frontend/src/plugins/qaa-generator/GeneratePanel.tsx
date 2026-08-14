import { useState } from "react";
import {
  Alert,
  Anchor,
  Button,
  Card,
  Group,
  NativeSelect,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconAlertCircle, IconPlayerPlay } from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";

import { BackendHttpError, backendClient } from "@/api/backendClient";
import type { QaaRunCreateRequest } from "@/api/types";
import {
  HttpStatus,
  PluginId,
  QaaRunProfile,
  QaaRunProfileLabel,
  TabId,
  type QaaRunProfile as QaaRunProfileType,
} from "@/constants";
import { useAuthStore } from "@/store/authStore";
import { useActivateQaaGeneratorTab } from "@/plugins/qaa-generator/tabNavigation";
import { useQaaRunLive } from "@/plugins/qaa-generator/useQaaRunLive";
import { useUiStore } from "@/store/uiStoreCore";

const GENERATE_PANEL_COPY = {
  MISSING_TOKEN_LINK_LABEL: "Profile / Settings",
  MISSING_TOKEN_PREFIX: "Set your personal qaa-generator token in ",
  MISSING_TOKEN_SUFFIX: " before starting a run.",
  MISSING_TOKEN_TITLE: "Personal qaa-generator token required",
  BRANCH_DESCRIPTION: "Optional branch override. Leave blank to let qaa-generator decide.",
  CONFLICT_ACTION: "Open existing run",
  CONFLICT_TITLE: "A run for this Jira key is already active",
  EMPTY_JIRA_KEY: "A Jira key is required.",
  ERROR_TITLE: "QAA generation request failed",
  FORM_DESCRIPTION:
    "Submit a centrally executed qaa-generator run through the backend proxy using your stored personal qaa-generator token.",
  JIRA_KEY_PLACEHOLDER: "QAA-123",
  RUN_BUTTON: "Generate",
  TITLE: "Generate tests",
} as const;

const GENERATE_PROFILE_OPTIONS = Object.values(QaaRunProfile).map((profile) => ({
  label: QaaRunProfileLabel[profile],
  value: profile,
}));
const PROFILE_SETTINGS_HREF = "/profile?section=settings" as const;

interface GenerateFormState {
  branch: string;
  dryRun: boolean;
  jiraKey: string;
  profile: QaaRunProfileType;
  skipExec: boolean;
  skipPr: boolean;
}

const DEFAULT_GENERATE_FORM_STATE: GenerateFormState = {
  branch: "",
  dryRun: false,
  jiraKey: "",
  profile: QaaRunProfile.BALANCED,
  skipExec: false,
  skipPr: false,
};

function buildCreatePayload(formState: GenerateFormState): QaaRunCreateRequest {
  const jiraKey = formState.jiraKey.trim();
  if (jiraKey.length === 0) {
    throw new Error(GENERATE_PANEL_COPY.EMPTY_JIRA_KEY);
  }

  const branch = formState.branch.trim();
  return {
    branch: branch.length > 0 ? branch : null,
    dry_run: formState.dryRun,
    jira_key: jiraKey,
    profile: formState.profile,
    skip_exec: formState.skipExec,
    skip_pr: formState.skipPr,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractConflictRunId(error: unknown): string | null {
  if (!(error instanceof BackendHttpError) || error.status !== HttpStatus.CONFLICT) {
    return null;
  }
  if (!isRecord(error.payload)) {
    return null;
  }
  const runId = error.payload.run_id;
  return typeof runId === "string" ? runId : null;
}

export function GeneratePanel() {
  const token = useAuthStore((state) => state.token);
  const currentUser = useAuthStore((state) => state.currentUser);
  const [formState, setFormState] = useState<GenerateFormState>(DEFAULT_GENERATE_FORM_STATE);
  const [conflictRunId, setConflictRunId] = useState<string | null>(null);
  const activateTab = useActivateQaaGeneratorTab();
  const liveTabOpen = useUiStore((state) =>
    state.tabsByPlugin[PluginId.QAA_GENERATOR].tabIds.includes(TabId.QAA_LIVE)
  );
  const { startRun } = useQaaRunLive();
  const hasPersonalToken = currentUser?.qaa_generator_token_set === true;

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!token) {
        throw new Error("Authentication is required.");
      }
      if (!hasPersonalToken) {
        throw new Error(`${GENERATE_PANEL_COPY.MISSING_TOKEN_PREFIX}${GENERATE_PANEL_COPY.MISSING_TOKEN_LINK_LABEL}${GENERATE_PANEL_COPY.MISSING_TOKEN_SUFFIX}`);
      }

      return backendClient.createQaaRun(token, buildCreatePayload(formState));
    },
    onMutate: () => {
      setConflictRunId(null);
    },
    onSuccess: (run) => {
      startRun(run.run_id);
      activateTab(TabId.QAA_LIVE);
    },
    onError: (error) => {
      setConflictRunId(extractConflictRunId(error));
    },
  });

  const createDisabled =
    createMutation.isPending || formState.jiraKey.trim().length === 0 || !token || !hasPersonalToken;

  return (
    <Card padding="lg" radius="lg" withBorder>
      <Stack gap="lg">
        <div>
          <Title order={3}>{GENERATE_PANEL_COPY.TITLE}</Title>
          <Text c="dimmed" size="sm">
            {GENERATE_PANEL_COPY.FORM_DESCRIPTION}
          </Text>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (createDisabled) {
              return;
            }
            createMutation.mutate();
          }}
        >
          <Stack gap="md">
            {!hasPersonalToken ? (
              <Alert
                color="yellow"
                icon={<IconAlertCircle size={18} />}
                title={GENERATE_PANEL_COPY.MISSING_TOKEN_TITLE}
              >
                {GENERATE_PANEL_COPY.MISSING_TOKEN_PREFIX}
                <Anchor href={PROFILE_SETTINGS_HREF}>{GENERATE_PANEL_COPY.MISSING_TOKEN_LINK_LABEL}</Anchor>
                {GENERATE_PANEL_COPY.MISSING_TOKEN_SUFFIX}
              </Alert>
            ) : null}

            <TextInput
              label="Jira key"
              onChange={(event) => {
                const { value } = event.currentTarget;
                setFormState((current) => ({
                  ...current,
                  jiraKey: value,
                }));
              }}
              placeholder={GENERATE_PANEL_COPY.JIRA_KEY_PLACEHOLDER}
              required
              value={formState.jiraKey}
            />

            <NativeSelect
              data={GENERATE_PROFILE_OPTIONS}
              label="Profile"
              onChange={(event) => {
                const { value } = event.currentTarget;
                setFormState((current) => ({
                  ...current,
                  profile: value as QaaRunProfileType,
                }));
              }}
              value={formState.profile}
            />

            <TextInput
              description={GENERATE_PANEL_COPY.BRANCH_DESCRIPTION}
              label="Branch"
              onChange={(event) => {
                const { value } = event.currentTarget;
                setFormState((current) => ({
                  ...current,
                  branch: value,
                }));
              }}
              placeholder="feature/my-branch"
              value={formState.branch}
            />

            <Switch
              checked={formState.dryRun}
              label="Dry run"
              onChange={(event) => {
                const { checked } = event.currentTarget;
                setFormState((current) => ({
                  ...current,
                  dryRun: checked,
                }));
              }}
            />

            <Switch
              checked={formState.skipPr}
              label="Skip PR"
              onChange={(event) => {
                const { checked } = event.currentTarget;
                setFormState((current) => ({
                  ...current,
                  skipPr: checked,
                }));
              }}
            />

            <Switch
              checked={formState.skipExec}
              label="Skip execution"
              onChange={(event) => {
                const { checked } = event.currentTarget;
                setFormState((current) => ({
                  ...current,
                  skipExec: checked,
                }));
              }}
            />

            {createMutation.isError ? (
              <Alert
                color="red"
                icon={<IconAlertCircle size={18} />}
                title={GENERATE_PANEL_COPY.ERROR_TITLE}
              >
                <Stack gap="sm">
                  <Text>
                    {createMutation.error instanceof Error
                      ? createMutation.error.message
                      : GENERATE_PANEL_COPY.ERROR_TITLE}
                  </Text>
                  {conflictRunId ? (
                    <Group>
                      <Button
                        onClick={() => {
                          startRun(conflictRunId);
                          activateTab(TabId.QAA_LIVE);
                        }}
                        variant="light"
                      >
                        {GENERATE_PANEL_COPY.CONFLICT_ACTION}
                      </Button>
                      <Text c="dimmed" size="sm">
                        {GENERATE_PANEL_COPY.CONFLICT_TITLE}: {conflictRunId}
                      </Text>
                    </Group>
                  ) : null}
                </Stack>
              </Alert>
            ) : null}

            <Group justify="space-between">
              <Text c="dimmed" size="sm">
                {liveTabOpen ? "The Live tab will switch to the new run." : "The Live tab will open for the new run."}
              </Text>
              <Button
                disabled={createDisabled}
                leftSection={<IconPlayerPlay size={16} />}
                loading={createMutation.isPending}
                type="submit"
              >
                {GENERATE_PANEL_COPY.RUN_BUTTON}
              </Button>
            </Group>
          </Stack>
        </form>
      </Stack>
    </Card>
  );
}
