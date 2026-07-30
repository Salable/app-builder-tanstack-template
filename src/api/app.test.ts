import { afterEach, describe, expect, it } from "vitest";
import { ProblemDetailSchema, ProtectedFeatureResponseSchema } from "./contracts";
import { getOpenApiDocument, publicApi } from "./app";
import { setProjectAccessRepositoryForTesting } from "../authorization/project-access";
import {
  FakeEntitlementProvider,
  setEntitlementProviderForTesting,
} from "../entitlements/entitlement-provider";
import { setIdentityProviderForTesting } from "../identity/identity-provider";

const projectId = "4a130ba5-ed6e-4ae5-bac8-1d73073fa94a";
const organizationId = "596875ff-7396-46f2-8968-7d34b8871872";

afterEach(() => {
  setIdentityProviderForTesting(undefined);
  setProjectAccessRepositoryForTesting(undefined);
  setEntitlementProviderForTesting(undefined);
});

describe("generated application public API", () => {
  it("defaults API version and returns correlation metadata", async () => {
    const response = await publicApi.request("/api/v1/health");

    expect(response.status).toBe(200);
    expect(response.headers.get("API-Version")).toBe("1");
    expect(response.headers.get("Vary")).toBe("API-Version");
    expect(response.headers.get("X-Correlation-ID")).toMatch(/^corr_/);
    await expect(response.json()).resolves.toEqual({
      service: "generated-app",
      status: "ok",
      version: 1,
    });
  });

  it("rejects unsupported versions with RFC 9457 details", async () => {
    const response = await publicApi.request("/api/v1/health", {
      headers: {
        "API-Version": "2",
        "X-Correlation-ID": "corr_test",
      },
    });

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    expect(ProblemDetailSchema.parse(await response.json()).correlationId).toBe(
      "corr_test",
    );
  });

  it("generates a deterministic OpenAPI 3.1 contract", () => {
    const document = getOpenApiDocument();
    expect(document.openapi).toBe("3.1.0");
    expect(document.paths?.["/api/v1/health"]?.get).toBeDefined();
    expect(
      document.paths?.["/api/v1/projects/{projectId}/protected-feature"]?.get,
    ).toBeDefined();
  });

  it("uses the same sanitized problem boundary for unknown API routes", async () => {
    const response = await publicApi.request("/api/v1/missing");

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    expect(ProblemDetailSchema.parse(await response.json())).toMatchObject({
      detail: "The requested API route does not exist.",
      status: 404,
      title: "Not Found",
    });
  });

  it("requires a server-verified session for the protected feature", async () => {
    setIdentityProviderForTesting({
      authenticate: async () => null,
    });

    const response = await protectedFeatureRequest();

    expect(response.status).toBe(401);
    expect(ProblemDetailSchema.parse(await response.json())).toMatchObject({
      status: 401,
      title: "Unauthorized",
    });
  });

  it.each(["same-tenant-user", "other-tenant-user"])(
    "conceals the project from a %s",
    async (userId) => {
      setIdentityProviderForTesting({
        authenticate: async () => ({
          email: `${userId}@example.test`,
          name: userId,
          sessionId: `session-${userId}`,
          userId,
        }),
      });
      setProjectAccessRepositoryForTesting({
        findOwnedProject: async () => null,
      });

      const response = await protectedFeatureRequest();

      expect(response.status).toBe(404);
      expect(ProblemDetailSchema.parse(await response.json())).toMatchObject({
        detail: "The requested project does not exist.",
        status: 404,
      });
    },
  );

  it("denies an authenticated owner without the fake entitlement", async () => {
    installOwnerBoundary();
    setEntitlementProviderForTesting(new FakeEntitlementProvider());

    const response = await protectedFeatureRequest();

    expect(response.status).toBe(403);
    expect(ProblemDetailSchema.parse(await response.json())).toMatchObject({
      status: 403,
      title: "Entitlement required",
    });
  });

  it("returns the protected feature only after every server-side gate", async () => {
    installOwnerBoundary();
    setEntitlementProviderForTesting(new FakeEntitlementProvider([organizationId]));

    const response = await protectedFeatureRequest();

    expect(response.status).toBe(200);
    expect(ProtectedFeatureResponseSchema.parse(await response.json())).toEqual({
      capability: "protected-insights",
      projectId,
      status: "available",
    });
  });
});

function installOwnerBoundary(): void {
  setIdentityProviderForTesting({
    authenticate: async () => ({
      email: "owner@example.test",
      name: "Project Owner",
      sessionId: "session-owner",
      userId: "owner-user",
    }),
  });
  setProjectAccessRepositoryForTesting({
    findOwnedProject: async (requestedProjectId, userId) =>
      requestedProjectId === projectId && userId === "owner-user"
        ? { organizationId, projectId }
        : null,
  });
}

function protectedFeatureRequest(): Promise<Response> {
  return Promise.resolve(
    publicApi.request(`/api/v1/projects/${projectId}/protected-feature`, {
      headers: { "API-Version": "1" },
    }),
  );
}
