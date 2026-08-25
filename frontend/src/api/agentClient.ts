import {
  AGENT_APP_NAME,
  AGENT_HOST,
  AGENT_REQUEST_HEADER,
  AGENT_REQUEST_HEADER_VALUE,
  AgentPath,
  buildAgentJenkinsBuildsPath,
  buildAgentJenkinsFolderPath,
  buildAgentLeonidObjectDefinitionTogglePath,
  buildAgentLeonidObjectDefinitionsPath,
  buildAgentNotificatorChoicesPath,
  buildAgentNotificatorConfigsPath,
  buildAgentNotificatorEventsPath,
  buildAgentNotificatorFailReasonsPath,
  buildAgentNotificatorFailureMentionRulesPath,
  buildAgentNotificatorHistoryPath,
  buildAgentNotificatorMuteStatusesPath,
  buildAgentNotificatorProductsPath,
  buildAgentNotificatorQaaMembersPath,
  buildAgentNotificatorRecurrentFailsPath,
  buildAgentNotificatorSlackChannelsPath,
  buildAgentNotificatorSubProductsPath,
  buildAgentNotificatorTeamsPath,
  buildAgentNotificatorUsersPath,
  buildAgentLeonidObjectValueTogglePath,
  buildAgentLeonidObjectValuesPath,
  buildAgentLeonidPipelineParamsPath,
  buildAgentLeonidSharedResourceLimitTypesPath,
  buildAgentLeonidSharedResourceLimitsPath,
  buildAgentLeonidSharedResourcesPath,
  buildAgentLeonidSharedResourceTogglePath,
  buildAgentJenkinsScopePath,
  buildAgentJenkinsTreePath,
  AUTH_SCHEME_BEARER,
  buildAgentE2eSuitesPath,
  buildAgentJobCancelPath,
  buildAgentJobPath,
  buildAgentJobStreamPath,
  buildAgentKubeNamespacesPath,
  buildAgentKubePodDeletePath,
  buildAgentKubePodDescribePath,
  buildAgentKubePodLogsPath,
  buildAgentKubePodsPath,
  buildAgentKubeTopPath,
  buildAgentNamespaceCredsPath,
  buildAgentNamespaceDeployRecipePath,
  buildAgentNamespaceLogsPath,
  buildAgentNamespaceStatusPath,
  HttpHeader,
  HttpMethod,
  JobStreamEvent,
  MediaType,
  type Product,
} from "@/constants";
import type {
  AdoptRequest,
  AgentUpdateAccepted,
  AgentSettings,
  AgentSettingsUpdate,
  AgentPingResponse,
  AgentPreflightState,
  DeployRequest,
  DestroyRequest,
  E2eRunRequest,
  E2eSuitesResponse,
  JenkinsBuildsResponse,
  JenkinsFolderResponse,
  JenkinsFreezeRequest,
  JenkinsFreezeResponse,
  LeonidObjectDefinition,
  LeonidObjectDefinitionInput,
  NotificatorChoices,
  NotificatorEvent,
  NotificatorFailReason,
  NotificatorFailureMentionRule,
  NotificatorHistoryItem,
  NotificatorMuteStatus,
  NotificatorNotificationConfig,
  NotificatorNotificationConfigInput,
  NotificatorProduct,
  NotificatorProductInput,
  NotificatorProductTeam,
  NotificatorQaaMember,
  NotificatorRecurrentFail,
  NotificatorSlackChannel,
  NotificatorSlackChannelInput,
  NotificatorSubProduct,
  NotificatorSubProductInput,
  NotificatorFullUser,
  LeonidObjectValue,
  LeonidObjectValueInput,
  LeonidPipelineParam,
  LeonidPipelineParamInput,
  LeonidSharedResource,
  LeonidSharedResourceInput,
  LeonidSharedResourceLimit,
  LeonidSharedResourceLimitInput,
  LeonidSharedResourceLimitType,
  JenkinsResumeRequest,
  JenkinsResumeRunAccepted,
  JenkinsResumeRunRequest,
  JenkinsResumeResponse,
  JenkinsScopeResponse,
  JenkinsTreeResponse,
  JobCreateResponse,
  KubeCommandResult,
  KubeconfigRefreshRequest,
  KubeconfigStatus,
  KubeContextsResponse,
  KubeDeletePodRequest,
  KubeNamespacesResponse,
  KubePodDescribe,
  KubePodsResponse,
  KubeTopResponse,
  KubeUseContextRequest,
  JobLogEvent,
  JobRead,
  JobStreamMessage,
  JobTerminalEvent,
  NamespaceCreds,
  NamespaceDeployRecipe,
  NamespaceList,
  NamespaceStatus,
  PreflightItem,
  SyncRequest,
} from "@/api/types";
import { resolveAgentPortRange } from "@/core/runtimeConfig";
import { parseSseStream } from "@/api/sse";

export class AgentRequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AgentRequestError";
    this.status = status;
  }
}

type AgentDiscovery = {
  agent: AgentPingResponse;
  port: number;
};

function buildAgentUrl(port: number, path: string): string {
  return `http://${AGENT_HOST}:${port}${path}`;
}

