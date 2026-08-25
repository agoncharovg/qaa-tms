import { useEffect, useState, type ReactNode } from "react";
import {
  Alert,
  Button,
  Card,
  Group,
  Loader,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconAlertCircle, IconCheck } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { backendClient } from "@/api/backendClient";
import type { ServerSettingsRead, ServerSettingsUpdateRequest } from "@/api/types";
import { usePalette } from "@/app/theme/usePalette";
import { QueryKey } from "@/constants";
import { useAuthStore } from "@/store/authStore";

const ServerSettingsPageCopy = {
  BASE_URL_LABEL: "QAA generator base URL",
  CLEAR_SUPERUSER_TOKEN: "Clear superuser token",
  DESCRIPTION:
    "Edit the backend-held QAA generator ingress URL and superuser token. Base URL changes still require a backend restart.",
  LOAD_ERROR: "Server settings failed to load",
  LOADING: "Loading server settings.",
  SAVE: "Save server settings",
  SUCCESS: "Settings saved.",
  SUPERUSER_TOKEN_LABEL: "Superuser token",
  TITLE: "QAA generator",
  UPDATE_FAILED: "Save failed",
  UPDATE_REQUIRED: "Authentication is required.",
} as const;

const NoticeStatus = {
  ERROR: "error",
  SUCCESS: "success",
} as const;

const EMPTY_VALUE = "" as const;
const ALERT_ICON_SIZE_PX = 18 as const;
const CARD_TITLE_ORDER = 3 as const;
const PAGE_TITLE_ORDER = 2 as const;

const SECRET_INPUT_AUTOCOMPLETE = "new-password" as const;
const SECRET_INPUT_NAME = {
  SUPERUSER_TOKEN: "qaa-generator-superuser-token",
} as const;

type Notice = {
  message: string;
  status: (typeof NoticeStatus)[keyof typeof NoticeStatus];
};

type ServerFormState = {
  baseUrl: string;
  superuserToken: string;
  superuserTokenDirty: boolean;
  superuserTokenSet: boolean;
};

function buildServerFormState(settings: ServerSettingsRead): ServerFormState {
  return {
    baseUrl: settings.qaa_generator_base_url,
    superuserToken: EMPTY_VALUE,
    superuserTokenDirty: false,
    superuserTokenSet: settings.qaa_generator_superuser_token_set,
  };
}

function NoticeAlert({
  notice,
}: {
  notice: Notice | null;
}) {
  if (!notice) {
    return null;
  }

  const isSuccess = notice.status === NoticeStatus.SUCCESS;

  return (
    <Alert
      color={isSuccess ? "teal" : "red"}
      icon={isSuccess ? <IconCheck size={ALERT_ICON_SIZE_PX} /> : <IconAlertCircle size={ALERT_ICON_SIZE_PX} />}
      title={isSuccess ? ServerSettingsPageCopy.SUCCESS : ServerSettingsPageCopy.UPDATE_FAILED}
    >
      {notice.message}
    </Alert>
  );
}

function CardShell({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description: string;
  title: string;
}) {
  const palette = usePalette();

  return (
    <Card
      padding="lg"
      radius="lg"
      shadow="sm"
      style={{
        backgroundColor: palette.surface,
        border: `1px solid ${palette.line}`,
      }}
      withBorder
    >
      <Stack gap="md">
        <div>
          <Title order={CARD_TITLE_ORDER}>{title}</Title>
          <Text c="dimmed" size="sm">
            {description}
          </Text>
        </div>
        {children}
      </Stack>
    </Card>
  );
}

