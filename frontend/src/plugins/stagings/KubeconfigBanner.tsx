import { Alert, Badge, Button, Group, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconAlertTriangle, IconInfoCircle, IconRefresh, IconSwitchHorizontal } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  activateKubeconfig,
  getKubeconfigStatus,
  getPreflight,
  refreshKubeconfig,
} from "@/api/agentClient";
import type { KubeconfigStatus } from "@/api/types";
import {
  DEFAULT_KUBECONFIG_STATUS_POLL_MS,
  KubeconfigAction,
  KubeconfigReasonLabel,
  QueryKey,
} from "@/constants";
import { useAuthStore } from "@/store/authStore";

const ZERO_SECONDS = 0;
const AGE_MINUTES_DIVISOR = 60;
const AGE_HOURS_DIVISOR = 60;
const AGE_DAY_DIVISOR = 24;
const ICON_SIZE = 16;

const KUBECONFIG_BANNER_TEXT = {
  ACTIVATE: "Activate",
  ACTIVATE_SUCCESS: "The staging kubeconfig is now active.",
  INFO_MESSAGE: "The staging kubeconfig is fresh but not the active one.",
  INFO_TITLE: "Staging kubeconfig is not active",
  REFRESH_ONLY: "Refresh only",
  REFRESH_ONLY_SUCCESS: "The staging kubeconfig was refreshed.",
  REFRESH_AND_ACTIVATE: "Refresh & activate",
  REFRESH_AND_ACTIVATE_SUCCESS: "The staging kubeconfig was refreshed and activated.",
  STATUS_AGE_PREFIX: "File age:",
  STATUS_TOKEN_PREFIX: "Token expires at:",
  UNHEALTHY_MESSAGE:
    "Staging operations will fail until the kubeconfig is refreshed.",
  UNHEALTHY_TITLE: "Staging kubeconfig needs attention",
} as const;

const KUBECONFIG_BANNER_COLOR = {
  INFO: "blue",
  WARNING: "yellow",
} as const;

const KUBECONFIG_BANNER_VARIANT = {
  SUBTLE: "subtle",
} as const;

const KUBECONFIG_NOTIFICATION_COLOR = {
  ERROR: "red",
  SUCCESS: "teal",
} as const;

const KUBECONFIG_NOTIFICATION_TITLE = {
  ACTIVATE_ERROR: "Activate failed",
  REFRESH_ERROR: "Refresh failed",
  REFRESH_ONLY_SUCCESS: "Kubeconfig refreshed",
  REFRESH_SUCCESS: "Kubeconfig refreshed and activated",
  SWITCH_SUCCESS: "Kubeconfig activated",
} as const;

type MutationSuccessDetail = {
  message: string;
  title: string;
};

type MutationAction = {
  execute: () => Promise<KubeconfigStatus>;
  errorTitle: string;
  success: MutationSuccessDetail;
};

function formatAge(ageSeconds: number | null, maxAgeSeconds: number): string | null {
  if (ageSeconds === null) {
    return null;
  }

  const minutes = Math.max(ZERO_SECONDS, Math.floor(ageSeconds / AGE_MINUTES_DIVISOR));
  const hours = Math.floor(minutes / AGE_HOURS_DIVISOR);
  const days = Math.floor(hours / AGE_DAY_DIVISOR);
  const remainderHours = hours % AGE_DAY_DIVISOR;
  const remainderMinutes = minutes % AGE_HOURS_DIVISOR;
  const maxHours = Math.floor(maxAgeSeconds / AGE_MINUTES_DIVISOR / AGE_HOURS_DIVISOR);

  if (days > ZERO_SECONDS) {
    return `${days}d ${remainderHours}h (max ${maxHours}h)`;
  }
  if (hours > ZERO_SECONDS) {
    return `${hours}h ${remainderMinutes}m (max ${maxHours}h)`;
  }
  return `${minutes}m (max ${maxHours}h)`;
}

function showSuccessNotification(detail: MutationSuccessDetail): void {
  notifications.show({
    color: KUBECONFIG_NOTIFICATION_COLOR.SUCCESS,
    message: detail.message,
    title: detail.title,
  });
}

function showErrorNotification(errorTitle: string, error: unknown): void {
  notifications.show({
    color: KUBECONFIG_NOTIFICATION_COLOR.ERROR,
    message: error instanceof Error ? error.message : errorTitle,
    title: errorTitle,
  });
}

function useActionMutation(
  action: MutationAction,
  onSettled: () => Promise<void>
) {
  return useMutation({
    mutationFn: action.execute,
    onError: (error) => {
      showErrorNotification(action.errorTitle, error);
    },
    onSuccess: () => {
      showSuccessNotification(action.success);
    },
    onSettled: async () => {
      await onSettled();
    },
  });
}

