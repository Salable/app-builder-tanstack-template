import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
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
                schema: z.record(z.string(), z.unknown()),
              })
              .strict(),
          ),
          path: z.string().startsWith("/"),
          requestBody: z
            .object({
              content: z.record(z.string().min(1), z.record(z.string(), z.unknown())),
              required: z.boolean(),
            })
            .strict()
            .optional(),
          responses: z.record(
            z.string(),
            z.record(z.string().min(1), z.record(z.string(), z.unknown())),
          ),
        })
        .strict(),
    ),
    schemas: z.record(
      z.string(),
      z
        .object({
          properties: z.record(
            z.string(),
            z.record(
              z.string(),
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.array(z.union([z.string(), z.number(), z.boolean()])),
              ]),
            ),
          ),
          required: z.array(z.string()),
        })
        .strict(),
    ),
  })
  .strict();

type JsonObject = Record<string, unknown>;

const REQUEST_VALIDATION_KEYWORDS = [
  "const",
  "contains",
  "dependentRequired",
  "dependentSchemas",
  "enum",
  "exclusiveMaximum",
  "exclusiveMinimum",
  "format",
  "maxContains",
  "maxItems",
  "maxLength",
  "maxProperties",
  "maximum",
  "minContains",
  "minItems",
  "minLength",
  "minProperties",
  "minimum",
  "multipleOf",
  "not",
  "pattern",
  "patternProperties",
  "propertyNames",
  "uniqueItems",
] as const;

const compatibilityDirectory =
  process.argv[3] ?? new URL("../openapi/compatibility/", import.meta.url);
const baselineFiles = (await readdir(compatibilityDirectory))
  .filter((file) => /^v[1-9]\d*\.json$/.test(file))
  .sort((left, right) => Number(left.slice(1, -5)) - Number(right.slice(1, -5)));
assert.ok(baselineFiles.length > 0, "No published API compatibility suites found");
const baselines = await Promise.all(
  baselineFiles.map(async (file) => {
    const baseline = baselineSchema.parse(
      JSON.parse(
        await readFile(
          typeof compatibilityDirectory === "string"
            ? join(compatibilityDirectory, file)
            : new URL(file, compatibilityDirectory),
          "utf8",
        ),
      ),
    );
    assert.equal(
      file,
      `v${String(baseline.apiVersion)}.json`,
      `Compatibility fixture ${file} does not match its apiVersion`,
    );
    return baseline;
  }),
);
assert.deepEqual(
  baselines.map(({ apiVersion }) => apiVersion),
  baselines.map((_baseline, index) => index + 1),
  "Published API compatibility suites must be contiguous from v1",
);
const document = asObject(
  JSON.parse(
    await readFile(
      process.argv[2] ?? new URL("../openapi/openapi.json", import.meta.url),
      "utf8",
    ),
  ),
);

