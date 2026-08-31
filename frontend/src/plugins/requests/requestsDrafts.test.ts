import { afterEach, describe, expect, it } from "vitest";

import {
  clearRequestsDrafts,
  getRequestsDraft,
  renameVariableInRequestsDrafts,
  setRequestsDraft,
} from "@/plugins/requests/requestsDrafts";

const IDENTITY = { folder: "IAM", name: "Get user token", token: "t1" } as const;

afterEach(() => {
  clearRequestsDrafts();
});

describe("renameVariableInRequestsDrafts", () => {
  it("rewrites {{oldKey}} to {{newKey}} across draft fields", () => {
    setRequestsDraft(IDENTITY, {
      body: { content: '{"host":"{{iamBase}}"}', mode: "json" },
      credentialId: null,
      folder: "IAM",
      headers: [{ enabled: true, name: "X-Base", value: "{{ iamBase }}" }],
      method: "GET",
      name: "Get user token",
      queryParams: [{ enabled: true, name: "base", value: "{{iamBase}}" }],
      url: "{{iamBase}}/iam/auth/jwt/users/{user_id}/token",
    });

    renameVariableInRequestsDrafts("iamBase", "iamBase23");

    const draft = getRequestsDraft(IDENTITY);
    expect(draft?.url).toBe("{{iamBase23}}/iam/auth/jwt/users/{user_id}/token");
    expect(draft?.headers[0]?.value).toBe("{{iamBase23}}");
    expect(draft?.queryParams[0]?.value).toBe("{{iamBase23}}");
    expect(draft?.body.content).toBe('{"host":"{{iamBase23}}"}');
  });

  it("does not touch unrelated variables or partial name matches", () => {
    setRequestsDraft(IDENTITY, {
      body: { content: "", mode: "none" },
      credentialId: null,
      folder: "IAM",
      headers: [],
      method: "GET",
      name: "Get user token",
      queryParams: [],
      url: "{{iamBaseX}}/{{verifyBase}}",
    });

    renameVariableInRequestsDrafts("iamBase", "iamBase23");

    expect(getRequestsDraft(IDENTITY)?.url).toBe("{{iamBaseX}}/{{verifyBase}}");
  });

  it("is a no-op when the key is unchanged or empty", () => {
    setRequestsDraft(IDENTITY, {
      body: { content: "", mode: "none" },
      credentialId: null,
      folder: "IAM",
      headers: [],
      method: "GET",
      name: "Get user token",
      queryParams: [],
      url: "{{iamBase}}",
    });

    renameVariableInRequestsDrafts("iamBase", "iamBase");
    renameVariableInRequestsDrafts("", "whatever");

    expect(getRequestsDraft(IDENTITY)?.url).toBe("{{iamBase}}");
  });
});
