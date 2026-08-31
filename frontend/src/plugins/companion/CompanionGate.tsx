import type { ReactNode } from "react";
import { Alert, Button, Code, CopyButton, Group, Loader, Stack, Text } from "@mantine/core";
import {
  IconAlertCircle,
  IconPlugConnectedX,
  IconRotateClockwise,
  IconUpload,
} from "@tabler/icons-react";

import type { AgentManifest, AgentPingResponse } from "@/api/types";
import { BackendPath, CompanionStatusKind } from "@/constants";
import { useCompanionStatus } from "@/plugins/companion/useCompanionStatus";

const CompanionGateCopy = {
  COPIED: "Copied",
  COPY_COMMAND: "Copy command",
  ERROR_TITLE: "Companion status failed",
  INSTALL_COMMAND_PREFIX: "Install command:",
  NOT_INSTALLED_BODY:
    "Copy the command below and run it in a terminal to install the companion, then reload this page (F5).",
  NOT_INSTALLED_TITLE: "Companion is not installed",
  UPDATE_AVAILABLE_BODY:
    "A newer companion build is available from this portal. You can keep working while the update is applied.",
  UPDATE_REQUIRED_BODY:
    "This portal now requires a newer companion build before the protected plugin can continue.",
  UPDATE_REQUIRED_TITLE: "Update required",
  UPDATE_TITLE: "Update available",
  UPDATE_BUTTON: "Update",
  UPDATING_BUTTON: "Updating...",
} as const;

function buildInstallCommand(): string {
  return `curl -fsSL ${window.location.origin}${BackendPath.AGENT_INSTALL_SCRIPT} | bash`;
}

function renderChildren(
  children: ReactNode | ((context: { agent: AgentPingResponse; agentPort: number; manifest: AgentManifest }) => ReactNode),
  context: { agent: AgentPingResponse; agentPort: number; manifest: AgentManifest }
): ReactNode {
  if (typeof children === "function") {
    return children(context);
  }
  return children;
}

export function CompanionGate({
  children,
  enabled = true,
  errorTitle = CompanionGateCopy.ERROR_TITLE,
  loadingMessage,
}: {
  children: ReactNode | ((context: { agent: AgentPingResponse; agentPort: number; manifest: AgentManifest }) => ReactNode);
  enabled?: boolean;
  errorTitle?: string;
  loadingMessage: string;
}) {
  const status = useCompanionStatus({ enabled });

  if (status.kind === CompanionStatusKind.LOADING) {
    return (
      <Stack align="center" gap="md" py="xl">
        <Loader size="lg" />
        <Text c="dimmed">{loadingMessage}</Text>
      </Stack>
    );
  }

  if (status.kind === CompanionStatusKind.ERROR) {
    return (
      <Alert color="red" icon={<IconAlertCircle size={18} />} title={errorTitle}>
        <Stack gap="sm">
          <Text>{status.error?.message ?? errorTitle}</Text>
          <Group>
            <Button leftSection={<IconRotateClockwise size={16} />} onClick={() => void status.refresh()}>
              {status.retryLabel}
            </Button>
          </Group>
        </Stack>
      </Alert>
    );
  }

  if (status.kind === CompanionStatusKind.NOT_INSTALLED && status.manifest) {
    return (
      <Alert color="yellow" icon={<IconPlugConnectedX size={18} />} title={CompanionGateCopy.NOT_INSTALLED_TITLE}>
        <Stack gap="sm">
          <Text>{CompanionGateCopy.NOT_INSTALLED_BODY}</Text>
          <Text c="dimmed" size="sm">
            {CompanionGateCopy.INSTALL_COMMAND_PREFIX}
          </Text>
          <Group align="flex-start" gap="xs" wrap="nowrap">
            <Code block style={{ flex: 1 }}>
              {buildInstallCommand()}
            </Code>
            <CopyButton value={buildInstallCommand()}>
              {({ copied, copy }) => (
                <Button variant="light" onClick={copy}>
                  {copied ? CompanionGateCopy.COPIED : CompanionGateCopy.COPY_COMMAND}
                </Button>
              )}
            </CopyButton>
          </Group>
        </Stack>
      </Alert>
    );
  }

  if (
    status.kind === CompanionStatusKind.UPDATE_REQUIRED &&
    status.agent &&
    status.manifest &&
    status.port !== null
  ) {
    return (
      <Alert color="red" icon={<IconUpload size={18} />} title={CompanionGateCopy.UPDATE_REQUIRED_TITLE}>
        <Stack gap="sm">
          <Text>{CompanionGateCopy.UPDATE_REQUIRED_BODY}</Text>
          <Text c="dimmed" size="sm">
            Installed: {status.agent.version}. Required: {status.manifest.minSupported}. Latest: {status.manifest.version}.
          </Text>
          <Group>
            <Button
              leftSection={<IconUpload size={16} />}
              loading={status.isUpdating}
              onClick={() => void status.update()}
            >
              {status.isUpdating ? CompanionGateCopy.UPDATING_BUTTON : CompanionGateCopy.UPDATE_BUTTON}
            </Button>
            <Button leftSection={<IconRotateClockwise size={16} />} onClick={() => void status.refresh()} variant="subtle">
              {status.retryLabel}
            </Button>
          </Group>
          {status.updateError ? <Text c="red" size="sm">{status.updateError.message}</Text> : null}
        </Stack>
      </Alert>
    );
  }

  if (
    status.kind === CompanionStatusKind.UPDATE_AVAILABLE &&
    status.agent &&
    status.manifest &&
    status.port !== null
  ) {
    return (
      <Stack gap="md">
        <Alert color="blue" icon={<IconUpload size={18} />} title={CompanionGateCopy.UPDATE_TITLE}>
          <Stack gap="sm">
            <Text>{CompanionGateCopy.UPDATE_AVAILABLE_BODY}</Text>
            <Text c="dimmed" size="sm">
              Installed: {status.agent.version}. Latest: {status.manifest.version}.
            </Text>
            <Group>
              <Button
                leftSection={<IconUpload size={16} />}
                loading={status.isUpdating}
                onClick={() => void status.update()}
              >
                {status.isUpdating ? CompanionGateCopy.UPDATING_BUTTON : CompanionGateCopy.UPDATE_BUTTON}
              </Button>
              <Button leftSection={<IconRotateClockwise size={16} />} onClick={() => void status.refresh()} variant="subtle">
                {status.retryLabel}
              </Button>
            </Group>
            {status.updateError ? <Text c="red" size="sm">{status.updateError.message}</Text> : null}
          </Stack>
        </Alert>
        {renderChildren(children, { agent: status.agent, agentPort: status.port, manifest: status.manifest })}
      </Stack>
    );
  }

  if (status.agent && status.manifest && status.port !== null) {
    return renderChildren(children, {
      agent: status.agent,
      agentPort: status.port,
      manifest: status.manifest,
    });
  }

  return null;
}
