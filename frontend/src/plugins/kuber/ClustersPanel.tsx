import { Alert, Badge, Button, Group, Paper, Stack, Table, Text, Title } from "@mantine/core";
import { IconAlertCircle, IconCheck, IconRotateClockwise } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { agentClient } from "@/api/agentClient";
import { QueryKey } from "@/constants";
import { useKuberStore } from "@/plugins/kuber/kuberStore";
import { useAuthStore } from "@/store/authStore";

interface ClustersPanelProps {
  agentPort: number;
}

const ClustersPanelCopy = {
  EMPTY_BODY: "No Kubernetes contexts were returned by kubectl.",
  EMPTY_TITLE: "No contexts found",
  MISSING_BODY: "Install kubectl or point the companion app at the correct binary to enable the Kuber plugin.",
  MISSING_TITLE: "kubectl is not installed",
  RETRY: "Retry",
  SET_ACTIVE: "Set as active",
  SET_ACTIVE_ERROR: "Set active context failed",
  SUBTITLE:
    "Inspect the real contexts merged from your local kubeconfig and optionally persist one as the active kubectl context.",
  TABLE_CLUSTER: "Cluster",
  TABLE_CURRENT: "Current",
  TABLE_NAME: "Context",
  TABLE_NAMESPACE: "Namespace",
  TABLE_USER: "User",
  TITLE: "Clusters",
} as const;

export function ClustersPanel({ agentPort }: ClustersPanelProps) {
  const queryClient = useQueryClient();
  const token = useAuthStore((state) => state.token);
  const selectedContext = useKuberStore((state) => state.selectedContext);
  const setSelectedContext = useKuberStore((state) => state.setSelectedContext);

  const contextsQuery = useQuery({
    enabled: Boolean(token),
    queryFn: ({ signal }) => agentClient.getKubeContexts(agentPort, token ?? "", signal),
    queryKey: [QueryKey.KUBE_CONTEXTS, agentPort, token],
    refetchOnWindowFocus: false,
    retry: false,
  });

  const useContextMutation = useMutation({
    mutationFn: async (context: string) => {
      if (!token) {
        throw new Error(ClustersPanelCopy.SET_ACTIVE_ERROR);
      }
      return agentClient.useKubeContext(agentPort, token, context);
    },
    onSuccess: async (_, context) => {
      setSelectedContext(context);
      await queryClient.invalidateQueries({
        queryKey: [QueryKey.KUBE_CONTEXTS, agentPort, token],
      });
    },
  });

  if (contextsQuery.isError) {
    if (contextsQuery.error instanceof Error && contextsQuery.error.message === "kubectl is not installed.") {
      return (
        <Paper p="xl" radius="lg" withBorder>
          <Stack gap="sm">
            <Title order={3}>{ClustersPanelCopy.MISSING_TITLE}</Title>
            <Text c="dimmed">{ClustersPanelCopy.MISSING_BODY}</Text>
            <Group>
              <Button leftSection={<IconRotateClockwise size={16} />} onClick={() => void contextsQuery.refetch()}>
                {ClustersPanelCopy.RETRY}
              </Button>
            </Group>
          </Stack>
        </Paper>
      );
    }

    return (
      <Alert color="red" icon={<IconAlertCircle size={18} />} title={ClustersPanelCopy.SET_ACTIVE_ERROR}>
        <Text>
          {contextsQuery.error instanceof Error
            ? contextsQuery.error.message
            : ClustersPanelCopy.SET_ACTIVE_ERROR}
        </Text>
      </Alert>
    );
  }

  if ((contextsQuery.data?.contexts.length ?? 0) === 0) {
    return (
      <Paper p="xl" radius="lg" withBorder>
        <Stack gap="sm">
          <Title order={3}>{ClustersPanelCopy.EMPTY_TITLE}</Title>
          <Text c="dimmed">{ClustersPanelCopy.EMPTY_BODY}</Text>
          <Group>
            <Button leftSection={<IconRotateClockwise size={16} />} onClick={() => void contextsQuery.refetch()}>
              {ClustersPanelCopy.RETRY}
            </Button>
          </Group>
        </Stack>
      </Paper>
    );
  }

  return (
    <Stack gap="lg">
      <div>
        <Title order={3}>{ClustersPanelCopy.TITLE}</Title>
        <Text c="dimmed" size="sm">
          {ClustersPanelCopy.SUBTITLE}
        </Text>
      </div>

      {useContextMutation.isError ? (
        <Alert color="red" icon={<IconAlertCircle size={18} />} title={ClustersPanelCopy.SET_ACTIVE_ERROR}>
          <Text>
            {useContextMutation.error instanceof Error
              ? useContextMutation.error.message
              : ClustersPanelCopy.SET_ACTIVE_ERROR}
          </Text>
        </Alert>
      ) : null}

      <Table.ScrollContainer minWidth={880}>
        <Table highlightOnHover striped withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{ClustersPanelCopy.TABLE_NAME}</Table.Th>
              <Table.Th>{ClustersPanelCopy.TABLE_CLUSTER}</Table.Th>
              <Table.Th>{ClustersPanelCopy.TABLE_USER}</Table.Th>
              <Table.Th>{ClustersPanelCopy.TABLE_NAMESPACE}</Table.Th>
              <Table.Th>{ClustersPanelCopy.TABLE_CURRENT}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {contextsQuery.data?.contexts.map((context) => {
              const rowSelected = (selectedContext ?? contextsQuery.data?.currentContext) === context.name;
              return (
                <Table.Tr
                  key={context.name}
                  onClick={() => setSelectedContext(context.name)}
                  style={{
                    backgroundColor: rowSelected ? "rgba(34, 139, 230, 0.08)" : undefined,
                    cursor: "pointer",
                  }}
                >
                  <Table.Td>{context.name}</Table.Td>
                  <Table.Td>{context.cluster}</Table.Td>
                  <Table.Td>{context.user}</Table.Td>
                  <Table.Td>{context.namespace ?? "default"}</Table.Td>
                  <Table.Td>
                    <Group justify="space-between" wrap="nowrap">
                      {context.current ? (
                        <Badge color="teal" variant="light">
                          Current
                        </Badge>
                      ) : (
                        <span />
                      )}
                      <Button
                        leftSection={<IconCheck size={16} />}
                        loading={useContextMutation.isPending && useContextMutation.variables === context.name}
                        onClick={(event) => {
                          event.stopPropagation();
                          useContextMutation.mutate(context.name);
                        }}
                        size="xs"
                        variant="light"
                      >
                        {ClustersPanelCopy.SET_ACTIVE}
                      </Button>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Stack>
  );
}
