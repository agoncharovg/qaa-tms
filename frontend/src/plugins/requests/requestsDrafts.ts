import type {
  RequestsHeaderField,
  RequestsMethod,
  RequestsQueryParam,
  RequestsRequestBody,
} from "@/api/types";

export interface RequestsEditorDraft {
  credentialId: string | null;
  folder: string | null;
  headers: RequestsHeaderField[];
  method: RequestsMethod;
  name: string | null;
  queryParams: RequestsQueryParam[];
  body: RequestsRequestBody;
  url: string;
}

type RequestsDraftIdentity = {
  folder: string | null;
  name: string | null;
  token: string | null;
};

const requestsDrafts = new Map<string, RequestsEditorDraft>();
const REQUESTS_DRAFT_KEY_SEPARATOR = "u0000";
const NEW_REQUEST_DRAFT_NAME = "__draft__";

function buildRequestsDraftKey({ folder, name, token }: RequestsDraftIdentity): string | null {
  if (!token || !folder) {
    return null;
  }

  return [token, folder, name ?? NEW_REQUEST_DRAFT_NAME].join(REQUESTS_DRAFT_KEY_SEPARATOR);
}

export function getRequestsDraft(identity: RequestsDraftIdentity): RequestsEditorDraft | undefined {
  const key = buildRequestsDraftKey(identity);
  return key ? requestsDrafts.get(key) : undefined;
}

export function setRequestsDraft(identity: RequestsDraftIdentity, draft: RequestsEditorDraft): void {
  const key = buildRequestsDraftKey(identity);
  if (!key) {
    return;
  }

  requestsDrafts.set(key, draft);
}

export function clearRequestsDraft(identity: RequestsDraftIdentity): void {
  const key = buildRequestsDraftKey(identity);
  if (!key) {
    return;
  }

  requestsDrafts.delete(key);
}

export function clearRequestsDraftsForFolder(token: string | null, folder: string): void {
  if (!token) {
    return;
  }

  const prefix = [token, folder].join(REQUESTS_DRAFT_KEY_SEPARATOR) + REQUESTS_DRAFT_KEY_SEPARATOR;
  for (const key of requestsDrafts.keys()) {
    if (key.startsWith(prefix)) {
      requestsDrafts.delete(key);
    }
  }
}

export function renameRequestsDraftFolder(
  token: string | null,
  sourceFolder: string,
  targetFolder: string
): void {
  if (!token || sourceFolder === targetFolder) {
    return;
  }

  const prefix =
    [token, sourceFolder].join(REQUESTS_DRAFT_KEY_SEPARATOR) + REQUESTS_DRAFT_KEY_SEPARATOR;
  for (const [key, value] of requestsDrafts.entries()) {
    if (!key.startsWith(prefix)) {
      continue;
    }

    const name = key.slice(prefix.length);
    requestsDrafts.delete(key);
    requestsDrafts.set([token, targetFolder, name].join(REQUESTS_DRAFT_KEY_SEPARATOR), value);
  }
}

export function clearRequestsDrafts(): void {
  requestsDrafts.clear();
}

