import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { z } from "zod";

const baselineSchema = z
  .object({
    apiVersion: z.number().int().positive(),
    operations: z.array(
      z
        .object({
          method: z.string().min(1),
          parameters: z.array(
            z
              .object({
                in: z.string().min(1),
                name: z.string().min(1),
                required: z.boolean(),
              })
              .strict(),
          ),
          path: z.string().startsWith("/"),
          requestBody: z
            .object({
              content: z.array(z.string().min(1)),
              required: z.boolean(),
            })
            .strict()
            .optional(),
          responses: z.record(z.string(), z.array(z.string().min(1))),
        })
        .strict(),
    ),
    schemas: z.record(
      z.string(),
      z
        .object({
          properties: z.record(
            z.string(),
            z.array(z.union([z.string(), z.number(), z.boolean()])),
          ),
          required: z.array(z.string()),
        })
        .strict(),
    ),
  })
  .strict();

type JsonObject = Record<string, unknown>;

const baseline = baselineSchema.parse(
  JSON.parse(
    await readFile(
      new URL("../openapi/compatibility/v1.json", import.meta.url),
      "utf8",
    ),
  ),
);
const document = asObject(
  JSON.parse(
    await readFile(new URL("../openapi/openapi.json", import.meta.url), "utf8"),
  ),
);

assert.equal(document.openapi, "3.1.0");
const paths = asObject(document.paths);

for (const operation of baseline.operations) {
  const path = asObject(paths[operation.path]);
  const current = asObject(path[operation.method]);
  const parameters = asArray(current.parameters).map(asObject);

  for (const expected of operation.parameters) {
    const parameter = parameters.find(
      (candidate) => candidate.in === expected.in && candidate.name === expected.name,
    );
    assert.ok(
      parameter,
      `v${baseline.apiVersion} removed ${expected.in} parameter ${expected.name} from ${operation.method.toUpperCase()} ${operation.path}`,
    );
    if (!expected.required) {
      assert.notEqual(
        parameter.required,
        true,
        `v${baseline.apiVersion} made ${expected.name} required`,
      );
    }
  }

  if (operation.requestBody !== undefined) {
    const requestBody = asObject(current.requestBody);
    if (operation.requestBody.required) {
      assert.equal(
        requestBody.required,
        true,
        `v${baseline.apiVersion} made the request body optional for ${operation.method.toUpperCase()} ${operation.path}`,
      );
    }
    const content = asObject(requestBody.content);
    for (const contentType of operation.requestBody.content) {
      assert.ok(
        content[contentType],
        `v${baseline.apiVersion} removed request ${contentType} from ${operation.method.toUpperCase()} ${operation.path}`,
      );
    }
  }

  const responses = asObject(current.responses);
  for (const [status, contentTypes] of Object.entries(operation.responses)) {
    const response = asObject(responses[status]);
    const content = asObject(response.content);
    for (const contentType of contentTypes) {
      assert.ok(
        content[contentType],
        `v${baseline.apiVersion} removed ${status} ${contentType} from ${operation.method.toUpperCase()} ${operation.path}`,
      );
    }
  }
}

const components = asObject(document.components);
const schemas = asObject(components.schemas);

for (const [schemaName, expected] of Object.entries(baseline.schemas)) {
  const schema = asObject(schemas[schemaName]);
  const required = new Set(asArray(schema.required));
  for (const property of expected.required) {
    assert.ok(
      required.has(property),
      `v${baseline.apiVersion} removed required ${schemaName}.${property}`,
    );
  }

  const properties = asObject(schema.properties);
  for (const [propertyName, enumValues] of Object.entries(expected.properties)) {
    const property = asObject(properties[propertyName]);
    const currentValues = new Set(asArray(property.enum));
    for (const enumValue of enumValues) {
      assert.ok(
        currentValues.has(enumValue),
        `v${baseline.apiVersion} removed ${JSON.stringify(enumValue)} from ${schemaName}.${propertyName}`,
      );
    }
  }
}

console.log(
  `Verified backwards compatibility with published API v${baseline.apiVersion}`,
);

function asArray(value: unknown): unknown[] {
  assert.ok(Array.isArray(value), "Expected an array in OpenAPI document");
  return value;
}

function asObject(value: unknown): JsonObject {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as JsonObject;
}
