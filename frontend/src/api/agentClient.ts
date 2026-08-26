import {
  AGENT_APP_NAME,
  AGENT_HOST,
  AGENT_REQUEST_HEADER,
  AGENT_REQUEST_HEADER_VALUE,
  AgentPath,
  buildAgentNotebookBookmarkPath,
  buildAgentNotebookNotePath,
  buildAgentNotebookNotesPath,
  buildAgentNotebookSearchPath,
  buildAgentJenkinsBuildsPath,
  buildAgentJenkinsFolderPath,
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
  LlmStreamEvent,
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
  LlmChatRequest,
  LlmDoneEvent,
  LlmErrorEvent,
  LlmModelInfo,
  LlmStreamMessage,
  LlmTextDeltaEvent,
  LlmToolResultEvent,
  LlmToolStartEvent,
  LlmUsageEvent,
  NamespaceCreds,
  NamespaceDeployRecipe,
  NamespaceList,
  NamespaceStatus,
  NotebookContentsResponse,
  NotebookNoteReadResponse,
  NotebookNotesResponse,
  NotebookSearchResponse,
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
  return streamAgentSse(
    port,
    token,
    path,
    { method: HttpMethod.GET },
    (frame) => {
      const message = parseJobStreamMessage(frame.event, frame.data);
      if (message) {
        onMessage(message);
      }
    },
    signal
  );
}

