import { readFile, writeFile } from "node:fs/promises";

const path = "src/api/generated/client.ts";
let source = await readFile(path, "utf8");

const replacements: Array<[string, string]> = [
  [
    `  createProjectRequest: CreateProjectRequest,\n  options?: RequestInit,\n): Promise<ProjectResponse> => {\n  return apiFetch<ProjectResponse>(getPostApiV1ProjectsUrl(), {`,
    `  createProjectRequest: CreateProjectRequest,\n  organizationId: string,\n  options?: RequestInit,\n): Promise<ProjectResponse> => {\n  const headers = new Headers(options?.headers);\n  headers.set("Content-Type", "application/json");\n  headers.set("X-Organization-ID", organizationId);\n  return apiFetch<ProjectResponse>(getPostApiV1ProjectsUrl(), {`,
  ],
  [
    `    headers: { "Content-Type": "application/json", ...options?.headers },`,
    `    headers,`,
  ],
  [
    `{ data: CreateProjectRequest }`,
    `{ data: CreateProjectRequest; organizationId: string }`,
  ],
  [
    `    const { data } = props ?? {};\n\n    return postApiV1Projects(data, requestOptions);`,
    `    const { data, organizationId } = props;\n\n    return postApiV1Projects(data, organizationId, requestOptions);`,
  ],
];

for (const [before, after] of replacements) {
  if (!source.includes(before))
    throw new Error(`Generated client shape changed: ${before}`);
  source = source.replaceAll(before, after);
}

await writeFile(path, source);
