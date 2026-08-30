import type {
  RequestsEnvironment,
  RequestsHeaderField,
  RequestsQueryParam,
  RequestsRequestBody,
} from "@/api/types";

const TEMPLATE_PATTERN = /{{\s*([^{}]+?)\s*}}/g;

type TemplatedRequestDocument = {
  body: RequestsRequestBody;
  headers: RequestsHeaderField[];
  queryParams: RequestsQueryParam[];
  url: string;
};

function collectTemplateNames(text: string): string[] {
  const names = new Set<string>();
  const pattern = new RegExp(TEMPLATE_PATTERN.source, TEMPLATE_PATTERN.flags);

  for (const match of text.matchAll(pattern)) {
    const key = (match[1] ?? "").trim();
    if (key) {
      names.add(key);
    }
  }

  return [...names];
}

export function buildVariableMap(env: RequestsEnvironment | null): Record<string, string> {
  const variables: Record<string, string> = {};

  for (const variable of env?.variables ?? []) {
    const key = variable.key.trim();
    if (!variable.enabled || key.length === 0) {
      continue;
    }
    variables[key] = variable.value;
  }

  return variables;
}

export function resolveTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(TEMPLATE_PATTERN, (match, rawKey: string) => {
    const key = rawKey.trim();
    return Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] ?? "" : match;
  });
}

export function findUnresolved(text: string, vars: Record<string, string>): string[] {
  return collectTemplateNames(resolveTemplate(text, vars));
}

export function resolveRequestDocument<T extends TemplatedRequestDocument>(
  document: T,
  vars: Record<string, string>
): { document: T; unresolved: string[] } {
  const unresolved = new Set<string>();
  const trackUnresolved = (text: string) => {
    for (const key of findUnresolved(text, vars)) {
      unresolved.add(key);
    }
  };

  const url = resolveTemplate(document.url, vars);
  trackUnresolved(document.url);

  const headers = document.headers.map((header) => {
    if (!header.enabled) {
      return { ...header };
    }
    trackUnresolved(header.name);
    trackUnresolved(header.value);
    return {
      ...header,
      name: resolveTemplate(header.name, vars),
      value: resolveTemplate(header.value, vars),
    };
  });

  const queryParams = document.queryParams.map((queryParam) => {
    if (!queryParam.enabled) {
      return { ...queryParam };
    }
    trackUnresolved(queryParam.name);
    trackUnresolved(queryParam.value);
    return {
      ...queryParam,
      name: resolveTemplate(queryParam.name, vars),
      value: resolveTemplate(queryParam.value, vars),
    };
  });

  trackUnresolved(document.body.content);
  const body = {
    ...document.body,
    content: resolveTemplate(document.body.content, vars),
  };

  return {
    document: {
      ...document,
      body,
      headers,
      queryParams,
      url,
    },
    unresolved: [...unresolved],
  };
}
