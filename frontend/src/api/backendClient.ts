import {
  AUTH_SCHEME_BEARER,
  BackendPath,
  buildBackendJenkinsFreezePath,
  buildBackendJenkinsFreezeResolvePath,
  buildBackendJenkinsFreezesPath,
  buildBackendJenkinsScopePath,
  buildBackendJenkinsResumeRunCancelPath,
  buildBackendJenkinsResumeRunPath,
  buildBackendJenkinsResumeRunsPath,
  buildBackendJenkinsFreezeSnapshotPath,
  buildBackendJenkinsBuildsPath,
  buildBackendJenkinsFolderPath,
  buildBackendJenkinsTreePath,
  buildBackendQaaServiceTokenRegeneratePath,
  buildBackendQaaServiceTokenRevokePath,
  buildBackendQaaUserPath,
  buildBackendQaaUserRegeneratePath,
  buildBackendQaaRunArtifactsPath,
  buildBackendQaaRunPath,
  buildBackendQaaRunPausePath,
  buildBackendQaaRunResumePath,
  buildBackendQaaRunStopPath,
  buildBackendQaaRunStreamPath,
  HttpHeader,
  HttpMethod,
  HttpStatus,
  MediaType,
  QaaSubjectKind,
  buildBackendOperationPath,
  buildBackendOperationReplayPath,
  type PluginId,
  buildBackendUserPath,
} from "@/constants";
import type {
  AgentManifest,
  JenkinsBuildsCachePut,
  JenkinsBuildsCacheRead,
  JenkinsFolderCachePut,
  JenkinsFolderCacheRead,
  JenkinsFreezeCreateRequest,
  JenkinsFreezeRead,
  JenkinsResumeRunCreateRequest,
  JenkinsResumeRunRead,
  JenkinsFreezeSnapshotPutRequest,
  JenkinsTreeCachePut,
  JenkinsTreeCacheRead,
  JenkinsScopeResponse,
  LoginRequest,
  LoginResponse,
  MeUpdateRequest,
  MePluginsResponse,
  OperationListResponse,
  OperationRead,
  OperationReplay,
  ServerSettingsRead,
  ServerSettingsUpdateRequest,
  QaaRunArtifacts,
  QaaRunControlResponse,
  QaaRunCreateRequest,
  QaaRunEvent,
  QaaRunListResponse,
  QaaRunRead,
  QaaServiceTokenCreateRequest,
  QaaServiceTokenRevokeResponse,
  QaaUser,
  QaaUserCreateRequest,
  QaaUserListResponse,
  QaaUserTokenCreateResponse,
  QaaUserTokenRegenerateResponse,
  QaaUserUpdateRequest,
  User,
  UserCreateRequest,
  UserListResponse,
  UserUpdateRequest,
  SecurityRole,
  SecurityRoleListResponse,
  SecurityGroup,
  SecurityGroupListResponse,
  SecurityPermissionListResponse,
  UserPermissionsResponse,
  SecurityAuditListResponse,
  AuthzCheckResponse,
} from "@/api/types";
import { resolveApiBaseUrl } from "@/core/runtimeConfig";
import { parseSseStream } from "@/api/sse";

const QAA_LIST_QUERY_PARAM = {
  CREATED_FROM: "created_from",
  CREATED_TO: "created_to",
  CURSOR: "cursor",
  EFFECTIVE_ACTOR: "effective_actor",
  JIRA_KEY: "jira_key",
  LIMIT: "limit",
  STATUS: "status",
} as const;

const QAA_USERS_QUERY_PARAM = {
  EMAIL: "email",
  KIND: "kind",
  LIMIT: "limit",
  OFFSET: "offset",
  SLACK_USER_ID: "slack_user_id",
} as const;

interface QaaRunsListParams {
  jiraKey?: string;
  status?: string[];
  effectiveActor?: string;
  createdFrom?: string;
  createdTo?: string;
  limit?: number;
  cursor?: string | null;
}

