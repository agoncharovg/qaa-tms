import type {
  RequestsHeaderField,
  RequestsMethod,
  RequestsQueryParam,
  RequestsRequestBody,
} from "@/api/types";

const BACKSLASH = String.fromCharCode(92);
const CURL_COMMAND = "curl";
const CARRIAGE_RETURN = String.fromCharCode(13);
const DOUBLE_QUOTE = String.fromCharCode(34);
const LINE_FEED = String.fromCharCode(10);
const SINGLE_QUOTE = String.fromCharCode(39);
const METHOD_VALUES = new Set<RequestsMethod>([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

export interface ParsedCurl {
  body: RequestsRequestBody;
  headers: RequestsHeaderField[];
  method: RequestsMethod;
  queryParams: RequestsQueryParam[];
  url: string;
}

export interface CurlBuildDocument extends ParsedCurl {
  credentialId?: string | null;
  credentialName?: string | null;
}

type QuoteState = "double" | "none" | "single";

function normalizeMethod(value: string): RequestsMethod | null {
  const upper = value.trim().toUpperCase();
  return METHOD_VALUES.has(upper as RequestsMethod) ? (upper as RequestsMethod) : null;
}

function decodeQueryValue(value: string): string {
  try {
    return decodeURIComponent(value.replaceAll("+", " "));
  } catch {
    return value;
  }
}

function shellQuote(value: string): string {
  const escapedSingleQuote = `${SINGLE_QUOTE}"${SINGLE_QUOTE}"${SINGLE_QUOTE}"${SINGLE_QUOTE}`;
  return `${SINGLE_QUOTE}${value.split(SINGLE_QUOTE).join(escapedSingleQuote)}${SINGLE_QUOTE}`;
}

function removeLineContinuations(input: string): string {
  let normalized = "";

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index] ?? "";
    const next = input[index + 1] ?? "";
    const nextNext = input[index + 2] ?? "";

    if (char === BACKSLASH && next === CARRIAGE_RETURN && nextNext === LINE_FEED) {
      normalized += " ";
      index += 2;
      continue;
    }

    if (char === BACKSLASH && next === LINE_FEED) {
      normalized += " ";
      index += 1;
      continue;
    }

    normalized += char;
  }

  return normalized;
}

function tokenizeCurl(input: string): string[] {
  const normalized = removeLineContinuations(input);
  const tokens: string[] = [];
  let current = "";
  let quoteState: QuoteState = "none";

  const pushToken = () => {
    if (current.length > 0) {
      tokens.push(current);
      current = "";
    }
  };

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index] ?? "";
    if (quoteState === "single") {
      if (char === SINGLE_QUOTE) {
        quoteState = "none";
      } else {
        current += char;
      }
      continue;
    }

    if (quoteState === "double") {
      if (char === DOUBLE_QUOTE) {
        quoteState = "none";
      } else if (char === BACKSLASH && index + 1 < normalized.length) {
        index += 1;
        current += normalized[index] ?? "";
      } else {
        current += char;
      }
      continue;
    }

    if (char.trim() === "") {
      pushToken();
      continue;
    }

    if (char === SINGLE_QUOTE) {
      quoteState = "single";
      continue;
    }

    if (char === DOUBLE_QUOTE) {
      quoteState = "double";
      continue;
    }

    if (char === BACKSLASH && index + 1 < normalized.length) {
      index += 1;
      current += normalized[index] ?? "";
      continue;
    }

    current += char;
  }

  pushToken();
  return tokens;
}

function buildHeader(name: string, value: string): RequestsHeaderField {
  return { enabled: true, name, value };
}

function buildQueryParam(name: string, value: string): RequestsQueryParam {
  return { enabled: true, name, value };
}

function parseHeader(input: string): RequestsHeaderField {
  const separatorIndex = input.indexOf(":");
  if (separatorIndex < 0) {
    return buildHeader(input.trim(), "");
  }

  return buildHeader(
    input.slice(0, separatorIndex).trim(),
    input.slice(separatorIndex + 1).trimStart()
  );
}

function encodeBasicCredentials(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function splitUrlAndQuery(url: string): { queryParams: RequestsQueryParam[]; url: string } {
  if (!url) {
    return { queryParams: [], url: "" };
  }

  const fragmentIndex = url.indexOf("#");
  const fragment = fragmentIndex >= 0 ? url.slice(fragmentIndex) : "";
  const withoutFragment = fragmentIndex >= 0 ? url.slice(0, fragmentIndex) : url;
  const queryIndex = withoutFragment.indexOf("?");
  if (queryIndex < 0) {
    return { queryParams: [], url };
  }

  const queryText = withoutFragment.slice(queryIndex + 1);
  const queryParams = queryText
    .split("&")
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      const separatorIndex = segment.indexOf("=");
      if (separatorIndex < 0) {
        return buildQueryParam(decodeQueryValue(segment), "");
      }

      return buildQueryParam(
        decodeQueryValue(segment.slice(0, separatorIndex)),
        decodeQueryValue(segment.slice(separatorIndex + 1))
      );
    });

  return {
    queryParams,
    url: `${withoutFragment.slice(0, queryIndex)}${fragment}`,
  };
}

function looksLikeUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

function inferBodyMode(headers: RequestsHeaderField[], body: string): RequestsRequestBody["mode"] {
  const hasJsonHeader = headers.some(
    (header) =>
      header.name.trim().toLowerCase() === "content-type"
      && header.value.toLowerCase().includes("application/json")
  );
  if (hasJsonHeader) {
    return "json";
  }

  const trimmed = body.trim();
  if (!trimmed) {
    return "raw";
  }

  try {
    JSON.parse(trimmed);
    return "json";
  } catch {
    return "raw";
  }
}

