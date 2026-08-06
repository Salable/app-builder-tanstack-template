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
  it("rejects unsafe unfinished manifest defaults and missing retirement ownership", () => {
    const unsafe = FeatureFlagManifestSchema.safeParse({
      schemaVersion: 1,
      manifestVersion: "1.0.0",
      definitions: [
        {
          key: "unfinished.capability",
          valueKind: "BOOLEAN",
          safeFallback: true,
          description: "An unfinished capability.",
          owner: "generated-product-team",
          capability: "unfinished-capability",
          exposure: "CLIENT_EXPOSED",
          lifecycle: "ACTIVE",
          removalCondition: null,
          removalTaskReference: null,
          introducedVersion: "0.1.0",
        },
      ],
    });
    expect(unsafe.success).toBe(false);
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
    expect(normalizeContext({ subjectId: "same" })).toBe(
      normalizeContext({ subjectId: "same" }),
    );
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

  it("requires the four environment-bound runtime settings", () => {
    expect(() => createFeatureFlagRuntimeClient({})).toThrow(
      /APP_BUILDER_CONTROL_PLANE_URL/,
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