interface QaaUsersListParams {
  email?: string;
  kind?: (typeof QaaSubjectKind)[keyof typeof QaaSubjectKind];
  slackUserId?: string;
  limit?: number;
  offset?: number;
}

export class BackendHttpError extends Error {
  payload: unknown;
  status: number;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = "BackendHttpError";
    this.payload = payload;
    this.status = status;
  }
}

const apiBaseUrl = resolveApiBaseUrl().trim();

function buildBackendUrl(path: string): string {
  if (apiBaseUrl) {
    return new URL(path, apiBaseUrl).toString();
  }

  return new URL(path, getBrowserOrigin() ?? apiBaseUrl).toString();
}

function getBrowserOrigin(): string | null {
  if (typeof window === "undefined" || typeof window.location?.origin !== "string") {
    return null;
  }

  return window.location.origin;
}

function toNetworkError(url: string, error: unknown): Error {
  if (error instanceof DOMException && error.name === "AbortError") {
    return new Error(`Request to ${url} was aborted.`);
  }

  const origin = getBrowserOrigin();
  const corsHint = origin ? ` If the backend is up, verify CORS_ORIGINS includes ${origin}.` : "";

  return new Error(
    `Cannot reach backend at ${url}. Check that the backend is running and VITE_API_BASE_URL is correct.${corsHint}`
  );
}

function extractBackendErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  if ("detail" in payload && typeof payload.detail === "string") {
    return payload.detail;
  }
  if ("error" in payload && typeof payload.error === "string") {
    return payload.error;
  }
  if (
    "error" in payload &&
    payload.error &&
    typeof payload.error === "object" &&
    "message" in payload.error &&
    typeof payload.error.message === "string"
  ) {
    return payload.error.message;
  }
  return null;
}