function appendQueryParams(url: string, queryParams: RequestsQueryParam[]): string {
  const enabled = queryParams.filter(
    (row) => row.enabled && (row.name.trim().length > 0 || row.value.trim().length > 0)
  );
  if (enabled.length === 0) {
    return url;
  }

  const fragmentIndex = url.indexOf("#");
  const fragment = fragmentIndex >= 0 ? url.slice(fragmentIndex) : "";
  const withoutFragment = fragmentIndex >= 0 ? url.slice(0, fragmentIndex) : url;
  const queryText = enabled
    .map((row) => `${encodeURIComponent(row.name)}=${encodeURIComponent(row.value)}`)
    .join("&");
  const separator = withoutFragment.includes("?") ? "&" : "?";
  return `${withoutFragment}${separator}${queryText}${fragment}`;
}

export function parseCurl(input: string): ParsedCurl {
  const tokens = tokenizeCurl(input);
  const headers: RequestsHeaderField[] = [];
  let bodyContent = "";
  let hasBody = false;
  let method: RequestsMethod | null = null;
  let url = "";

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (index === 0 && token === CURL_COMMAND) {
      continue;
    }

    if (token === "-X" || token === "--request") {
      const value = tokens[index + 1] ?? "";
      method = normalizeMethod(value) ?? method;
      if (value) {
        index += 1;
      }
      continue;
    }

    if (token.startsWith("-X") && token.length > 2) {
      method = normalizeMethod(token.slice(2)) ?? method;
      continue;
    }

    if (token.startsWith("--request=")) {
      method = normalizeMethod(token.slice("--request=".length)) ?? method;
      continue;
    }

    if (token === "-H" || token === "--header") {
      const value = tokens[index + 1] ?? "";
      if (value) {
        headers.push(parseHeader(value));
        index += 1;
      }
      continue;
    }

    if (token.startsWith("-H") && token.length > 2) {
      headers.push(parseHeader(token.slice(2)));
      continue;
    }

    if (token.startsWith("--header=")) {
      headers.push(parseHeader(token.slice("--header=".length)));
      continue;
    }

    if (token === "-d" || token === "--data" || token === "--data-raw" || token === "--data-binary") {
      const value = tokens[index + 1] ?? "";
      hasBody = true;
      bodyContent += value;
      if (value) {
        index += 1;
      }
      continue;
    }

    if (token.startsWith("--data=") || token.startsWith("--data-raw=") || token.startsWith("--data-binary=")) {
      hasBody = true;
      bodyContent += token.slice(token.indexOf("=") + 1);
      continue;
    }

    if (token === "--url") {
      const value = tokens[index + 1] ?? "";
      if (value) {
        url = value;
        index += 1;
      }
      continue;
    }

    if (token.startsWith("--url=")) {
      url = token.slice("--url=".length);
      continue;
    }

    if (token === "-u" || token === "--user") {
      const value = tokens[index + 1] ?? "";
      if (value) {
        headers.push(buildHeader("Authorization", `Basic ${encodeBasicCredentials(value)}`));
        index += 1;
      }
      continue;
    }

    if (token.startsWith("-u") && token.length > 2) {
      headers.push(buildHeader("Authorization", `Basic ${encodeBasicCredentials(token.slice(2))}`));
      continue;
    }

    if (token.startsWith("--user=")) {
      headers.push(
        buildHeader("Authorization", `Basic ${encodeBasicCredentials(token.slice("--user=".length))}`)
      );
      continue;
    }

    if (token === "-b" || token === "--cookie") {
      const value = tokens[index + 1] ?? "";
      if (value) {
        headers.push(buildHeader("Cookie", value));
        index += 1;
      }
      continue;
    }

    if (token.startsWith("-b") && token.length > 2) {
      headers.push(buildHeader("Cookie", token.slice(2)));
      continue;
    }

    if (token.startsWith("--cookie=")) {
      headers.push(buildHeader("Cookie", token.slice("--cookie=".length)));
      continue;
    }

    if (!url && looksLikeUrl(token)) {
      url = token;
    }
  }

  const parsedUrl = splitUrlAndQuery(url);
  const body = hasBody
    ? { content: bodyContent, mode: inferBodyMode(headers, bodyContent) }
    : { content: "", mode: "none" as const };

  return {
    body,
    headers,
    method: method ?? (hasBody ? "POST" : "GET"),
    queryParams: parsedUrl.queryParams,
    url: parsedUrl.url,
  };
}

export function buildCurl(document: CurlBuildDocument): string {
  const headers = document.headers.filter(
    (header) => header.enabled && (header.name.trim().length > 0 || header.value.trim().length > 0)
  );
  const hasManualAuthorization = headers.some(
    (header) => header.name.trim().toLowerCase() === "authorization"
  );
  const lines = [
    "curl",
    `  -X ${document.method}`,
    `  ${shellQuote(appendQueryParams(document.url, document.queryParams))}`,
    ...headers.map((header) => `  -H ${shellQuote(`${header.name}: ${header.value}`)}`),
  ];

  if (document.body.mode !== "none") {
    lines.push(`  --data-raw ${shellQuote(document.body.content)}`);
  }

  const continuation = ` ${BACKSLASH}`;
  const newline = String.fromCharCode(10);
  const curlText = lines
    .map((line, index) => (index < lines.length - 1 ? `${line}${continuation}` : line))
    .join(newline);

  if (document.credentialId && !hasManualAuthorization) {
    const credentialName = document.credentialName ?? document.credentialId;
    return `${curlText}${newline}# Authorization is injected from credential "${credentialName}" at send time`;
  }

  return curlText;
}
