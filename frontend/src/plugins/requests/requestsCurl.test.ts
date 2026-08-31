import { describe, expect, it } from "vitest";

import { buildCurl, parseCurl } from "@/plugins/requests/requestsCurl";

const SINGLE_QUOTE = String.fromCharCode(39);

describe("requestsCurl", () => {
  it("parses method, headers, query params, and json body from curl", () => {
    const quotedJson = `${SINGLE_QUOTE}{"name":"one"}${SINGLE_QUOTE}`;
    const parsed = parseCurl(`curl \\
      -X POST \\
      --url "https://svc.test/items?page=1&filter=all" \\
      -H "Content-Type: application/json" \\
      -H "X-Trace: alpha" \\
      --data-raw ${quotedJson}`);

    expect(parsed.method).toBe("POST");
    expect(parsed.url).toBe("https://svc.test/items");
    expect(parsed.queryParams).toEqual([
      { enabled: true, name: "page", value: "1" },
      { enabled: true, name: "filter", value: "all" },
    ]);
    expect(parsed.headers).toEqual([
      { enabled: true, name: "Content-Type", value: "application/json" },
      { enabled: true, name: "X-Trace", value: "alpha" },
    ]);
    expect(parsed.body).toEqual({ content: `{"name":"one"}`, mode: "json" });
  });

  it("defaults data requests to POST and maps user plus cookie flags into headers", () => {
    const quotedJson = `${SINGLE_QUOTE}{"ok":true}${SINGLE_QUOTE}`;
    const parsed = parseCurl(
      `curl --url https://svc.test/auth -u user:pass -b session=abc --data ${quotedJson}`
    );

    expect(parsed.method).toBe("POST");
    expect(parsed.url).toBe("https://svc.test/auth");
    expect(parsed.headers).toContainEqual({
      enabled: true,
      name: "Authorization",
      value: "Basic dXNlcjpwYXNz",
    });
    expect(parsed.headers).toContainEqual({ enabled: true, name: "Cookie", value: "session=abc" });
    expect(parsed.body.mode).toBe("json");
  });

  it("returns a best effort result for malformed input", () => {
    const badInput = `curl -H "broken --data-raw {not json`;
    expect(() => parseCurl(badInput)).not.toThrow();

    const parsed = parseCurl(badInput);

    expect(parsed.method).toBe("GET");
    expect(parsed.url).toBe("");
  });

  it("builds a multi-line curl with enabled rows only and a credential comment", () => {
    const apostrophe = String.fromCharCode(39);
    const result = buildCurl({
      body: { content: `{"note":"it${apostrophe}s ready"}`, mode: "raw" },
      credentialId: "cred-1",
      credentialName: "Main bearer",
      headers: [
        { enabled: true, name: "Accept", value: "application/json" },
        { enabled: false, name: "X-Ignore", value: "nope" },
      ],
      method: "POST",
      queryParams: [
        { enabled: true, name: "page", value: "1" },
        { enabled: false, name: "skip", value: "2" },
      ],
      url: "https://svc.test/items",
    });

    const escapedBody = `{"note":"it${SINGLE_QUOTE}"${SINGLE_QUOTE}"${SINGLE_QUOTE}"${SINGLE_QUOTE}s ready"}`;
    expect(result).toContain("curl");
    expect(result).toContain("-X POST");
    expect(result).toContain(`${SINGLE_QUOTE}https://svc.test/items?page=1${SINGLE_QUOTE}`);
    expect(result).toContain(`-H ${SINGLE_QUOTE}Accept: application/json${SINGLE_QUOTE}`);
    expect(result).toContain(`--data-raw ${SINGLE_QUOTE}${escapedBody}${SINGLE_QUOTE}`);
    expect(result).toContain(`# Authorization is injected from credential "Main bearer" at send time`);
    expect(result).not.toContain("skip=2");
    expect(result).not.toContain("X-Ignore");
  });

  it("omits the credential comment when a manual authorization header exists", () => {
    const result = buildCurl({
      body: { content: "", mode: "none" },
      credentialId: "cred-1",
      credentialName: "Main bearer",
      headers: [{ enabled: true, name: "Authorization", value: "Bearer local" }],
      method: "GET",
      queryParams: [],
      url: "https://svc.test/items",
    });

    expect(result).not.toContain("injected from credential");
  });
});
