import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("v1 compatibility gate", () => {
  it("fails when the protected-feature operation is removed", () => {
    const document = JSON.parse(readFileSync("openapi/openapi.json", "utf8"));
    delete document.paths["/api/v1/projects/{projectId}/protected-feature"];
    const path = join(mkdtempSync(join(tmpdir(), "compatibility-")), "openapi.json");
    writeFileSync(path, JSON.stringify(document));
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/check-openapi-compatibility.ts", path],
      { encoding: "utf8" },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("protected-feature");
  });

  it("fails when a required request property definition is removed", () => {
    const document = readDocument();
    delete document.components.schemas.CreateProjectRequest.properties.name;
    const result = check(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("CreateProjectRequest.name");
  });

  it("fails when a response property changes incompatibly", () => {
    const document = readDocument();
    document.components.schemas.ProjectResponse.properties.name.type = "number";
    const result = check(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("ProjectResponse.name.type");
  });

  it("fails when the published project 503 response is removed", () => {
    const document = readDocument();
    delete document.paths["/api/v1/projects"].post.responses["503"];
    const result = check(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("removed 503 response");
  });

  it("fails when a required request property is added", () => {
    const document = readDocument();
    document.components.schemas.CreateProjectRequest.properties.description = {
      type: "string",
    };
    document.components.schemas.CreateProjectRequest.required.push("description");
    const result = check(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("added required request property");
  });

  it("fails when a restrictive pattern is added to a published request property", () => {
    const document = readDocument();
    document.components.schemas.CreateProjectRequest.properties.name.pattern = "\\\\S";
    const result = check(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "added request constraint CreateProjectRequest.name.pattern",
    );
  });

  it("fails when a required operation parameter is added", () => {
    const document = readDocument();
    document.paths["/api/v1/projects"].post.parameters.push({
      in: "query",
      name: "mode",
      required: true,
      schema: { type: "string" },
    });
    const result = check(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("added required query parameter mode");
  });

  it("fails when the organization header schema changes", () => {
    const document = readDocument();
    document.paths["/api/v1/projects"].post.parameters.find(
      (parameter: { name: string }) => parameter.name === "X-Organization-ID",
    ).schema = { type: "integer" };
    const result = check(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("X-Organization-ID schema");
  });

  it("fails when an operation response schema changes", () => {
    const document = readDocument();
    document.paths["/api/v1/projects"].post.responses["201"].content[
      "application/json"
    ].schema = { $ref: "#/components/schemas/HealthResponse" };
    const result = check(document);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("201 application/json schema");
  });

  it("executes every published version suite instead of only v1", () => {
    const compatibilityDirectory = mkdtempSync(join(tmpdir(), "compatibility-"));
    const v1 = JSON.parse(readFileSync("openapi/compatibility/v1.json", "utf8"));
    const v2 = structuredClone(v1);
    v2.apiVersion = 2;
    v2.operations.push({
      method: "get",
      parameters: [],
      path: "/api/v2/removed-operation",
      responses: {},
    });
    writeFileSync(join(compatibilityDirectory, "v1.json"), JSON.stringify(v1));
    writeFileSync(join(compatibilityDirectory, "v2.json"), JSON.stringify(v2));

    const result = check(readDocument(), compatibilityDirectory);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("v2 removed operation");
  });
});

function readDocument() {
  return JSON.parse(readFileSync("openapi/openapi.json", "utf8"));
}

function check(document: Record<string, unknown>, compatibilityDirectory?: string) {
  const path = join(mkdtempSync(join(tmpdir(), "compatibility-")), "openapi.json");
  writeFileSync(path, JSON.stringify(document));
  return spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/check-openapi-compatibility.ts",
      path,
      ...(compatibilityDirectory === undefined ? [] : [compatibilityDirectory]),
    ],
    { encoding: "utf8" },
  );
}
