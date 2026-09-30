import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductFeatureFlagEvaluator, normalizeContext } from "./evaluator";
import { FeatureFlagManifestSchema } from "./manifest";
import {
  AppBuilderFeatureFlagRuntimeClient,
  createFeatureFlagRuntimeClient,
  type FeatureFlagRuntimeClient,
} from "./runtime-client";
import type { RuntimeFeatureFlagValue } from "./contracts";

afterEach(() => vi.restoreAllMocks());

describe("App Builder-owned feature flags", () => {
  it.each([
    [
      "unsafe defaults",
      { safeFallback: true },
      "safeFallback",
      "unfinished boolean flags must fail safely to false",
    ],
    [
      "missing retirement ownership",
      { removalCondition: null, removalTaskReference: null },
      "removalCondition",
      "unfinished flags require retirement ownership",
    ],
  ] as const)("rejects %s for unfinished flags", (_name, change, field, message) => {
    const unsafe = FeatureFlagManifestSchema.safeParse({
      schemaVersion: 1,
      manifestVersion: "1.0.0",
      definitions: [
        {
          key: "unfinished.capability",
          valueKind: "BOOLEAN",
          safeFallback: false,
          description: "An unfinished capability.",
          owner: "generated-product-team",
          capability: "unfinished-capability",
          exposure: "CLIENT_EXPOSED",
          lifecycle: "ACTIVE",
          removalCondition: "Remove after the capability is fully enabled.",
          removalTaskReference: "task_retire_flag",
          introducedVersion: "0.1.0",
          ...change,
        },
      ],
    });
    expect(unsafe.success).toBe(false);
    expect(unsafe.error?.issues).toEqual([
      expect.objectContaining({
        path: ["definitions", 0, field],
        message,
      }),
    ]);
  });

  it("evaluates typed control-plane values and privacy-digests context", async () => {
    const client = new FakeRuntimeClient();
    const evaluator = new ProductFeatureFlagEvaluator(client);
    const result = await evaluator.evaluateBoolean("draft.dashboard", false, {
      subjectId: "person@example.test",
      organizationId: "organization-secret",
      attributes: { locale: "en-GB" },
    });
    expect(result).toMatchObject({
      value: true,
      reason: "CONTROL_PLANE",
      revision: 4,
    });
    expect(result.contextDigest).not.toContain("person@example.test");
    expect(
      normalizeContext({ subjectId: " same ", attributes: { b: "2", a: "1" } }),
    ).toBe(normalizeContext({ subjectId: "same", attributes: { a: "1", b: "2" } }));
    for (const context of [
      { subjectId: "other" },
      { subjectId: "same", organizationId: "other" },
      { subjectId: "same", attributes: { locale: "fr" } },
    ]) {
      expect(normalizeContext(context)).not.toBe(
        normalizeContext({ subjectId: "same" }),
      );
    }
  });

  it("fails safely and exposes only client-allowlisted values", async () => {
    const unavailable: FeatureFlagRuntimeClient = {
      async evaluate() {
        throw new Error("control plane unavailable");
      },
    };
    await expect(
      new ProductFeatureFlagEvaluator(unavailable).evaluateBoolean(
        "draft.dashboard",
        false,
      ),
    ).resolves.toMatchObject({
      value: false,
      reason: "SAFE_FALLBACK",
      errorCode: "CONTROL_PLANE_UNAVAILABLE",
    });
    await expect(
      new ProductFeatureFlagEvaluator(new FakeRuntimeClient()).clientSnapshot([
        "draft.dashboard",
        "server.kill-switch",
      ]),
    ).resolves.toEqual({ "draft.dashboard": true });
  });

  it("uses a server-only credential against the exact environment endpoint", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        schemaVersion: 1,
        projectId: "project_generated_app",
        environmentId: "environment_preview_generated",
        values: [],
        evaluatedAt: "2026-08-04T19:30:00.000Z",
      }),
    );
    const client = new AppBuilderFeatureFlagRuntimeClient(
      new URL("https://builder.example.test"),
      "project_generated_app",
      "environment_preview_generated",
      `ffrt_flagcredential_test.${"a".repeat(43)}`,
      transport,
    );
    await client.evaluate(["draft.dashboard"]);
    expect(transport).toHaveBeenCalledOnce();
    const [url, request] = transport.mock.calls[0]!;
    expect(String(url)).toContain(
      "/api/runtime/v1/projects/project_generated_app/environments/environment_preview_generated/feature-flags/evaluate",
    );
    expect((request?.headers as Record<string, string>).Authorization).toMatch(
      /^Bearer ffrt_/,
    );
    expect(JSON.stringify(request)).not.toContain("DATABASE_URL");
  });

  it.each(["projectId", "environmentId"] as const)(
    "rejects a response bound to a different %s",
    async (field) => {
      const transport = vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          schemaVersion: 1,
          projectId: "project_generated_app",
          environmentId: "environment_preview_generated",
          values: [],
          evaluatedAt: "2026-08-04T19:30:00.000Z",
          [field]: `${field === "projectId" ? "project" : "environment"}_foreign`,
        }),
      );
      await expect(
        runtimeClient(transport).evaluate(["draft.dashboard"]),
      ).rejects.toThrow("Feature flag response belongs to another environment.");
    },
  );

  it.each(["subject", "organization"] as const)(
    "validates a successful %s registration against the current project",
    async (kind) => {
      const payload = {
        schemaVersion: 1,
        projectId: "project_generated_app",
        ...(kind === "subject"
          ? { subjectId: "flagsubject_customer" }
          : { organizationId: "flagorganization_account" }),
        externalKeyHash: "a".repeat(64),
        label: "Customer",
        createdAt: "2026-08-04T19:30:00.000Z",
        lastSeenAt: "2026-08-04T19:30:00.000Z",
      };
      const transport = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json(payload))
        .mockResolvedValueOnce(
          Response.json({ ...payload, projectId: "project_foreign" }),
        )
        .mockResolvedValueOnce(
          Response.json({ ...payload, externalKeyHash: "invalid" }),
        );
      const client = runtimeClient(transport);
      const register = () =>
        kind === "subject"
          ? client.registerSubject("customer", "Customer")
          : client.registerOrganization("customer", "Customer");
      await expect(register()).resolves.toEqual(payload);
      const [url, request] = transport.mock.calls[0]!;
      expect(String(url)).toContain(
        `/projects/project_generated_app/environments/environment_preview_generated/feature-flags/${kind === "subject" ? "subjects" : "organizations"}`,
      );
      expect(request?.method).toBe("POST");
      expect(JSON.parse(request?.body as string)).toEqual({
        externalKey: "customer",
        label: "Customer",
      });
      await expect(register()).rejects.toThrow(
        "Feature flag registration belongs to another project.",
      );
      await expect(register()).rejects.toMatchObject({
        name: "ZodError",
        issues: [expect.objectContaining({ path: ["externalKeyHash"] })],
      });
      expect(transport).toHaveBeenCalledTimes(3);
    },
  );

  it.each(["subjects", "organizations", "members"])(
    "rejects failed %s registration without accepting provider details",
    async (operation) => {
      const transport = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("private provider detail", { status: 503 }));
      const client = runtimeClient(transport);
      const result =
        operation === "subjects"
          ? client.registerSubject("customer")
          : operation === "organizations"
            ? client.registerOrganization("account")
            : client.addOrganizationMember(
                "flagorganization_account",
                "flagsubject_customer",
              );
      await expect(result).rejects.toThrow("Feature flag access registration failed.");
      expect(transport).toHaveBeenCalledOnce();
    },
  );

  it.each([Response.json({ values: [] }), new Response("private", { status: 502 })])(
    "falls back when an actual runtime-client response is unusable",
    async (response) => {
      const transport = vi.fn<typeof fetch>().mockResolvedValue(response);
      const evaluator = new ProductFeatureFlagEvaluator(runtimeClient(transport));
      await expect(
        evaluator.evaluateBoolean("draft.dashboard", false),
      ).resolves.toMatchObject({
        value: false,
        reason: "SAFE_FALLBACK",
        errorCode: "CONTROL_PLANE_UNAVAILABLE",
      });
    },
  );

  it.each([
    [
      "remote HTTP",
      { endpoint: "http://remote.example.test" },
      "Feature flag control-plane URL must use HTTPS.",
    ],
    [
      "invalid project",
      { projectId: "foreign" },
      "Feature flag runtime identity is invalid.",
    ],
    [
      "invalid environment",
      { environmentId: "foreign" },
      "Feature flag runtime identity is invalid.",
    ],
    [
      "invalid token prefix",
      { token: "x".repeat(80) },
      "Feature flag runtime credential is invalid.",
    ],
    [
      "short token",
      { token: "ffrt_flagcredential_short" },
      "Feature flag runtime credential is invalid.",
    ],
  ] as const)(
    "rejects %s configuration before any request",
    (_name, change, message) => {
      const input = {
        endpoint: "https://builder.example.test",
        projectId: "project_test",
        environmentId: "environment_test",
        token: `ffrt_flagcredential_test.${"a".repeat(43)}`,
        ...change,
      };
      const transport = vi.fn<typeof fetch>();
      expect(
        () =>
          new AppBuilderFeatureFlagRuntimeClient(
            new URL(input.endpoint),
            input.projectId,
            input.environmentId,
            input.token,
            transport,
          ),
      ).toThrow(message);
      expect(transport).not.toHaveBeenCalled();
    },
  );

  it.each(["localhost", "127.0.0.1", "[::1]"])(
    "permits the explicit local HTTP development endpoint %s",
    async (host) => {
      const transport = vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          schemaVersion: 1,
          projectId: "project_test",
          environmentId: "environment_test",
          values: [],
          evaluatedAt: "2026-08-04T19:30:00.000Z",
        }),
      );
      const client = new AppBuilderFeatureFlagRuntimeClient(
        new URL(`http://${host}:3000`),
        "project_test",
        "environment_test",
        `ffrt_flagcredential_test.${"a".repeat(43)}`,
        transport,
      );
      await expect(client.evaluate([])).resolves.toEqual([]);
      expect(String(transport.mock.calls[0]![0])).toBe(
        `http://${host}:3000/api/runtime/v1/projects/project_test/environments/environment_test/feature-flags/evaluate`,
      );
    },
  );

  it.each([
    "APP_BUILDER_CONTROL_PLANE_URL",
    "APP_BUILDER_PROJECT_ID",
    "APP_ENVIRONMENT_ID",
    "APP_BUILDER_FEATURE_FLAG_RUNTIME_TOKEN",
  ])("requires the environment-bound setting %s", (missing) => {
    const environment = {
      APP_BUILDER_CONTROL_PLANE_URL: "https://builder.example.test",
      APP_BUILDER_PROJECT_ID: "project_generated_app",
      APP_ENVIRONMENT_ID: "environment_preview_generated",
      APP_BUILDER_FEATURE_FLAG_RUNTIME_TOKEN: `ffrt_flagcredential_test.${"a".repeat(43)}`,
      [missing]: undefined,
    };

    expect(() => createFeatureFlagRuntimeClient(environment)).toThrow(
      `${missing} is required for feature flag evaluation.`,
    );
  });
});

class FakeRuntimeClient implements FeatureFlagRuntimeClient {
  async evaluate(keys: readonly string[]): Promise<RuntimeFeatureFlagValue[]> {
    const values: RuntimeFeatureFlagValue[] = [];
    for (const key of keys) {
      if (key === "draft.dashboard") {
        values.push({
          key,
          valueKind: "BOOLEAN",
          value: true,
          exposure: "CLIENT_EXPOSED",
          revision: 4,
        });
      }
      if (key === "server.kill-switch") {
        values.push({
          key,
          valueKind: "BOOLEAN",
          value: false,
          exposure: "SERVER_ONLY",
          revision: 2,
        });
      }
    }
    return values;
  }
}

function runtimeClient(transport: typeof fetch) {
  return new AppBuilderFeatureFlagRuntimeClient(
    new URL("https://builder.example.test"),
    "project_generated_app",
    "environment_preview_generated",
    `ffrt_flagcredential_test.${"a".repeat(43)}`,
    transport,
  );
}
