import { useEffect, useState } from "react";
import { Alert, Button, Group, Loader, PasswordInput, Stack, Switch, Text, TextInput, Title } from "@mantine/core";
import { IconAlertCircle, IconCheck } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { backendClient } from "@/api/backendClient";
import type { MeUpdateRequest } from "@/api/types";
import { QueryKey } from "@/constants";
import { useAuthStore } from "@/store/authStore";

const AccountPanelCopy = {
  AUTO_LOGIN_DESCRIPTION:
    "This updates the server-side account preference only. Browser remembered-login behavior stays unchanged.",
  AUTO_LOGIN_LABEL: "Auto-login",
  CONFIRM_PASSWORD_LABEL: "Confirm password",
  DISPLAY_NAME_LABEL: "Display name",
  LOADING: "Loading account settings.",
  NEW_PASSWORD_LABEL: "New password",
  SAVE: "Save account changes",
  SUCCESS: "Account settings saved.",
  TITLE: "Account",
  UPDATE_FAILED: "Update failed",
  UPDATE_REQUIRED: "Authentication is required.",
} as const;

const EMPTY_VALUE = "" as const;
const SUCCESS_STATUS = "success" as const;
const ERROR_STATUS = "error" as const;

type AccountNotice = {
  message: string;
  status: typeof SUCCESS_STATUS | typeof ERROR_STATUS;
};

type AccountFormState = {
  autoLogin: boolean;
  confirmPassword: string;
  displayName: string;
  password: string;
};

function buildFormState(
  currentUser: ReturnType<typeof useAuthStore.getState>["currentUser"]
): AccountFormState {
  return {
    autoLogin: currentUser?.auto_login ?? false,
    confirmPassword: EMPTY_VALUE,
    displayName: currentUser?.display_name ?? EMPTY_VALUE,
    password: EMPTY_VALUE,
  };
}

export function AccountPanel() {
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((state) => state.currentUser);
  const setCurrentUser = useAuthStore((state) => state.setCurrentUser);
  const token = useAuthStore((state) => state.token);
  const [form, setForm] = useState<AccountFormState>(() => buildFormState(currentUser));
  const [notice, setNotice] = useState<AccountNotice | null>(null);

  useEffect(() => {
    setForm(buildFormState(currentUser));
  }, [currentUser]);

  const updateMutation = useMutation({
    mutationFn: async (payload: MeUpdateRequest) => {
      if (!token) {
        throw new Error(AccountPanelCopy.UPDATE_REQUIRED);
      }

      return backendClient.updateMe(token, payload);
    },
    onSuccess: async (updatedUser) => {
      setCurrentUser(updatedUser);
      setForm(buildFormState(updatedUser));
      setNotice({
        message: AccountPanelCopy.SUCCESS,
        status: SUCCESS_STATUS,
      });
      await queryClient.invalidateQueries({ queryKey: [QueryKey.ME] });
    },
    onError: (error) => {
      setNotice({
        message: error instanceof Error ? error.message : AccountPanelCopy.UPDATE_FAILED,
        status: ERROR_STATUS,
      });
    },
  });

  if (!currentUser) {
    return (
      <Stack align="center" gap="sm" py="xl">
        <Loader size="lg" />
        <Text c="dimmed">{AccountPanelCopy.LOADING}</Text>
      </Stack>
    );
  }

  const resolvedCurrentUser = currentUser;

  function setField<Key extends keyof AccountFormState>(key: Key, value: AccountFormState[Key]): void {
    setForm((currentForm) => ({
      ...currentForm,
      [key]: value,
    }));
  }

  function handleSubmit(): void {
    setNotice(null);

    if (form.password !== form.confirmPassword) {
      setNotice({
        message: "Passwords do not match.",
        status: ERROR_STATUS,
      });
      return;
    }

    const payload: MeUpdateRequest = {};
    if (form.displayName !== resolvedCurrentUser.display_name) {
      payload.display_name = form.displayName;
    }
    if (form.autoLogin !== resolvedCurrentUser.auto_login) {
      // This differs from the client-side remembered-credentials auto-login preference.
      payload.auto_login = form.autoLogin;
    }
    if (form.password.trim().length > 0) {
      payload.password = form.password;
    }

    if (Object.keys(payload).length === 0) {
      setNotice({
        message: AccountPanelCopy.SUCCESS,
        status: SUCCESS_STATUS,
      });
      return;
    }

    updateMutation.mutate(payload);
  }

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>{AccountPanelCopy.TITLE}</Title>
        <Text c="dimmed">
          Update the account details stored for your signed-in user.
        </Text>
      </div>

      {notice ? (
        <Alert
          color={notice.status === SUCCESS_STATUS ? "teal" : "red"}
          icon={notice.status === SUCCESS_STATUS ? <IconCheck size={18} /> : <IconAlertCircle size={18} />}
          title={notice.status === SUCCESS_STATUS ? AccountPanelCopy.SUCCESS : AccountPanelCopy.UPDATE_FAILED}
        >
          {notice.message}
        </Alert>
      ) : null}

      <Stack gap="md" maw={520}>
        <TextInput
          label={AccountPanelCopy.DISPLAY_NAME_LABEL}
          onChange={(event) => setField("displayName", event.currentTarget.value)}
          value={form.displayName}
        />
        <PasswordInput
          label={AccountPanelCopy.NEW_PASSWORD_LABEL}
          onChange={(event) => setField("password", event.currentTarget.value)}
          value={form.password}
        />
        <PasswordInput
          label={AccountPanelCopy.CONFIRM_PASSWORD_LABEL}
          onChange={(event) => setField("confirmPassword", event.currentTarget.value)}
          value={form.confirmPassword}
        />
        <Switch
          checked={form.autoLogin}
          label={AccountPanelCopy.AUTO_LOGIN_LABEL}
          onChange={(event) => setField("autoLogin", event.currentTarget.checked)}
        />
        <Text c="dimmed" size="sm">
          {AccountPanelCopy.AUTO_LOGIN_DESCRIPTION}
        </Text>
        <Group justify="flex-start">
          <Button loading={updateMutation.isPending} onClick={handleSubmit}>
            {AccountPanelCopy.SAVE}
          </Button>
        </Group>
      </Stack>
    </Stack>
  );
}
