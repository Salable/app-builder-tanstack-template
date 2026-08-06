import { afterEach, describe, expect, it, vi } from "vitest";
import openApiDocument from "../../openapi/openapi.json" with { type: "json" };
import { ProblemDetailSchema, ProtectedFeatureResponseSchema } from "./contracts";
import { getOpenApiDocument, publicApi } from "./app";
import { setProjectAccessRepositoryForTesting } from "../authorization/project-access";
import {
  FakeEntitlementProvider,
  createEntitlementProvider,
  setEntitlementProviderForTesting,
} from "../entitlements/entitlement-provider";
import {
  IdentityConfigurationError,
  setIdentityProviderForTesting,
} from "../identity/identity-provider";
import { setProjectRepositoryForTesting } from "../projects/repository-provider";
import { ProjectOrganizationAccessError } from "../projects/project-repository";

const projectId = "4a130ba5-ed6e-4ae5-bac8-1d73073fa94a";
const organizationId = "596875ff-7396-46f2-8968-7d34b8871872";

afterEach(() => {
  vi.unstubAllGlobals();
  setIdentityProviderForTesting(undefined);
  setProjectAccessRepositoryForTesting(undefined);
  setEntitlementProviderForTesting(undefined);
  setProjectRepositoryForTesting(undefined);
});

describe("generated application public API", () => {
  it("exposes the network proof fixture only with both test environment gates", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousFlag = process.env.APP_BUILDER_TEST_NETWORK_DENY_PROOF;
    try {
      process.env.NODE_ENV = "production";
      process.env.APP_BUILDER_TEST_NETWORK_DENY_PROOF = "1";
      expect((await publicApi.request("/api/v1/test/network-deny-proof")).status).toBe(
        404,
      );

      process.env.NODE_ENV = "test";
      delete process.env.APP_BUILDER_TEST_NETWORK_DENY_PROOF;
      expect((await publicApi.request("/api/v1/test/network-deny-proof")).status).toBe(
        404,
      );

      process.env.APP_BUILDER_TEST_NETWORK_DENY_PROOF = "1";
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("denied")));
      const response = await publicApi.request("/api/v1/test/network-deny-proof");
      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toContain("denied");
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
      process.env.APP_BUILDER_TEST_NETWORK_DENY_PROOF = previousFlag;
    }
  });

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

  it("serves the checked-in OpenAPI contract without runtime regeneration", async () => {
    const response = await publicApi.request("/api/v1/openapi.json");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(openApiDocument);
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

  it("requires authentication to create an organization-scoped project", async () => {
    setIdentityProviderForTesting({ authenticate: async () => null });
    const response = await createProjectRequest();
    expect(response.status).toBe(401);
  });

  it("returns the documented 503 when identity configuration is unavailable", async () => {
    setIdentityProviderForTesting({
      authenticate: async () => {
        throw new IdentityConfigurationError("unavailable");
      },
    });

    const response = await createProjectRequest();

    expect(response.status).toBe(503);
    expect(ProblemDetailSchema.parse(await response.json())).toMatchObject({
      status: 503,
      title: "Service Unavailable",
      type: expect.stringMatching(/\/identity-unavailable$/),
    });
    expect(
      getOpenApiDocument().paths?.["/api/v1/projects"]?.post?.responses?.["503"],
    ).toBeDefined();
  });

  it("rejects project creation outside the user's organization memberships", async () => {
    installIdentity();
    setProjectRepositoryForTesting({
      create: async () => {
        throw new ProjectOrganizationAccessError();
      },
    });
    const response = await createProjectRequest();
    expect(response.status).toBe(403);
  });

  it("creates a project with its authenticated owner and organization context", async () => {
    installIdentity();
    setProjectRepositoryForTesting({
      create: async (input, requestedOrganizationId, userId) => {
        expect([input, requestedOrganizationId, userId]).toEqual([
          { name: "Owned project" },
          organizationId,
          "owner-user",
        ]);
        return {
          createdAt: "2026-07-31T00:00:00.000Z",
          id: projectId,
          name: input.name,
          revision: 1,
        };
      },
    });
    const response = await createProjectRequest();
    expect(response.status).toBe(201);
  });

  it.each(["   ", "  a"])(
    "accepts the project name %j allowed by the published v1 contract",
    async (name) => {
      installIdentity();
      setProjectRepositoryForTesting({
        create: async (input) => {
          expect(input.name).toBe(name);
          return {
            createdAt: "2026-07-31T00:00:00.000Z",
            id: projectId,
            name: input.name,
            revision: 1,
          };
        },
      });

      const response = await createProjectRequest(name);
      expect(response.status).toBe(201);
    },
  );

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

  it("returns the documented 200 through production entitlement configuration", async () => {
    installOwnerBoundary();
    setEntitlementProviderForTesting(
      createEntitlementProvider({
        NODE_ENV: "production",
        APP_BUILDER_ENTITLED_ORGANIZATION_IDS: organizationId,
      }),
    );

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
  installIdentity();
  setProjectAccessRepositoryForTesting({
    findOwnedProject: async (requestedProjectId, userId) =>
      requestedProjectId === projectId && userId === "owner-user"
        ? { organizationId, projectId }
        : null,
  });
}

function installIdentity(): void {
  setIdentityProviderForTesting({
    authenticate: async () => ({
      email: "owner@example.test",
      name: "Project Owner",
      sessionId: "session-owner",
      userId: "owner-user",
    }),
  });
}

function createProjectRequest(name = "Owned project"): Promise<Response> {
  return Promise.resolve(
    publicApi.request("/api/v1/projects", {
      method: "POST",
      headers: {
        "API-Version": "1",
        "Content-Type": "application/json",
        "X-Organization-ID": organizationId,
      },
      body: JSON.stringify({ name }),
    }),
  );
}

function protectedFeatureRequest(): Promise<Response> {
  return Promise.resolve(
    publicApi.request(`/api/v1/projects/${projectId}/protected-feature`, {
      headers: { "API-Version": "1" },
    }),
  );
}