async function streamAgentSse(
  port: number,
  token: string,
  path: string,
  init: RequestInit,
  onFrame: (frame: { event: string; data: string }) => void,
  signal?: AbortSignal
): Promise<void> {
  const response = await fetch(buildAgentUrl(port, path), {
    ...init,
    headers: createAgentHeaders(token, {
      ...init.headers,
      [HttpHeader.ACCEPT]: MediaType.TEXT_EVENT_STREAM,
    }),
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
    onFrame(frame);
  }
}

function parseLlmStreamMessage(event: string, data: string): LlmStreamMessage | null {
  if (event === LlmStreamEvent.TEXT_DELTA) {
    return {
      data: JSON.parse(data) as LlmTextDeltaEvent,
      event: LlmStreamEvent.TEXT_DELTA,
    };
  }

  if (event === LlmStreamEvent.TOOL_START) {
    return {
      data: JSON.parse(data) as LlmToolStartEvent,
      event: LlmStreamEvent.TOOL_START,
    };
  }

  if (event === LlmStreamEvent.TOOL_RESULT) {
    return {
      data: JSON.parse(data) as LlmToolResultEvent,
      event: LlmStreamEvent.TOOL_RESULT,
    };
  }

  if (event === LlmStreamEvent.USAGE) {
    return {
      data: JSON.parse(data) as LlmUsageEvent,
      event: LlmStreamEvent.USAGE,
    };
  }

  if (event === LlmStreamEvent.DONE) {
    return {
      data: JSON.parse(data) as LlmDoneEvent,
      event: LlmStreamEvent.DONE,
    };
  }

  if (event === LlmStreamEvent.ERROR) {
    return {
      data: JSON.parse(data) as LlmErrorEvent,
      event: LlmStreamEvent.ERROR,
    };
  }

  return null;
}

function getLlmModels(
  port: number,
  token: string,
  signal?: AbortSignal
): Promise<LlmModelInfo[]> {
  return readAgentJson<LlmModelInfo[]>(
    port,
    AgentPath.LLM_MODELS,
    { method: HttpMethod.GET },
    token,
    signal
  );
}

async function streamLlmChat(
  port: number,
  token: string,
  body: LlmChatRequest,
  onMessage: (message: LlmStreamMessage) => void,
  signal?: AbortSignal
): Promise<void> {
  return streamAgentSse(
    port,
    token,
    AgentPath.LLM_CHAT,
    createJsonBody(body),
    (frame) => {
      const message = parseLlmStreamMessage(frame.event, frame.data);
      if (message) {
        onMessage(message);
      }
    },
    signal
  );
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
  getLlmModels,
  getNotebookTree(
    port: number,
    token: string,
    signal?: AbortSignal
  ): Promise<NotebookContentsResponse> {
    return readAgentJson<NotebookContentsResponse>(
      port,
      AgentPath.NOTEBOOK_CONTENTS,
      { method: HttpMethod.GET },
      token,
      signal
    );
  },

  listNotes(
    port: number,
    token: string,
    bookmark: string,
    signal?: AbortSignal
  ): Promise<NotebookNotesResponse> {
    return readAgentJson<NotebookNotesResponse>(
      port,
      buildAgentNotebookNotesPath(bookmark),
      { method: HttpMethod.GET },
      token,
      signal
    );
  },

  readNote(
    port: number,
    token: string,
    bookmark: string,
    name: string,
    signal?: AbortSignal
  ): Promise<NotebookNoteReadResponse> {
    return readAgentJson<NotebookNoteReadResponse>(
      port,
      buildAgentNotebookNotePath(bookmark, name),
      { method: HttpMethod.GET },
      token,
      signal
    );
  },

  writeNote(
    port: number,
    token: string,
    payload: {
      bookmark: string;
      flags?: Record<string, unknown>;
      name?: string;
      text: string;
    },
    signal?: AbortSignal
  ): Promise<NotebookNoteReadResponse> {
    return readAgentJson<NotebookNoteReadResponse>(
      port,
      AgentPath.NOTEBOOK_NOTE,
      createJsonBody(payload),
      token,
      signal
    );
  },

  updateNote(
    port: number,
    token: string,
    name: string,
    payload: {
      bookmark: string;
      flags?: Record<string, unknown>;
      text?: string;
    },
    signal?: AbortSignal
  ): Promise<NotebookNoteReadResponse> {
    return readAgentJson<NotebookNoteReadResponse>(
      port,
      buildAgentNotebookNotePath(payload.bookmark, name),
      createJsonBody(payload, HttpMethod.PUT),
      token,
      signal
    );
  },

  deleteNote(
    port: number,
    token: string,
    bookmark: string,
    name: string,
    signal?: AbortSignal
  ): Promise<NotebookNotesResponse> {
    return readAgentJson<NotebookNotesResponse>(
      port,
      buildAgentNotebookNotePath(bookmark, name),
      { method: HttpMethod.DELETE },
      token,
      signal
    );
  },

  createBookmark(
    port: number,
    token: string,
    name: string,
    signal?: AbortSignal
  ): Promise<NotebookContentsResponse> {
    return readAgentJson<NotebookContentsResponse>(
      port,
      AgentPath.NOTEBOOK_BOOKMARK,
      createJsonBody({ name }),
      token,
      signal
    );
  },

  renameBookmark(
    port: number,
    token: string,
    bookmark: string,
    name: string,
    signal?: AbortSignal
  ): Promise<NotebookContentsResponse> {
    return readAgentJson<NotebookContentsResponse>(
      port,
      AgentPath.NOTEBOOK_BOOKMARK,
      createJsonBody({ bookmark, name }, HttpMethod.PUT),
      token,
      signal
    );
  },

  deleteBookmark(
    port: number,
    token: string,
    bookmark: string,
    signal?: AbortSignal
  ): Promise<NotebookContentsResponse> {
    return readAgentJson<NotebookContentsResponse>(
      port,
      buildAgentNotebookBookmarkPath(bookmark),
      { method: HttpMethod.DELETE },
      token,
      signal
    );
  },

  searchNotes(
    port: number,
    token: string,
    query: string,
    signal?: AbortSignal
  ): Promise<NotebookSearchResponse> {
    return readAgentJson<NotebookSearchResponse>(
      port,
      buildAgentNotebookSearchPath(query),
      { method: HttpMethod.GET },
      token,
      signal
    );
  },

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

  streamLlmChat,

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