function createAgentHeaders(token?: string, extraHeaders?: HeadersInit): Headers {
  const headers = new Headers(extraHeaders);
  headers.set(HttpHeader.ACCEPT, MediaType.JSON);
  headers.set(AGENT_REQUEST_HEADER, AGENT_REQUEST_HEADER_VALUE);

  if (token) {
    headers.set(HttpHeader.AUTHORIZATION, `${AUTH_SCHEME_BEARER} ${token}`);
  }

  return headers;
}

async function readAgentJson<T>(
  port: number,
  path: string,
  init: RequestInit = {},
  token?: string,
  signal?: AbortSignal
): Promise<T> {
  const response = await fetch(buildAgentUrl(port, path), {
    ...init,
    headers: createAgentHeaders(token, init.headers),
    signal,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new AgentRequestError(payload?.detail ?? "Agent request failed.", response.status);
  }

  return (await response.json()) as T;
}

async function writeAgentJson<T>(
  port: number,
  path: string,
  method: HttpMethod,
  token: string,
  body?: unknown,
  signal?: AbortSignal
): Promise<T> {
  return readAgentJson<T>(
    port,
    path,
    body === undefined ? { method } : createJsonBody(body, method),
    token,
    signal
  );
}

async function probeAgentPort(port: number, signal?: AbortSignal): Promise<AgentDiscovery | null> {
  try {
    const agent = await readAgentJson<AgentPingResponse>(
      port,
      AgentPath.PING,
      { method: HttpMethod.GET },
      undefined,
      signal
    );
    return agent.app === AGENT_APP_NAME ? { agent, port } : null;
  } catch {
    return null;
  }
}

function createJsonBody(
  body: unknown,
  method: HttpMethod = HttpMethod.POST
): Pick<RequestInit, "body" | "headers" | "method"> {
  return {
    body: JSON.stringify(body),
    headers: {
      [HttpHeader.CONTENT_TYPE]: MediaType.JSON,
    },
    method,
  };
}

export function getConfiguredAgentPorts(): number[] {
  return resolveAgentPortRange();
}

export async function discoverAgent(signal?: AbortSignal): Promise<AgentDiscovery | null> {
  const ports = getConfiguredAgentPorts();
  for (const port of ports) {
    const match = await probeAgentPort(port, signal);
    if (match) {
      return match;
    }
  }

  return null;
}

export async function getPreflight(token: string, signal?: AbortSignal): Promise<AgentPreflightState> {
  const ports = getConfiguredAgentPorts();
  const discovery = await discoverAgent(signal);
  if (!discovery) {
    return {
      detected: false,
      ports,
    };
  }

  const checklist = await readAgentJson<PreflightItem[]>(
    discovery.port,
    AgentPath.PREFLIGHT,
    { method: HttpMethod.GET },
    token,
    signal
  );

  return {
    agent: discovery.agent,
    checklist,
    detected: true,
    port: discovery.port,
  };
}

export function getPing(port: number, signal?: AbortSignal): Promise<AgentPingResponse> {
  return readAgentJson<AgentPingResponse>(
    port,
    AgentPath.PING,
    { method: HttpMethod.GET },
    undefined,
    signal
  );
}

export function getPreflightItems(
  port: number,
  token: string,
  signal?: AbortSignal
): Promise<PreflightItem[]> {
  return readAgentJson<PreflightItem[]>(
    port,
    AgentPath.PREFLIGHT,
    { method: HttpMethod.GET },
    token,
    signal
  );
}

export function requestAgentUpdate(
  port: number,
  token: string,
  signal?: AbortSignal
): Promise<AgentUpdateAccepted> {
  return readAgentJson<AgentUpdateAccepted>(
    port,
    AgentPath.UPDATE,
    { method: HttpMethod.POST },
    token,
    signal
  );
}

export function getJenkinsTree(
  port: number,
  token: string,
  signal?: AbortSignal
): Promise<JenkinsTreeResponse> {
  return readAgentJson<JenkinsTreeResponse>(
    port,
    buildAgentJenkinsTreePath(),
    { method: HttpMethod.GET },
    token,
    signal
  );
}

export function getJenkinsScope(
  port: number,
  token: string,
  signal?: AbortSignal
): Promise<JenkinsScopeResponse> {
  return readAgentJson<JenkinsScopeResponse>(
    port,
    buildAgentJenkinsScopePath(),
    { method: HttpMethod.GET },
    token,
    signal
  );
}

export function getJenkinsBuilds(
  port: number,
  token: string,
  path: string,
  signal?: AbortSignal
): Promise<JenkinsBuildsResponse> {
  return readAgentJson<JenkinsBuildsResponse>(
    port,
    buildAgentJenkinsBuildsPath(path),
    { method: HttpMethod.GET },
    token,
    signal
  );
}

export function getJenkinsFolder(
  port: number,
  token: string,
  path: string,
  signal?: AbortSignal
): Promise<JenkinsFolderResponse> {
  return readAgentJson<JenkinsFolderResponse>(
    port,
    buildAgentJenkinsFolderPath(path),
    { method: HttpMethod.GET },
    token,
    signal
  );
}

function listNotificatorCollection<T>(
  port: number,
  token: string,
  path: string,
  signal?: AbortSignal
): Promise<T[]> {
  return readAgentJson<T[]>(port, path, { method: HttpMethod.GET }, token, signal);
}

function createNotificatorItem<T>(
  port: number,
  token: string,
  path: string,
  payload: unknown,
  signal?: AbortSignal
): Promise<T> {
  return writeAgentJson<T>(port, path, HttpMethod.POST, token, payload, signal);
}

function updateNotificatorItem<T>(
  port: number,
  token: string,
  path: string,
  payload: unknown,
  signal?: AbortSignal
): Promise<T> {
  return writeAgentJson<T>(port, path, HttpMethod.PUT, token, payload, signal);
}

function deleteNotificatorItem(
  port: number,
  token: string,
  path: string,
  signal?: AbortSignal
): Promise<void> {
  return writeAgentJson<void>(port, path, HttpMethod.DELETE, token, undefined, signal);
}

export function getNotificatorChoices(
  port: number,
  token: string,
  signal?: AbortSignal
): Promise<NotificatorChoices> {
  return readAgentJson<NotificatorChoices>(
    port,
    buildAgentNotificatorChoicesPath(),
    { method: HttpMethod.GET },
    token,
    signal
  );
}

export function listNotificatorNotificationConfigs(
  port: number,
  token: string,
  productTeam?: string,
  signal?: AbortSignal
): Promise<NotificatorNotificationConfig[]> {
  return listNotificatorCollection<NotificatorNotificationConfig>(
    port,
    token,
    buildAgentNotificatorConfigsPath({ productTeam }),
    signal
  );
}

export function createNotificatorNotificationConfig(
  port: number,
  token: string,
  payload: NotificatorNotificationConfigInput,
  signal?: AbortSignal
): Promise<NotificatorNotificationConfig> {
  return createNotificatorItem<NotificatorNotificationConfig>(
    port,
    token,
    buildAgentNotificatorConfigsPath(),
    payload,
    signal
  );
}

export function updateNotificatorNotificationConfig(
  port: number,
  token: string,
  configId: number,
  payload: NotificatorNotificationConfigInput,
  signal?: AbortSignal
): Promise<NotificatorNotificationConfig> {
  return updateNotificatorItem<NotificatorNotificationConfig>(
    port,
    token,
    buildAgentNotificatorConfigsPath({ configId }),
    payload,
    signal
  );
}

export function deleteNotificatorNotificationConfig(
  port: number,
  token: string,
  configId: number,
  signal?: AbortSignal
): Promise<void> {
  return deleteNotificatorItem(
    port,
    token,
    buildAgentNotificatorConfigsPath({ configId }),
    signal
  );
}

export function listNotificatorTeams(
  port: number,
  token: string,
  signal?: AbortSignal
): Promise<NotificatorProductTeam[]> {
  return listNotificatorCollection<NotificatorProductTeam>(
    port,
    token,
    buildAgentNotificatorTeamsPath(),
    signal
  );
}

export function listNotificatorProducts(
  port: number,
  token: string,
  signal?: AbortSignal
): Promise<NotificatorProduct[]> {
  return listNotificatorCollection<NotificatorProduct>(
    port,
    token,
    buildAgentNotificatorProductsPath(),
    signal
  );
}

export function createNotificatorProduct(
  port: number,
  token: string,
  payload: NotificatorProductInput,
  signal?: AbortSignal
): Promise<NotificatorProduct> {
  return createNotificatorItem<NotificatorProduct>(
    port,
    token,
    buildAgentNotificatorProductsPath(),
    payload,
    signal
  );
}

export function updateNotificatorProduct(
  port: number,
  token: string,
  productId: number,
  payload: NotificatorProductInput,
  signal?: AbortSignal
): Promise<NotificatorProduct> {
  return updateNotificatorItem<NotificatorProduct>(
    port,
    token,
    buildAgentNotificatorProductsPath(productId),
    payload,
    signal
  );
}

export function deleteNotificatorProduct(
  port: number,
  token: string,
  productId: number,
  signal?: AbortSignal
): Promise<void> {
  return deleteNotificatorItem(
    port,
    token,
    buildAgentNotificatorProductsPath(productId),
    signal
  );
}

export function listNotificatorSubProducts(
  port: number,
  token: string,
  signal?: AbortSignal
): Promise<NotificatorSubProduct[]> {
  return listNotificatorCollection<NotificatorSubProduct>(
    port,
    token,
    buildAgentNotificatorSubProductsPath(),
    signal
  );
}

export function createNotificatorSubProduct(
  port: number,
  token: string,
  payload: NotificatorSubProductInput,
  signal?: AbortSignal
): Promise<NotificatorSubProduct> {
  return createNotificatorItem<NotificatorSubProduct>(
    port,
    token,
    buildAgentNotificatorSubProductsPath(),
    payload,
    signal
  );
}

export function updateNotificatorSubProduct(
  port: number,
  token: string,
  subProductId: number,
  payload: NotificatorSubProductInput,
  signal?: AbortSignal
): Promise<NotificatorSubProduct> {
  return updateNotificatorItem<NotificatorSubProduct>(
    port,
    token,
    buildAgentNotificatorSubProductsPath(subProductId),
    payload,
    signal
  );
}

export function deleteNotificatorSubProduct(
  port: number,
  token: string,
  subProductId: number,
  signal?: AbortSignal
): Promise<void> {
  return deleteNotificatorItem(
    port,
    token,
    buildAgentNotificatorSubProductsPath(subProductId),
    signal
  );
}

export function listNotificatorSlackChannels(
  port: number,
  token: string,
  signal?: AbortSignal
): Promise<NotificatorSlackChannel[]> {
  return listNotificatorCollection<NotificatorSlackChannel>(
    port,
    token,
    buildAgentNotificatorSlackChannelsPath(),
    signal
  );
}

export function createNotificatorSlackChannel(
  port: number,
  token: string,
  payload: NotificatorSlackChannelInput,
  signal?: AbortSignal
): Promise<NotificatorSlackChannel> {
  return createNotificatorItem<NotificatorSlackChannel>(
    port,
    token,
    buildAgentNotificatorSlackChannelsPath(),
    payload,
    signal
  );
}

export function updateNotificatorSlackChannel(
  port: number,
  token: string,
  channelId: number,
  payload: NotificatorSlackChannelInput,
  signal?: AbortSignal
): Promise<NotificatorSlackChannel> {
  return updateNotificatorItem<NotificatorSlackChannel>(
    port,
    token,
    buildAgentNotificatorSlackChannelsPath(channelId),
    payload,
    signal
  );
}

export function deleteNotificatorSlackChannel(
  port: number,
  token: string,
  channelId: number,
  signal?: AbortSignal
): Promise<void> {
  return deleteNotificatorItem(
    port,
    token,
    buildAgentNotificatorSlackChannelsPath(channelId),
    signal
  );
}

export function listNotificatorUsers(
  port: number,
  token: string,
  signal?: AbortSignal
): Promise<NotificatorFullUser[]> {
  return listNotificatorCollection<NotificatorFullUser>(
    port,
    token,
    buildAgentNotificatorUsersPath(),
    signal
  );
}

export function listNotificatorQaaMembers(
  port: number,
  token: string,
  signal?: AbortSignal
): Promise<NotificatorQaaMember[]> {
  return listNotificatorCollection<NotificatorQaaMember>(
    port,
    token,
    buildAgentNotificatorQaaMembersPath(),
    signal
  );
}

export function listNotificatorFailureMentionRules(
  port: number,
  token: string,
  signal?: AbortSignal
): Promise<NotificatorFailureMentionRule[]> {
  return listNotificatorCollection<NotificatorFailureMentionRule>(
    port,
    token,
    buildAgentNotificatorFailureMentionRulesPath(),
    signal
  );
}

export function listNotificatorEvents(
  port: number,
  token: string,
  signal?: AbortSignal
): Promise<NotificatorEvent[]> {
  return listNotificatorCollection<NotificatorEvent>(
    port,
    token,
    buildAgentNotificatorEventsPath(),
    signal
  );
}

export function listNotificatorRecurrentFails(
  port: number,
  token: string,
  signal?: AbortSignal
): Promise<NotificatorRecurrentFail[]> {
  return listNotificatorCollection<NotificatorRecurrentFail>(
    port,
    token,
    buildAgentNotificatorRecurrentFailsPath(),
    signal
  );
}

export function listNotificatorFailReasons(
  port: number,
  token: string,
  signal?: AbortSignal
): Promise<NotificatorFailReason[]> {
  return listNotificatorCollection<NotificatorFailReason>(
    port,
    token,
    buildAgentNotificatorFailReasonsPath(),
    signal
  );
}

export function listNotificatorMuteStatuses(
  port: number,
  token: string,
  signal?: AbortSignal
): Promise<NotificatorMuteStatus[]> {
  return listNotificatorCollection<NotificatorMuteStatus>(
    port,
    token,
    buildAgentNotificatorMuteStatusesPath(),
    signal
  );
}

export function listNotificatorHistory(
  port: number,
  token: string,
  signal?: AbortSignal
): Promise<NotificatorHistoryItem[]> {
  return listNotificatorCollection<NotificatorHistoryItem>(
    port,
    token,
    buildAgentNotificatorHistoryPath(),
    signal
  );
}

export function listLeonidSharedResourceLimitTypes(
  port: number,
  token: string,
  signal?: AbortSignal
): Promise<LeonidSharedResourceLimitType[]> {
  return readAgentJson<LeonidSharedResourceLimitType[]>(
    port,
    buildAgentLeonidSharedResourceLimitTypesPath(),
    { method: HttpMethod.GET },
    token,
    signal
  );
}

export function listLeonidSharedResourceLimits(
  port: number,
  token: string,
  signal?: AbortSignal
): Promise<LeonidSharedResourceLimit[]> {
  return readAgentJson<LeonidSharedResourceLimit[]>(
    port,
    buildAgentLeonidSharedResourceLimitsPath(),
    { method: HttpMethod.GET },
    token,
    signal
  );
}

export function createLeonidSharedResourceLimit(
  port: number,
  token: string,
  payload: LeonidSharedResourceLimitInput,
  signal?: AbortSignal
): Promise<LeonidSharedResourceLimit> {
  return writeAgentJson<LeonidSharedResourceLimit>(
    port,
    buildAgentLeonidSharedResourceLimitsPath(),
    HttpMethod.POST,
    token,
    payload,
    signal
  );
}

export function updateLeonidSharedResourceLimit(
  port: number,
  token: string,
  limitId: number,
  payload: LeonidSharedResourceLimitInput,
  signal?: AbortSignal
): Promise<LeonidSharedResourceLimit> {
  return writeAgentJson<LeonidSharedResourceLimit>(
    port,
    buildAgentLeonidSharedResourceLimitsPath(limitId),
    HttpMethod.PUT,
    token,
    payload,
    signal
  );
}

export function deleteLeonidSharedResourceLimit(
  port: number,
  token: string,
  limitId: number,
  signal?: AbortSignal
): Promise<void> {
  return writeAgentJson<void>(
    port,
    buildAgentLeonidSharedResourceLimitsPath(limitId),
    HttpMethod.DELETE,
    token,
    undefined,
    signal
  );
}

export function listLeonidSharedResources(
  port: number,
  token: string,
  signal?: AbortSignal
): Promise<LeonidSharedResource[]> {
  return readAgentJson<LeonidSharedResource[]>(
    port,
    buildAgentLeonidSharedResourcesPath(),
    { method: HttpMethod.GET },
    token,
    signal
  );
}

export function createLeonidSharedResource(
  port: number,
  token: string,
  payload: LeonidSharedResourceInput,
  signal?: AbortSignal
): Promise<LeonidSharedResource> {
  return writeAgentJson<LeonidSharedResource>(
    port,
    buildAgentLeonidSharedResourcesPath(),
    HttpMethod.POST,
    token,
    payload,
    signal
  );
}

export function updateLeonidSharedResource(
  port: number,
  token: string,
  resourceId: number,
  payload: LeonidSharedResourceInput,
  signal?: AbortSignal
): Promise<LeonidSharedResource> {
  return writeAgentJson<LeonidSharedResource>(
    port,
    buildAgentLeonidSharedResourcesPath(resourceId),
    HttpMethod.PUT,
    token,
    payload,
    signal
  );
}

export function deleteLeonidSharedResource(
  port: number,
  token: string,
  resourceId: number,
  signal?: AbortSignal
): Promise<void> {
  return writeAgentJson<void>(
    port,
    buildAgentLeonidSharedResourcesPath(resourceId),
    HttpMethod.DELETE,
    token,
    undefined,
    signal
  );
}

export function toggleLeonidSharedResource(
  port: number,
  token: string,
  resourceId: number,
  signal?: AbortSignal
): Promise<LeonidSharedResource> {
  return writeAgentJson<LeonidSharedResource>(
    port,
    buildAgentLeonidSharedResourceTogglePath(resourceId),
    HttpMethod.POST,
    token,
    undefined,
    signal
  );
}

export function listLeonidObjectDefinitions(
  port: number,
  token: string,
  signal?: AbortSignal
): Promise<LeonidObjectDefinition[]> {
  return readAgentJson<LeonidObjectDefinition[]>(
    port,
    buildAgentLeonidObjectDefinitionsPath(),
    { method: HttpMethod.GET },
    token,
    signal
  );
}

export function createLeonidObjectDefinition(
  port: number,
  token: string,
  payload: LeonidObjectDefinitionInput,
  signal?: AbortSignal
): Promise<LeonidObjectDefinition> {
  return writeAgentJson<LeonidObjectDefinition>(
    port,
    buildAgentLeonidObjectDefinitionsPath(),
    HttpMethod.POST,
    token,
    payload,
    signal
  );
}

export function updateLeonidObjectDefinition(
  port: number,
  token: string,
  definitionId: number,
  payload: LeonidObjectDefinitionInput,
  signal?: AbortSignal
): Promise<LeonidObjectDefinition> {
  return writeAgentJson<LeonidObjectDefinition>(
    port,
    buildAgentLeonidObjectDefinitionsPath(definitionId),
    HttpMethod.PUT,
    token,
    payload,
    signal
  );
}

export function deleteLeonidObjectDefinition(
  port: number,
  token: string,
  definitionId: number,
  signal?: AbortSignal
): Promise<void> {
  return writeAgentJson<void>(
    port,
    buildAgentLeonidObjectDefinitionsPath(definitionId),
    HttpMethod.DELETE,
    token,
    undefined,
    signal
  );
}

export function toggleLeonidObjectDefinition(
  port: number,
  token: string,
  definitionId: number,
  signal?: AbortSignal
): Promise<LeonidObjectDefinition> {
  return writeAgentJson<LeonidObjectDefinition>(
    port,
    buildAgentLeonidObjectDefinitionTogglePath(definitionId),
    HttpMethod.POST,
    token,
    undefined,
    signal
  );
}

export function listLeonidObjectValues(
  port: number,
  token: string,
  signal?: AbortSignal
): Promise<LeonidObjectValue[]> {
  return readAgentJson<LeonidObjectValue[]>(
    port,
    buildAgentLeonidObjectValuesPath(),
    { method: HttpMethod.GET },
    token,
    signal
  );
}

export function createLeonidObjectValue(
  port: number,
  token: string,
  payload: LeonidObjectValueInput,
  signal?: AbortSignal
): Promise<LeonidObjectValue> {
  return writeAgentJson<LeonidObjectValue>(
    port,
    buildAgentLeonidObjectValuesPath(),
    HttpMethod.POST,
    token,
    payload,
    signal
  );
}

export function updateLeonidObjectValue(
  port: number,
  token: string,
  valueId: number,
  payload: LeonidObjectValueInput,
  signal?: AbortSignal
): Promise<LeonidObjectValue> {
  return writeAgentJson<LeonidObjectValue>(
    port,
    buildAgentLeonidObjectValuesPath(valueId),
    HttpMethod.PUT,
    token,
    payload,
    signal
  );
}

export function deleteLeonidObjectValue(
  port: number,
  token: string,
  valueId: number,
  signal?: AbortSignal
): Promise<void> {
  return writeAgentJson<void>(
    port,
    buildAgentLeonidObjectValuesPath(valueId),
    HttpMethod.DELETE,
    token,
    undefined,
    signal
  );
}

export function toggleLeonidObjectValue(
  port: number,
  token: string,
  valueId: number,
  signal?: AbortSignal
): Promise<LeonidObjectValue> {
  return writeAgentJson<LeonidObjectValue>(
    port,
    buildAgentLeonidObjectValueTogglePath(valueId),
    HttpMethod.POST,
    token,
    undefined,
    signal
  );
}

export function listLeonidPipelineParams(
  port: number,
  token: string,
  signal?: AbortSignal
): Promise<LeonidPipelineParam[]> {
  return readAgentJson<LeonidPipelineParam[]>(
    port,
    buildAgentLeonidPipelineParamsPath(),
    { method: HttpMethod.GET },
    token,
    signal
  );
}

export function createLeonidPipelineParam(
  port: number,
  token: string,
  payload: LeonidPipelineParamInput,
  signal?: AbortSignal
): Promise<LeonidPipelineParam> {
  return writeAgentJson<LeonidPipelineParam>(
    port,
    buildAgentLeonidPipelineParamsPath(),
    HttpMethod.POST,
    token,
    payload,
    signal
  );
}

export function updateLeonidPipelineParam(
  port: number,
  token: string,
  pipelineParamId: number,
  payload: LeonidPipelineParamInput,
  signal?: AbortSignal
): Promise<LeonidPipelineParam> {
  return writeAgentJson<LeonidPipelineParam>(
    port,
    buildAgentLeonidPipelineParamsPath(pipelineParamId),
    HttpMethod.PUT,
    token,
    payload,
    signal
  );
}

export function deleteLeonidPipelineParam(
  port: number,
  token: string,
  pipelineParamId: number,
  signal?: AbortSignal
): Promise<void> {
  return writeAgentJson<void>(
    port,
    buildAgentLeonidPipelineParamsPath(pipelineParamId),
    HttpMethod.DELETE,
    token,
    undefined,
    signal
  );
}

export function freezeJenkinsFolder(
  port: number,
  token: string,
  body: JenkinsFreezeRequest,
  signal?: AbortSignal
): Promise<JenkinsFreezeResponse> {
  return readAgentJson<JenkinsFreezeResponse>(
    port,
    AgentPath.JENKINS_FREEZE,
    createJsonBody(body),
    token,
    signal
  );
}

export function resumeJenkinsFolder(
  port: number,
  token: string,
  body: JenkinsResumeRequest,
  signal?: AbortSignal
): Promise<JenkinsResumeResponse> {
  return readAgentJson<JenkinsResumeResponse>(
    port,
    AgentPath.JENKINS_RESUME,
    createJsonBody(body),
    token,
    signal
  );
}

export function startJenkinsResumeRun(
  port: number,
  token: string,
  body: JenkinsResumeRunRequest,
  signal?: AbortSignal
): Promise<JenkinsResumeRunAccepted> {
  return readAgentJson<JenkinsResumeRunAccepted>(
    port,
    AgentPath.JENKINS_RESUME_RUN,
    createJsonBody(body),
    token,
    signal
  );
}

export function getKubeconfigStatus(
  port: number,
  token: string,
  signal?: AbortSignal
): Promise<KubeconfigStatus> {
  return readAgentJson<KubeconfigStatus>(
    port,
    AgentPath.KUBECONFIG_STATUS,
    { method: HttpMethod.GET },
    token,
    signal
  );
}

export function refreshKubeconfig(
  port: number,
  token: string,
  activate: boolean,
  signal?: AbortSignal
): Promise<KubeconfigStatus> {
  const payload: KubeconfigRefreshRequest = { activate };
  return readAgentJson<KubeconfigStatus>(
    port,
    AgentPath.KUBECONFIG_REFRESH,
    createJsonBody(payload),
    token,
    signal
  );
}

export function activateKubeconfig(
  port: number,
  token: string,
  signal?: AbortSignal
): Promise<KubeconfigStatus> {
  return readAgentJson<KubeconfigStatus>(
    port,
    AgentPath.KUBECONFIG_ACTIVATE,
    { method: HttpMethod.POST },
    token,
    signal
  );
}

function parseJobStreamMessage(event: string, data: string): JobStreamMessage | null {
  if (event === JobStreamEvent.LOG) {
    return {
      data: JSON.parse(data) as JobLogEvent,
      event: JobStreamEvent.LOG,
    };
  }

  if (event === JobStreamEvent.TERMINAL) {
    return {
      data: JSON.parse(data) as JobTerminalEvent,
      event: JobStreamEvent.TERMINAL,
    };
  }

  return null;
}

async function streamAgentCommand(
  port: number,
  token: string,
  path: string,
  onMessage: (message: JobStreamMessage) => void,
  signal?: AbortSignal
): Promise<void> {
  const response = await fetch(buildAgentUrl(port, path), {
    headers: createAgentHeaders(token),
    method: HttpMethod.GET,
    signal,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(payload?.detail ?? "Agent request failed.");
  }

  if (!response.body) {
    throw new Error("Agent stream is unavailable.");
  }

  for await (const frame of parseSseStream(response.body, signal)) {
    const message = parseJobStreamMessage(frame.event, frame.data);
    if (message) {
      onMessage(message);
    }
  }
}

export const agentClient = {
  activateKubeconfig,
  adopt(
    port: number,
    token: string,
    payload: AdoptRequest,
    signal?: AbortSignal
  ): Promise<JobCreateResponse> {
    return readAgentJson<JobCreateResponse>(port, AgentPath.ADOPT, createJsonBody(payload), token, signal);
  },

  cancelJob(port: number, token: string, jobId: string, signal?: AbortSignal): Promise<JobRead> {
    return readAgentJson<JobRead>(
      port,
      buildAgentJobCancelPath(jobId),
      { method: HttpMethod.POST },
      token,
      signal
    );
  },

  deploy(
    port: number,
    token: string,
    payload: DeployRequest,
    signal?: AbortSignal
  ): Promise<JobCreateResponse> {
    return readAgentJson<JobCreateResponse>(port, AgentPath.DEPLOY, createJsonBody(payload), token, signal);
  },

  destroy(
    port: number,
    token: string,
    payload: DestroyRequest,
    signal?: AbortSignal
  ): Promise<JobCreateResponse> {
    return readAgentJson<JobCreateResponse>(port, AgentPath.DESTROY, createJsonBody(payload), token, signal);
  },

  e2eRun(
    port: number,
    token: string,
    payload: E2eRunRequest,
    signal?: AbortSignal
  ): Promise<JobCreateResponse> {
    return readAgentJson<JobCreateResponse>(port, AgentPath.E2E_RUN, createJsonBody(payload), token, signal);
  },

  getE2eSuites(
    port: number,
    token: string,
    product: Product,
    signal?: AbortSignal
  ): Promise<E2eSuitesResponse> {
    return readAgentJson<E2eSuitesResponse>(
      port,
      buildAgentE2eSuitesPath(product),
      { method: HttpMethod.GET },
      token,
      signal
    );
  },

  getJob(port: number, token: string, jobId: string, signal?: AbortSignal): Promise<JobRead> {
    return readAgentJson<JobRead>(
      port,
      buildAgentJobPath(jobId),
      { method: HttpMethod.GET },
      token,
      signal
    );
  },

  freezeJenkinsFolder,
  getJenkinsBuilds,
  getJenkinsFolder,
  getJenkinsScope,
  getJenkinsTree,
  getNotificatorChoices,
  listNotificatorNotificationConfigs,
  createNotificatorNotificationConfig,
  updateNotificatorNotificationConfig,
  deleteNotificatorNotificationConfig,
  listNotificatorTeams,
  listNotificatorProducts,
  createNotificatorProduct,
  updateNotificatorProduct,
  deleteNotificatorProduct,
  listNotificatorSubProducts,
  createNotificatorSubProduct,
  updateNotificatorSubProduct,
  deleteNotificatorSubProduct,
  listNotificatorSlackChannels,
  createNotificatorSlackChannel,
  updateNotificatorSlackChannel,
  deleteNotificatorSlackChannel,
  listNotificatorUsers,
  listNotificatorQaaMembers,
  listNotificatorFailureMentionRules,
  listNotificatorEvents,
  listNotificatorRecurrentFails,
  listNotificatorFailReasons,
  listNotificatorMuteStatuses,
  listNotificatorHistory,
  listLeonidSharedResourceLimitTypes,
  listLeonidSharedResourceLimits,
  createLeonidSharedResourceLimit,
  updateLeonidSharedResourceLimit,
  deleteLeonidSharedResourceLimit,
  listLeonidSharedResources,
  createLeonidSharedResource,
  updateLeonidSharedResource,
  deleteLeonidSharedResource,
  toggleLeonidSharedResource,
  listLeonidObjectDefinitions,
  createLeonidObjectDefinition,
  updateLeonidObjectDefinition,
  deleteLeonidObjectDefinition,
  toggleLeonidObjectDefinition,
  listLeonidObjectValues,
  createLeonidObjectValue,
  updateLeonidObjectValue,
  deleteLeonidObjectValue,
  toggleLeonidObjectValue,
  listLeonidPipelineParams,
  createLeonidPipelineParam,
  updateLeonidPipelineParam,
  deleteLeonidPipelineParam,

  getSettings(port: number, token: string, signal?: AbortSignal): Promise<AgentSettings> {
    return readAgentJson<AgentSettings>(
      port,
      AgentPath.SETTINGS,
      { method: HttpMethod.GET },
      token,
      signal
    );
  },

  getKubeContexts(
    port: number,
    token: string,
    signal?: AbortSignal
  ): Promise<KubeContextsResponse> {
    return readAgentJson<KubeContextsResponse>(
      port,
      AgentPath.KUBE_CONTEXTS,
      { method: HttpMethod.GET },
      token,
      signal
    );
  },

  getKubeTop(
    port: number,
    token: string,
    context: string | null | undefined,
    namespace: string,
    signal?: AbortSignal
  ): Promise<KubeTopResponse> {
    return readAgentJson<KubeTopResponse>(
      port,
      buildAgentKubeTopPath(context, namespace),
      { method: HttpMethod.GET },
      token,
      signal
    );
  },

  getNamespaceCreds(
    port: number,
    token: string,
    namespace: string,
    signal?: AbortSignal
  ): Promise<NamespaceCreds> {
    return readAgentJson<NamespaceCreds>(
      port,
      buildAgentNamespaceCredsPath(namespace),
      { method: HttpMethod.GET },
      token,
      signal
    );
  },

  getNamespaceStatus(
    port: number,
    token: string,
    namespace: string,
    signal?: AbortSignal
  ): Promise<NamespaceStatus> {
    return readAgentJson<NamespaceStatus>(
      port,
      buildAgentNamespaceStatusPath(namespace),
      { method: HttpMethod.GET },
      token,
      signal
    );
  },

  getNamespaceDeployRecipe(
    port: number,
    token: string,
    namespace: string,
    signal?: AbortSignal
  ): Promise<NamespaceDeployRecipe> {
    return readAgentJson<NamespaceDeployRecipe>(
      port,
      buildAgentNamespaceDeployRecipePath(namespace),
      { method: HttpMethod.GET },
      token,
      signal
    );
  },

  listKubeNamespaces(
    port: number,
    token: string,
    context?: string | null,
    signal?: AbortSignal
  ): Promise<KubeNamespacesResponse> {
    return readAgentJson<KubeNamespacesResponse>(
      port,
      buildAgentKubeNamespacesPath(context),
      { method: HttpMethod.GET },
      token,
      signal
    );
  },

  listKubePods(
    port: number,
    token: string,
    context: string | null | undefined,
    namespace: string,
    signal?: AbortSignal
  ): Promise<KubePodsResponse> {
    return readAgentJson<KubePodsResponse>(
      port,
      buildAgentKubePodsPath(context, namespace),
      { method: HttpMethod.GET },
      token,
      signal
    );
  },

  listNamespaces(port: number, token: string, signal?: AbortSignal): Promise<NamespaceList> {
    return readAgentJson<NamespaceList>(
      port,
      AgentPath.NAMESPACES,
      { method: HttpMethod.GET },
      token,
      signal
    );
  },

  updateSettings(
    port: number,
    token: string,
    payload: AgentSettingsUpdate,
    signal?: AbortSignal
  ): Promise<AgentSettings> {
    return readAgentJson<AgentSettings>(
      port,
      AgentPath.SETTINGS,
      createJsonBody(payload, HttpMethod.PUT),
      token,
      signal
    );
  },

  describeKubePod(
    port: number,
    token: string,
    pod: string,
    context: string | null | undefined,
    namespace: string,
    signal?: AbortSignal
  ): Promise<KubePodDescribe> {
    return readAgentJson<KubePodDescribe>(
      port,
      buildAgentKubePodDescribePath(pod, context, namespace),
      { method: HttpMethod.GET },
      token,
      signal
    );
  },

  deleteKubePod(
    port: number,
    token: string,
    pod: string,
    payload: KubeDeletePodRequest,
    signal?: AbortSignal
  ): Promise<KubeCommandResult> {
    return readAgentJson<KubeCommandResult>(
      port,
      buildAgentKubePodDeletePath(pod),
      createJsonBody(payload),
      token,
      signal
    );
  },

  async streamJob(
    port: number,
    token: string,
    jobId: string,
    onMessage: (message: JobStreamMessage) => void,
    signal?: AbortSignal
  ): Promise<void> {
    return streamAgentCommand(port, token, buildAgentJobStreamPath(jobId), onMessage, signal);
  },

  async streamKubePodLogs(
    port: number,
    token: string,
    pod: string,
    params: {
      context?: string | null;
      namespace: string;
      container?: string | null;
      follow: boolean;
      tail: number;
      previous: boolean;
    },
    onMessage: (message: JobStreamMessage) => void,
    signal?: AbortSignal
  ): Promise<void> {
    return streamAgentCommand(
      port,
      token,
      buildAgentKubePodLogsPath(pod, params),
      onMessage,
      signal
    );
  },

  async streamNamespaceLogs(
    port: number,
    token: string,
    namespace: string,
    deploy: string,
    onMessage: (message: JobStreamMessage) => void,
    signal?: AbortSignal
  ): Promise<void> {
    return streamAgentCommand(
      port,
      token,
      buildAgentNamespaceLogsPath(namespace, deploy),
      onMessage,
      signal
    );
  },

  sync(
    port: number,
    token: string,
    payload: SyncRequest,
    signal?: AbortSignal
  ): Promise<JobCreateResponse> {
    return readAgentJson<JobCreateResponse>(port, AgentPath.SYNC, createJsonBody(payload), token, signal);
  },

  useKubeContext(
    port: number,
    token: string,
    context: string,
    signal?: AbortSignal
  ): Promise<KubeCommandResult> {
    const payload: KubeUseContextRequest = { context };
    return readAgentJson<KubeCommandResult>(
      port,
      AgentPath.KUBE_USE_CONTEXT,
      createJsonBody(payload),
      token,
      signal
    );
  },
  getKubeconfigStatus,
  getPing,
  getPreflightItems,
  refreshKubeconfig,
  requestUpdate: requestAgentUpdate,
  resumeJenkinsFolder,
  startJenkinsResumeRun,
};