for (const baseline of baselines) {
  assert.equal(document.openapi, "3.1.0");
  const paths = asObject(document.paths);

  for (const operation of baseline.operations) {
    assert.ok(
      paths[operation.path],
      `v${baseline.apiVersion} removed operation ${operation.method.toUpperCase()} ${operation.path}`,
    );
    const path = asObject(paths[operation.path]);
    assert.ok(
      path[operation.method],
      `v${baseline.apiVersion} removed operation ${operation.method.toUpperCase()} ${operation.path}`,
    );
    const current = asObject(path[operation.method]);
    const parameters = [
      ...asOptionalArray(path.parameters),
      ...asOptionalArray(current.parameters),
    ].map(asObject);

    for (const parameter of parameters) {
      if (parameter.required !== true) continue;
      const existed = operation.parameters.some(
        (expected) => expected.in === parameter.in && expected.name === parameter.name,
      );
      assert.ok(
        existed,
        `v${baseline.apiVersion} added required ${String(parameter.in)} parameter ${String(parameter.name)} to ${operation.method.toUpperCase()} ${operation.path}`,
      );
    }

    for (const expected of operation.parameters) {
      const parameter = parameters.find(
        (candidate) => candidate.in === expected.in && candidate.name === expected.name,
      );
      assert.ok(
        parameter,
        `v${baseline.apiVersion} removed ${expected.in} parameter ${expected.name} from ${operation.method.toUpperCase()} ${operation.path}`,
      );
      if (expected.required) {
        assert.equal(
          parameter.required,
          true,
          `v${baseline.apiVersion} made required parameter ${expected.name} optional`,
        );
      }
      if (!expected.required) {
        assert.notEqual(
          parameter.required,
          true,
          `v${baseline.apiVersion} made ${expected.name} required`,
        );
      }
      assert.deepEqual(
        asObject(parameter.schema),
        expected.schema,
        `v${baseline.apiVersion} incompatibly changed parameter ${expected.name} schema`,
      );
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
      if (!operation.requestBody.required) {
        assert.notEqual(
          requestBody.required,
          true,
          `v${baseline.apiVersion} made the request body required for ${operation.method.toUpperCase()} ${operation.path}`,
        );
      }
      const content = asObject(requestBody.content);
      for (const [contentType, expectedSchema] of Object.entries(
        operation.requestBody.content,
      )) {
        assert.ok(
          content[contentType],
          `v${baseline.apiVersion} removed request ${contentType} from ${operation.method.toUpperCase()} ${operation.path}`,
        );
        assert.deepEqual(
          asObject(asObject(content[contentType]).schema),
          expectedSchema,
          `v${baseline.apiVersion} incompatibly changed request ${contentType} schema for ${operation.method.toUpperCase()} ${operation.path}`,
        );
      }
    }
    if (operation.requestBody === undefined && current.requestBody !== undefined) {
      const requestBody = asObject(current.requestBody);
      assert.notEqual(
        requestBody.required,
        true,
        `v${baseline.apiVersion} added a required request body to ${operation.method.toUpperCase()} ${operation.path}`,
      );
    }

    const responses = asObject(current.responses);
    for (const [status, mediaTypes] of Object.entries(operation.responses)) {
      assert.ok(
        responses[status],
        `v${baseline.apiVersion} removed ${status} response from ${operation.method.toUpperCase()} ${operation.path}`,
      );
      const response = asObject(responses[status]);
      const content = asObject(response.content);
      for (const [contentType, expectedSchema] of Object.entries(mediaTypes)) {
        assert.ok(
          content[contentType],
          `v${baseline.apiVersion} removed ${status} ${contentType} from ${operation.method.toUpperCase()} ${operation.path}`,
        );
        assert.deepEqual(
          asObject(asObject(content[contentType]).schema),
          expectedSchema,
          `v${baseline.apiVersion} incompatibly changed ${status} ${contentType} schema for ${operation.method.toUpperCase()} ${operation.path}`,
        );
      }
    }
  }

  const components = asObject(document.components);
  const schemas = asObject(components.schemas);

  for (const [schemaName, expected] of Object.entries(baseline.schemas)) {
    const schema = asObject(schemas[schemaName]);
    const required = new Set(asArray(schema.required));
    const properties = asObject(schema.properties);
    if (isRequestSchema(schemaName)) {
      for (const property of required) {
        assert.ok(
          expected.required.includes(String(property)),
          `v${baseline.apiVersion} added required request property ${schemaName}.${String(property)}`,
        );
      }
    }
    for (const property of expected.required) {
      assert.ok(
        required.has(property),
        `v${baseline.apiVersion} removed required ${schemaName}.${property}`,
      );
      assert.ok(
        properties[property],
        `v${baseline.apiVersion} removed required property definition ${schemaName}.${property}`,
      );
    }

    for (const [propertyName, constraints] of Object.entries(expected.properties)) {
      const property = asObject(properties[propertyName]);
      for (const [constraint, expectedValue] of Object.entries(constraints)) {
        assert.deepEqual(
          property[constraint],
          expectedValue,
          `v${baseline.apiVersion} incompatibly changed ${schemaName}.${propertyName}.${constraint}`,
        );
      }
      if (isRequestSchema(schemaName)) {
        for (const constraint of REQUEST_VALIDATION_KEYWORDS) {
          assert.ok(
            property[constraint] === undefined || constraints[constraint] !== undefined,
            `v${baseline.apiVersion} added request constraint ${schemaName}.${propertyName}.${constraint}`,
          );
        }
      }
    }
  }

  function isRequestSchema(schemaName: string): boolean {
    return baseline.operations.some(
      (operation) =>
        operation.requestBody &&
        Object.keys(operation.requestBody.content).some((contentType) => {
          const operationDocument = asObject(
            asObject(paths[operation.path])[operation.method],
          );
          const body = asObject(operationDocument.requestBody);
          const media = asObject(asObject(body.content)[contentType]);
          return asObject(media.schema).$ref === `#/components/schemas/${schemaName}`;
        }),
    );
  }

  console.log(
    `Verified backwards compatibility with published API v${baseline.apiVersion}`,
  );
}

function asArray(value: unknown): unknown[] {
  assert.ok(Array.isArray(value), "Expected an array in OpenAPI document");
  return value;
}

function asOptionalArray(value: unknown): unknown[] {
  return value === undefined ? [] : asArray(value);
}

function asObject(value: unknown): JsonObject {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as JsonObject;
}