function toHttpError(response: Response, payload: unknown): Error {
  const detail = extractBackendErrorMessage(payload);
  if (detail) {
    return new BackendHttpError(detail, response.status, payload);
  }

  const statusText = response.statusText || "Unknown error";
  return new BackendHttpError(
    `Backend request failed with ${response.status} ${statusText}.`,
    response.status,
    payload
  );
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  token?: string,
  signal?: AbortSignal
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set(HttpHeader.ACCEPT, MediaType.JSON);

  if (init.body !== undefined && !headers.has(HttpHeader.CONTENT_TYPE)) {
    headers.set(HttpHeader.CONTENT_TYPE, MediaType.JSON);
  }

  if (token) {
    headers.set(HttpHeader.AUTHORIZATION, `${AUTH_SCHEME_BEARER} ${token}`);
  }

  const url = buildBackendUrl(path);
  let response: Response;

  try {
    response = await fetch(url, {
      ...init,
      headers,
      signal,
    });
  } catch (error) {
    throw toNetworkError(url, error);
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as unknown;
    throw toHttpError(response, payload);
  }

  if (response.status === HttpStatus.NO_CONTENT) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

interface ListOperationsParams {
  limit: number;
  offset: number;
  ns?: string;
  status?: string;
  type?: string;
  userId?: number;
}

function buildOperationsListPath(params: ListOperationsParams): string {
  const searchParams = new URLSearchParams();
  searchParams.set("limit", String(params.limit));
  searchParams.set("offset", String(params.offset));

  if (params.status) {
    searchParams.set("status", params.status);
  }
  if (params.type) {
    searchParams.set("type", params.type);
  }
  if (params.ns) {
    searchParams.set("ns", params.ns);
  }
  if (params.userId !== undefined) {
    searchParams.set("user_id", String(params.userId));
  }

  return `${BackendPath.OPERATIONS}?${searchParams.toString()}`;
}

function buildQaaRunsListPath(params: QaaRunsListParams): string {
  const searchParams = new URLSearchParams();

  if (params.jiraKey) {
    searchParams.set(QAA_LIST_QUERY_PARAM.JIRA_KEY, params.jiraKey);
  }
  if (params.effectiveActor) {
    searchParams.set(QAA_LIST_QUERY_PARAM.EFFECTIVE_ACTOR, params.effectiveActor);
  }
  if (params.createdFrom) {
    searchParams.set(QAA_LIST_QUERY_PARAM.CREATED_FROM, params.createdFrom);
  }
  if (params.createdTo) {
    searchParams.set(QAA_LIST_QUERY_PARAM.CREATED_TO, params.createdTo);
  }
  if (params.limit !== undefined) {
    searchParams.set(QAA_LIST_QUERY_PARAM.LIMIT, String(params.limit));
  }
  if (params.cursor) {
    searchParams.set(QAA_LIST_QUERY_PARAM.CURSOR, params.cursor);
  }
  for (const statusValue of params.status ?? []) {
    searchParams.append(QAA_LIST_QUERY_PARAM.STATUS, statusValue);
  }

  const serialized = searchParams.toString();
  return serialized ? `${BackendPath.QAA_RUNS}?${serialized}` : BackendPath.QAA_RUNS;
}

function buildQaaUsersListPath(params: QaaUsersListParams): string {
  const searchParams = new URLSearchParams();

  if (params.email) {
    searchParams.set(QAA_USERS_QUERY_PARAM.EMAIL, params.email);
  }
  if (params.kind) {
    searchParams.set(QAA_USERS_QUERY_PARAM.KIND, params.kind);
  }
  if (params.slackUserId) {
    searchParams.set(QAA_USERS_QUERY_PARAM.SLACK_USER_ID, params.slackUserId);
  }
  if (params.limit !== undefined) {
    searchParams.set(QAA_USERS_QUERY_PARAM.LIMIT, String(params.limit));
  }
  if (params.offset !== undefined) {
    searchParams.set(QAA_USERS_QUERY_PARAM.OFFSET, String(params.offset));
  }

  const serialized = searchParams.toString();
  return serialized
    ? `${BackendPath.QAA_ADMIN_USERS}?${serialized}`
    : BackendPath.QAA_ADMIN_USERS;
}

export const backendClient = {
  getAgentManifest(signal?: AbortSignal): Promise<AgentManifest> {
    return request<AgentManifest>(BackendPath.AGENT_MANIFEST, { method: HttpMethod.GET }, undefined, signal);
  },

  getJenkinsScope(token: string, signal?: AbortSignal): Promise<JenkinsScopeResponse> {
    return request<JenkinsScopeResponse>(
      buildBackendJenkinsScopePath(),
      { method: HttpMethod.GET },
      token,
      signal
    );
  },

  getJenkinsTreeCache(
    token: string,
    signature: string,
    signal?: AbortSignal
  ): Promise<JenkinsTreeCacheRead> {
    return request<JenkinsTreeCacheRead>(
      buildBackendJenkinsTreePath(signature),
      { method: HttpMethod.GET },
      token,
      signal
    );
  },

  putJenkinsTreeCache(
    token: string,
    payload: JenkinsTreeCachePut,
    signal?: AbortSignal
  ): Promise<JenkinsTreeCacheRead> {
    return request<JenkinsTreeCacheRead>(
      BackendPath.JENKINS_TREE,
      {
        body: JSON.stringify(payload),
        method: HttpMethod.PUT,
      },
      token,
      signal
    );
  },

  getJenkinsBuildsCache(
    token: string,
    signature: string,
    path: string,
    signal?: AbortSignal
  ): Promise<JenkinsBuildsCacheRead> {
    return request<JenkinsBuildsCacheRead>(
      buildBackendJenkinsBuildsPath(signature, path),
      { method: HttpMethod.GET },
      token,
      signal
    );
  },

  putJenkinsBuildsCache(
    token: string,
    payload: JenkinsBuildsCachePut,
    signal?: AbortSignal
  ): Promise<JenkinsBuildsCacheRead> {
    return request<JenkinsBuildsCacheRead>(
      BackendPath.JENKINS_BUILDS,
      {
        body: JSON.stringify(payload),
        method: HttpMethod.PUT,
      },
      token,
      signal
    );
  },

  getJenkinsFolderCache(
    token: string,
    signature: string,
    path: string,
    ttlSeconds: number,
    signal?: AbortSignal
  ): Promise<JenkinsFolderCacheRead> {
    return request<JenkinsFolderCacheRead>(
      buildBackendJenkinsFolderPath(signature, path, ttlSeconds),
      { method: HttpMethod.GET },
      token,
      signal
    );
  },

  putJenkinsFolderCache(
    token: string,
    payload: JenkinsFolderCachePut,
    signal?: AbortSignal
  ): Promise<JenkinsFolderCacheRead> {
    return request<JenkinsFolderCacheRead>(
      BackendPath.JENKINS_FOLDER,
      {
        body: JSON.stringify(payload),
        method: HttpMethod.PUT,
      },
      token,
      signal
    );
  },

  getJenkinsFreezes(
    token: string,
    signature: string,
    status?: JenkinsFreezeRead["status"],
    signal?: AbortSignal
  ): Promise<JenkinsFreezeRead[]> {
    return request<JenkinsFreezeRead[]>(
      buildBackendJenkinsFreezesPath(signature, status),
      { method: HttpMethod.GET },
      token,
      signal
    );
  },

  createJenkinsFreeze(
    token: string,
    payload: JenkinsFreezeCreateRequest,
    signal?: AbortSignal
  ): Promise<JenkinsFreezeRead> {
    return request<JenkinsFreezeRead>(
      BackendPath.JENKINS_FREEZES,
      {
        body: JSON.stringify(payload),
        method: HttpMethod.POST,
      },
      token,
      signal
    );
  },

  putJenkinsFreezeSnapshot(
    token: string,
    freezeId: string,
    payload: JenkinsFreezeSnapshotPutRequest,
    signal?: AbortSignal
  ): Promise<JenkinsFreezeRead> {
    return request<JenkinsFreezeRead>(
      buildBackendJenkinsFreezeSnapshotPath(freezeId),
      {
        body: JSON.stringify(payload),
        method: HttpMethod.PUT,
      },
      token,
      signal
    );
  },

  deleteJenkinsFreeze(token: string, freezeId: string, signal?: AbortSignal): Promise<void> {
    return request<void>(buildBackendJenkinsFreezePath(freezeId), { method: HttpMethod.DELETE }, token, signal);
  },

  resolveJenkinsFreeze(token: string, freezeId: string, signal?: AbortSignal): Promise<JenkinsFreezeRead> {
    return request<JenkinsFreezeRead>(
      buildBackendJenkinsFreezeResolvePath(freezeId),
      { method: HttpMethod.POST },
      token,
      signal
    );
  },

  createJenkinsResumeRun(
    token: string,
    payload: JenkinsResumeRunCreateRequest,
    signal?: AbortSignal
  ): Promise<JenkinsResumeRunRead> {
    return request<JenkinsResumeRunRead>(
      BackendPath.JENKINS_RESUME_RUNS,
      {
        body: JSON.stringify(payload),
        method: HttpMethod.POST,
      },
      token,
      signal
    );
  },

  getJenkinsResumeRuns(
    token: string,
    signature: string,
    status?: JenkinsResumeRunRead["status"],
    signal?: AbortSignal
  ): Promise<JenkinsResumeRunRead[]> {
    return request<JenkinsResumeRunRead[]>(
      buildBackendJenkinsResumeRunsPath(signature, status),
      { method: HttpMethod.GET },
      token,
      signal
    );
  },

  getJenkinsResumeRun(
    token: string,
    runId: string,
    signal?: AbortSignal
  ): Promise<JenkinsResumeRunRead> {
    return request<JenkinsResumeRunRead>(
      buildBackendJenkinsResumeRunPath(runId),
      { method: HttpMethod.GET },
      token,
      signal
    );
  },

  cancelJenkinsResumeRun(
    token: string,
    runId: string,
    signal?: AbortSignal
  ): Promise<JenkinsResumeRunRead> {
    return request<JenkinsResumeRunRead>(
      buildBackendJenkinsResumeRunCancelPath(runId),
      { method: HttpMethod.POST },
      token,
      signal
    );
  },

  createQaaRun(
    token: string,
    payload: QaaRunCreateRequest,
    signal?: AbortSignal
  ): Promise<QaaRunRead> {
    return request<QaaRunRead>(
      BackendPath.QAA_RUNS,
      {
        body: JSON.stringify(payload),
        method: HttpMethod.POST,
      },
      token,
      signal
    );
  },

  getQaaRun(token: string, runId: string, signal?: AbortSignal): Promise<QaaRunRead> {
    return request<QaaRunRead>(buildBackendQaaRunPath(runId), { method: HttpMethod.GET }, token, signal);
  },

  getQaaRunArtifacts(token: string, runId: string, signal?: AbortSignal): Promise<QaaRunArtifacts> {
    return request<QaaRunArtifacts>(
      buildBackendQaaRunArtifactsPath(runId),
      { method: HttpMethod.GET },
      token,
      signal
    );
  },

  getCurrentUser(token: string, signal?: AbortSignal): Promise<User> {
    return request<User>(BackendPath.ME, { method: HttpMethod.GET }, token, signal);
  },

  updateMe(token: string, payload: MeUpdateRequest, signal?: AbortSignal): Promise<User> {
    return request<User>(
      BackendPath.ME,
      {
        body: JSON.stringify(payload),
        method: HttpMethod.PATCH,
      },
      token,
      signal
    );
  },

  getMyPlugins(token: string, signal?: AbortSignal): Promise<MePluginsResponse> {
    return request<MePluginsResponse>(BackendPath.ME_PLUGINS, { method: HttpMethod.GET }, token, signal);
  },

  getServerSettings(token: string, signal?: AbortSignal): Promise<ServerSettingsRead> {
    return request<ServerSettingsRead>(BackendPath.SETTINGS, { method: HttpMethod.GET }, token, signal);
  },

  updateServerSettings(
    token: string,
    payload: ServerSettingsUpdateRequest,
    signal?: AbortSignal
  ): Promise<ServerSettingsRead> {
    return request<ServerSettingsRead>(
      BackendPath.SETTINGS,
      {
        body: JSON.stringify(payload),
        method: HttpMethod.PUT,
      },
      token,
      signal
    );
  },

  updateMyPlugins(
    token: string,
    enabledPluginIds: PluginId[],
    signal?: AbortSignal
  ): Promise<MePluginsResponse> {
    return request<MePluginsResponse>(
      BackendPath.ME_PLUGINS,
      {
        body: JSON.stringify({ enabled_plugins: enabledPluginIds }),
        method: HttpMethod.PUT,
      },
      token,
      signal
    );
  },

  listUsers(token: string, signal?: AbortSignal): Promise<UserListResponse> {
    return request<UserListResponse>(BackendPath.USERS, { method: HttpMethod.GET }, token, signal);
  },

  createUser(token: string, payload: UserCreateRequest, signal?: AbortSignal): Promise<User> {
    return request<User>(
      BackendPath.USERS,
      {
        body: JSON.stringify(payload),
        method: HttpMethod.POST,
      },
      token,
      signal
    );
  },

  getUser(token: string, userId: number, signal?: AbortSignal): Promise<User> {
    return request<User>(buildBackendUserPath(userId), { method: HttpMethod.GET }, token, signal);
  },

  updateUser(
    token: string,
    userId: number,
    payload: UserUpdateRequest,
    signal?: AbortSignal
  ): Promise<User> {
    return request<User>(
      buildBackendUserPath(userId),
      {
        body: JSON.stringify(payload),
        method: HttpMethod.PATCH,
      },
      token,
      signal
    );
  },

  deleteUser(token: string, userId: number, signal?: AbortSignal): Promise<void> {
    return request<void>(buildBackendUserPath(userId), { method: HttpMethod.DELETE }, token, signal);
  },

  getOperation(token: string, operationId: string, signal?: AbortSignal): Promise<OperationRead> {
    return request<OperationRead>(
      buildBackendOperationPath(operationId),
      { method: HttpMethod.GET },
      token,
      signal
    );
  },

  getOperationReplay(
    token: string,
    operationId: string,
    signal?: AbortSignal
  ): Promise<OperationReplay> {
    return request<OperationReplay>(
      buildBackendOperationReplayPath(operationId),
      { method: HttpMethod.GET },
      token,
      signal
    );
  },

  listOperations(
    token: string,
    params: ListOperationsParams,
    signal?: AbortSignal
  ): Promise<OperationListResponse> {
    return request<OperationListResponse>(
      buildOperationsListPath(params),
      { method: HttpMethod.GET },
      token,
      signal
    );
  },

  listQaaRuns(token: string, params: QaaRunsListParams, signal?: AbortSignal): Promise<QaaRunListResponse> {
    return request<QaaRunListResponse>(
      buildQaaRunsListPath(params),
      { method: HttpMethod.GET },
      token,
      signal
    );
  },

  listQaaUsers(
    token: string,
    params: QaaUsersListParams,
    signal?: AbortSignal
  ): Promise<QaaUserListResponse> {
    return request<QaaUserListResponse>(
      buildQaaUsersListPath(params),
      { method: HttpMethod.GET },
      token,
      signal
    );
  },

  createQaaUser(
    token: string,
    payload: QaaUserCreateRequest,
    signal?: AbortSignal
  ): Promise<QaaUserTokenCreateResponse> {
    return request<QaaUserTokenCreateResponse>(
      BackendPath.QAA_ADMIN_USERS,
      {
        body: JSON.stringify(payload),
        method: HttpMethod.POST,
      },
      token,
      signal
    );
  },

  getQaaUser(token: string, userId: string, signal?: AbortSignal): Promise<QaaUser> {
    return request<QaaUser>(buildBackendQaaUserPath(userId), { method: HttpMethod.GET }, token, signal);
  },

  updateQaaUser(
    token: string,
    userId: string,
    payload: QaaUserUpdateRequest,
    signal?: AbortSignal
  ): Promise<QaaUser> {
    return request<QaaUser>(
      buildBackendQaaUserPath(userId),
      {
        body: JSON.stringify(payload),
        method: HttpMethod.PATCH,
      },
      token,
      signal
    );
  },

  deleteQaaUser(token: string, userId: string, signal?: AbortSignal): Promise<void> {
    return request<void>(buildBackendQaaUserPath(userId), { method: HttpMethod.DELETE }, token, signal);
  },

  regenerateQaaUserToken(
    token: string,
    userId: string,
    signal?: AbortSignal
  ): Promise<QaaUserTokenRegenerateResponse> {
    return request<QaaUserTokenRegenerateResponse>(
      buildBackendQaaUserRegeneratePath(userId),
      { method: HttpMethod.POST },
      token,
      signal
    );
  },

  createQaaServiceToken(
    token: string,
    payload: QaaServiceTokenCreateRequest,
    signal?: AbortSignal
  ): Promise<QaaUserTokenCreateResponse> {
    return request<QaaUserTokenCreateResponse>(
      BackendPath.QAA_ADMIN_SERVICE_TOKENS,
      {
        body: JSON.stringify(payload),
        method: HttpMethod.POST,
      },
      token,
      signal
    );
  },

  revokeQaaServiceToken(
    token: string,
    tokenId: string,
    signal?: AbortSignal
  ): Promise<QaaServiceTokenRevokeResponse> {
    return request<QaaServiceTokenRevokeResponse>(
      buildBackendQaaServiceTokenRevokePath(tokenId),
      { method: HttpMethod.POST },
      token,
      signal
    );
  },

  regenerateQaaServiceToken(
    token: string,
    tokenId: string,
    signal?: AbortSignal
  ): Promise<QaaUserTokenRegenerateResponse> {
    return request<QaaUserTokenRegenerateResponse>(
      buildBackendQaaServiceTokenRegeneratePath(tokenId),
      { method: HttpMethod.POST },
      token,
      signal
    );
  },

  pauseQaaRun(token: string, runId: string, signal?: AbortSignal): Promise<QaaRunControlResponse> {
    return request<QaaRunControlResponse>(
      buildBackendQaaRunPausePath(runId),
      { method: HttpMethod.POST },
      token,
      signal
    );
  },

  resumeQaaRun(token: string, runId: string, signal?: AbortSignal): Promise<QaaRunControlResponse> {
    return request<QaaRunControlResponse>(
      buildBackendQaaRunResumePath(runId),
      { method: HttpMethod.POST },
      token,
      signal
    );
  },

  stopQaaRun(token: string, runId: string, signal?: AbortSignal): Promise<QaaRunControlResponse> {
    return request<QaaRunControlResponse>(
      buildBackendQaaRunStopPath(runId),
      { method: HttpMethod.POST },
      token,
      signal
    );
  },

  async streamQaaRun(
    token: string,
    runId: string,
    onMessage: (message: QaaRunEvent) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const response = await fetch(buildBackendUrl(buildBackendQaaRunStreamPath(runId)), {
      headers: {
        [HttpHeader.ACCEPT]: MediaType.TEXT_EVENT_STREAM,
        [HttpHeader.AUTHORIZATION]: `${AUTH_SCHEME_BEARER} ${token}`,
      },
      method: HttpMethod.GET,
      signal,
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as unknown;
      throw toHttpError(response, payload);
    }

    if (!response.body) {
      throw new Error("SSE response did not include a readable body.");
    }

    for await (const frame of parseSseStream(response.body, signal)) {
      if (frame.event !== "message") {
        continue;
      }
      onMessage(JSON.parse(frame.data) as QaaRunEvent);
    }
  },

  login(payload: LoginRequest, signal?: AbortSignal): Promise<LoginResponse> {
    return request<LoginResponse>(
      BackendPath.AUTH_LOGIN,
      {
        body: JSON.stringify(payload),
        method: HttpMethod.POST,
      },
      undefined,
      signal
    );
  },

  listSecurityPermissions(token: string, signal?: AbortSignal): Promise<SecurityPermissionListResponse> {
    return request<SecurityPermissionListResponse>(BackendPath.SECURITY_PERMISSIONS, { method: HttpMethod.GET }, token, signal);
  },

  listSecurityRoles(token: string, signal?: AbortSignal): Promise<SecurityRoleListResponse> {
    return request<SecurityRoleListResponse>(BackendPath.SECURITY_ROLES, { method: HttpMethod.GET }, token, signal);
  },

  updateSecurityRole(token: string, roleId: number, permissionKeys: string[], signal?: AbortSignal): Promise<SecurityRole> {
    return request<SecurityRole>(
      `${BackendPath.SECURITY_ROLES}/${roleId}`,
      { body: JSON.stringify({ permission_keys: permissionKeys }), method: HttpMethod.PATCH },
      token,
      signal
    );
  },

  createSecurityRole(token: string, displayName: string, description: string, signal?: AbortSignal): Promise<SecurityRole> {
    return request<SecurityRole>(
      BackendPath.SECURITY_ROLES,
      { body: JSON.stringify({ display_name: displayName, description }), method: HttpMethod.POST },
      token,
      signal
    );
  },

  deleteSecurityRole(token: string, roleId: number, signal?: AbortSignal): Promise<void> {
    return request<void>(`${BackendPath.SECURITY_ROLES}/${roleId}`, { method: HttpMethod.DELETE }, token, signal);
  },

  listSecurityGroups(token: string, signal?: AbortSignal): Promise<SecurityGroupListResponse> {
    return request<SecurityGroupListResponse>(BackendPath.SECURITY_GROUPS, { method: HttpMethod.GET }, token, signal);
  },

  updateGroupPermissions(token: string, groupId: number, permissionKeys: string[], signal?: AbortSignal): Promise<SecurityGroup> {
    return request<SecurityGroup>(
      `${BackendPath.SECURITY_GROUPS}/${groupId}/permissions`,
      { body: JSON.stringify({ permission_keys: permissionKeys }), method: HttpMethod.PUT },
      token,
      signal
    );
  },

  createSecurityGroup(token: string, displayName: string, description: string, signal?: AbortSignal): Promise<SecurityGroup> {
    return request<SecurityGroup>(
      BackendPath.SECURITY_GROUPS,
      { body: JSON.stringify({ display_name: displayName, description }), method: HttpMethod.POST },
      token,
      signal
    );
  },

  deleteSecurityGroup(token: string, groupId: number, signal?: AbortSignal): Promise<void> {
    return request<void>(`${BackendPath.SECURITY_GROUPS}/${groupId}`, { method: HttpMethod.DELETE }, token, signal);
  },

  updateGroupMembers(token: string, groupId: number, userIds: number[], signal?: AbortSignal): Promise<SecurityGroup> {
    return request<SecurityGroup>(
      `${BackendPath.SECURITY_GROUPS}/${groupId}/members`,
      { body: JSON.stringify({ user_ids: userIds }), method: HttpMethod.PUT },
      token,
      signal
    );
  },

  getUserPermissions(token: string, userId: number, signal?: AbortSignal): Promise<UserPermissionsResponse> {
    return request<UserPermissionsResponse>(`${BackendPath.USERS}/${userId}/permissions`, { method: HttpMethod.GET }, token, signal);
  },

  addUserPermission(token: string, userId: number, permissionKey: string, signal?: AbortSignal): Promise<unknown> {
    return request<unknown>(
      `${BackendPath.USERS}/${userId}/permissions`,
      { body: JSON.stringify({ permission_key: permissionKey }), method: HttpMethod.POST },
      token,
      signal
    );
  },

  removeUserPermission(token: string, userId: number, permissionKey: string, signal?: AbortSignal): Promise<void> {
    return request<void>(`${BackendPath.USERS}/${userId}/permissions/${encodeURIComponent(permissionKey)}`, { method: HttpMethod.DELETE }, token, signal);
  },

  updateUserRole(token: string, userId: number, roleId: number | null, signal?: AbortSignal): Promise<User> {
    return request<User>(buildBackendUserPath(userId), { body: JSON.stringify({ role_id: roleId }), method: HttpMethod.PATCH }, token, signal);
  },

  updateUserGroup(token: string, userId: number, groupId: number | null, signal?: AbortSignal): Promise<User> {
    return request<User>(buildBackendUserPath(userId), { body: JSON.stringify({ group_id: groupId }), method: HttpMethod.PATCH }, token, signal);
  },

  listSecurityAudit(token: string, limit: number, offset: number, signal?: AbortSignal): Promise<SecurityAuditListResponse> {
    return request<SecurityAuditListResponse>(
      `${BackendPath.SECURITY_AUDIT}?limit=${limit}&offset=${offset}`,
      { method: HttpMethod.GET },
      token,
      signal
    );
  },

  checkAuthz(token: string, permissions: string[], signal?: AbortSignal): Promise<AuthzCheckResponse> {
    return request<AuthzCheckResponse>(
      BackendPath.AUTHZ_CHECK,
      { body: JSON.stringify({ checks: permissions.map((p) => ({ permission: p })) }), method: HttpMethod.POST },
      token,
      signal
    );
  },
};