export function ServerSettingsPage() {
  const queryClient = useQueryClient();
  const token = useAuthStore((state) => state.token);
  const [form, setForm] = useState<ServerFormState | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const serverSettingsQuery = useQuery({
    enabled: Boolean(token),
    queryFn: ({ signal }) => backendClient.getServerSettings(token ?? EMPTY_VALUE, signal),
    queryKey: [QueryKey.SERVER_SETTINGS, token],
  });

  useEffect(() => {
    if (serverSettingsQuery.data) {
      setForm(buildServerFormState(serverSettingsQuery.data));
    }
  }, [serverSettingsQuery.data]);

  const updateMutation = useMutation({
    mutationFn: async (payload: ServerSettingsUpdateRequest) => {
      if (!token) {
        throw new Error(ServerSettingsPageCopy.UPDATE_REQUIRED);
      }

      return backendClient.updateServerSettings(token, payload);
    },
    onSuccess: async (updatedSettings) => {
      setForm(buildServerFormState(updatedSettings));
      setNotice({
        message: ServerSettingsPageCopy.SUCCESS,
        status: NoticeStatus.SUCCESS,
      });
      await queryClient.invalidateQueries({ queryKey: [QueryKey.SERVER_SETTINGS] });
    },
    onError: (error) => {
      setNotice({
        message: error instanceof Error ? error.message : ServerSettingsPageCopy.UPDATE_FAILED,
        status: NoticeStatus.ERROR,
      });
    },
  });

  function setField<Key extends keyof ServerFormState>(key: Key, value: ServerFormState[Key]): void {
    setForm((currentForm) => {
      if (!currentForm) {
        return currentForm;
      }

      return {
        ...currentForm,
        [key]: value,
      };
    });
  }

  function saveSettings(): void {
    if (!form) {
      return;
    }

    setNotice(null);
    const payload: ServerSettingsUpdateRequest = {
      qaa_generator_base_url: form.baseUrl,
    };
    if (form.superuserTokenDirty) {
      payload.qaa_generator_superuser_token = form.superuserToken;
    }
    updateMutation.mutate(payload);
  }

  return (
    <Stack gap="lg">
      <div>
        <Title order={PAGE_TITLE_ORDER}>{ServerSettingsPageCopy.TITLE}</Title>
        <Text c="dimmed">{ServerSettingsPageCopy.DESCRIPTION}</Text>
      </div>

      <CardShell
        description={ServerSettingsPageCopy.DESCRIPTION}
        title={ServerSettingsPageCopy.TITLE}
      >
        <NoticeAlert notice={notice} />

        {serverSettingsQuery.isLoading ? (
          <Stack align="center" gap="sm" py="md">
            <Loader size="lg" />
            <Text c="dimmed">{ServerSettingsPageCopy.LOADING}</Text>
          </Stack>
        ) : null}

        {serverSettingsQuery.isError ? (
          <Alert color="red" icon={<IconAlertCircle size={ALERT_ICON_SIZE_PX} />} title={ServerSettingsPageCopy.LOAD_ERROR}>
            {serverSettingsQuery.error instanceof Error
              ? serverSettingsQuery.error.message
              : ServerSettingsPageCopy.LOAD_ERROR}
          </Alert>
        ) : null}

        {form ? (
          <Stack gap="md">
            <TextInput
              label={ServerSettingsPageCopy.BASE_URL_LABEL}
              onChange={(event) => setField("baseUrl", event.currentTarget.value)}
              value={form.baseUrl}
            />
            <PasswordInput
              autoComplete={SECRET_INPUT_AUTOCOMPLETE}
              label={ServerSettingsPageCopy.SUPERUSER_TOKEN_LABEL}
              placeholder={form.superuserTokenSet ? "••••••••" : undefined}
              name={SECRET_INPUT_NAME.SUPERUSER_TOKEN}
              onChange={(event) => {
                setField("superuserToken", event.currentTarget.value);
                setField("superuserTokenDirty", true);
              }}
              value={form.superuserToken}
            />
            <Group justify="space-between">
              <Button
                onClick={() => {
                  setField("superuserToken", EMPTY_VALUE);
                  setField("superuserTokenDirty", true);
                  setField("superuserTokenSet", false);
                }}
                variant="default"
              >
                {ServerSettingsPageCopy.CLEAR_SUPERUSER_TOKEN}
              </Button>
              <Button loading={updateMutation.isPending} onClick={saveSettings}>
                {ServerSettingsPageCopy.SAVE}
              </Button>
            </Group>
          </Stack>
        ) : null}
      </CardShell>
    </Stack>
  );
}