export function KubeconfigBanner() {
  const token = useAuthStore((state) => state.token);
  const queryClient = useQueryClient();

  const preflightQuery = useQuery({
    enabled: Boolean(token),
    queryFn: ({ signal }) => getPreflight(token ?? "", signal),
    queryKey: [QueryKey.AGENT_PREFLIGHT, token],
  });

  const agentPort = preflightQuery.data?.detected ? preflightQuery.data.port : null;

  const statusQuery = useQuery({
    enabled: Boolean(token && agentPort !== null),
    queryFn: ({ signal }) => getKubeconfigStatus(agentPort ?? ZERO_SECONDS, token ?? "", signal),
    queryKey: [QueryKey.KUBECONFIG_STATUS],
    refetchInterval: DEFAULT_KUBECONFIG_STATUS_POLL_MS,
    refetchOnWindowFocus: true,
  });

  const invalidateStatusQuery = async () => {
    await queryClient.invalidateQueries({ queryKey: [QueryKey.KUBECONFIG_STATUS] });
  };

  const refreshAndActivateMutation = useActionMutation(
    {
      execute: async () => refreshKubeconfig(agentPort ?? ZERO_SECONDS, token ?? "", true),
      errorTitle: KUBECONFIG_NOTIFICATION_TITLE.REFRESH_ERROR,
      success: {
        message: KUBECONFIG_BANNER_TEXT.REFRESH_AND_ACTIVATE_SUCCESS,
        title: KUBECONFIG_NOTIFICATION_TITLE.REFRESH_SUCCESS,
      },
    },
    invalidateStatusQuery
  );

  const refreshOnlyMutation = useActionMutation(
    {
      execute: async () => refreshKubeconfig(agentPort ?? ZERO_SECONDS, token ?? "", false),
      errorTitle: KUBECONFIG_NOTIFICATION_TITLE.REFRESH_ERROR,
      success: {
        message: KUBECONFIG_BANNER_TEXT.REFRESH_ONLY_SUCCESS,
        title: KUBECONFIG_NOTIFICATION_TITLE.REFRESH_ONLY_SUCCESS,
      },
    },
    invalidateStatusQuery
  );

  const activateMutation = useActionMutation(
    {
      execute: async () => activateKubeconfig(agentPort ?? ZERO_SECONDS, token ?? ""),
      errorTitle: KUBECONFIG_NOTIFICATION_TITLE.ACTIVATE_ERROR,
      success: {
        message: KUBECONFIG_BANNER_TEXT.ACTIVATE_SUCCESS,
        title: KUBECONFIG_NOTIFICATION_TITLE.SWITCH_SUCCESS,
      },
    },
    invalidateStatusQuery
  );

  const status = statusQuery.data;
  const mutationPending =
    refreshAndActivateMutation.isPending || refreshOnlyMutation.isPending || activateMutation.isPending;

  if (!token || preflightQuery.isError || !preflightQuery.data?.detected || agentPort === null) {
    return null;
  }

  if (!status || (status.healthy && status.active)) {
    return null;
  }

  const unhealthy = !status.healthy;
  const bannerAge = formatAge(status.ageSeconds, status.maxAgeSeconds);

  return (
    <Alert
      color={unhealthy ? KUBECONFIG_BANNER_COLOR.WARNING : KUBECONFIG_BANNER_COLOR.INFO}
      icon={unhealthy ? <IconAlertTriangle size={ICON_SIZE} /> : <IconInfoCircle size={ICON_SIZE} />}
      title={unhealthy ? KUBECONFIG_BANNER_TEXT.UNHEALTHY_TITLE : KUBECONFIG_BANNER_TEXT.INFO_TITLE}
      variant={KUBECONFIG_BANNER_VARIANT.SUBTLE}
    >
      <Stack gap="sm">
        <Text>
          {unhealthy ? KUBECONFIG_BANNER_TEXT.UNHEALTHY_MESSAGE : KUBECONFIG_BANNER_TEXT.INFO_MESSAGE}
        </Text>

        <Group gap="xs">
          {status.reasons.map((reason) => (
            <Badge color={unhealthy ? KUBECONFIG_BANNER_COLOR.WARNING : KUBECONFIG_BANNER_COLOR.INFO} key={reason} variant="light">
              {KubeconfigReasonLabel[reason]}
            </Badge>
          ))}
        </Group>

        {status.tokenExpiresAt ? (
          <Text size="sm">
            {KUBECONFIG_BANNER_TEXT.STATUS_TOKEN_PREFIX} {new Date(status.tokenExpiresAt).toLocaleString()}
          </Text>
        ) : null}

        {bannerAge ? (
          <Text size="sm">
            {KUBECONFIG_BANNER_TEXT.STATUS_AGE_PREFIX} {bannerAge}
          </Text>
        ) : null}

        <Group gap="sm">
          {status.recommendedAction === KubeconfigAction.REFRESH_AND_ACTIVATE ? (
            <Button
              disabled={mutationPending}
              leftSection={<IconRefresh size={ICON_SIZE} />}
              loading={refreshAndActivateMutation.isPending}
              onClick={() => refreshAndActivateMutation.mutate()}
            >
              {KUBECONFIG_BANNER_TEXT.REFRESH_AND_ACTIVATE}
            </Button>
          ) : null}

          {status.recommendedAction === KubeconfigAction.ACTIVATE ? (
            <Button
              disabled={mutationPending}
              leftSection={<IconSwitchHorizontal size={ICON_SIZE} />}
              loading={activateMutation.isPending}
              onClick={() => activateMutation.mutate()}
            >
              {KUBECONFIG_BANNER_TEXT.ACTIVATE}
            </Button>
          ) : null}

          {unhealthy ? (
            <Button
              disabled={mutationPending}
              loading={refreshOnlyMutation.isPending}
              onClick={() => refreshOnlyMutation.mutate()}
              variant="light"
            >
              {KUBECONFIG_BANNER_TEXT.REFRESH_ONLY}
            </Button>
          ) : null}
        </Group>
      </Stack>
    </Alert>
  );
}
