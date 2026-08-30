import { describe, expect, it } from "vitest";

import type { RequestsEnvironment } from "@/api/types";
import { buildVariableMap, findUnresolved, resolveRequestDocument, resolveTemplate } from "@/plugins/requests/requestsVariables";

describe("requestsVariables", () => {
  it("builds the variable map from enabled rows with last key wins", () => {
    const environment: RequestsEnvironment = {
      createdAt: "2026-08-30T00:00:00Z",
      id: "env-1",
      name: "staging",
      updatedAt: "2026-08-30T00:00:00Z",
      variables: [
        { enabled: true, key: " iamBase ", value: "https://old.test" },
        { enabled: false, key: "ignored", value: "nope" },
        { enabled: true, key: "iamBase", value: "https://new.test" },
      ],
    };

    expect(buildVariableMap(environment)).toEqual({ iamBase: "https://new.test" });
  });

  it("resolves templates with whitespace, preserves unknowns, and does not recurse", () => {
    const vars = {
      dollars: "$1-and-$2",
      nested: "{{second}}",
      service: "https://svc.test",
    };

    expect(resolveTemplate("{{ service }}/{{ unknown }}?x={{ dollars }}", vars)).toBe(
      "https://svc.test/{{ unknown }}?x=$1-and-$2"
    );
    expect(resolveTemplate("{{nested}}", vars)).toBe("{{second}}");
  });

  it("finds unresolved names after a single resolution pass", () => {
    const vars = {
      first: "{{second}}",
      third: "done",
    };

    expect(findUnresolved("{{ first }} {{ third }} {{ missing }} {{ missing }}", vars)).toEqual([
      "second",
      "missing",
    ]);
  });

  it("resolves request documents in the supported fields only", () => {
    const vars = {
      bodyValue: "payload",
      headerName: "X-Stage",
      host: "https://svc.test",
      page: "42",
      queryName: "env",
      stage: "{{derived}}",
    };

    const result = resolveRequestDocument(
      {
        body: { content: '{"value":"{{bodyValue}}","missing":"{{missingBody}}"}', mode: "json" as const },
        credentialId: "cred-1",
        folder: "Folder",
        headers: [
          { enabled: true, name: "{{ headerName }}", value: "{{ stage }}", },
          { enabled: false, name: "{{ignored}}", value: "{{ignoredValue}}" },
        ],
        method: "GET" as const,
        name: "Request",
        queryParams: [
          { enabled: true, name: "{{ queryName }}", value: "{{ page }}" },
          { enabled: true, name: "missing", value: "{{ missingQuery }}" },
        ],
        url: "{{ host }}/items/{{missingPath}}",
      },
      vars
    );

    expect(result.document).toEqual({
      body: { content: '{"value":"payload","missing":"{{missingBody}}"}', mode: "json" },
      credentialId: "cred-1",
      folder: "Folder",
      headers: [
        { enabled: true, name: "X-Stage", value: "{{derived}}" },
        { enabled: false, name: "{{ignored}}", value: "{{ignoredValue}}" },
      ],
      method: "GET",
      name: "Request",
      queryParams: [
        { enabled: true, name: "env", value: "42" },
        { enabled: true, name: "missing", value: "{{ missingQuery }}" },
      ],
      url: "https://svc.test/items/{{missingPath}}",
    });
    expect(result.unresolved).toEqual(["missingPath", "derived", "missingQuery", "missingBody"]);
  });
});
