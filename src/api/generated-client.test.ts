import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getApiV1Health,
  postApiV1Projects,
  type PostApiV1ProjectsMutationError,
} from "./generated/client";
import { ApiError } from "./fetch-mutator";

afterEach(() => vi.unstubAllGlobals());

describe("generated API client errors", () => {
  it("exposes the ApiError runtime shape to typed consumers", () => {
    const consume = (error: PostApiV1ProjectsMutationError) =>
      `${error.status}:${error.problem.detail}:${error.problem.correlationId}`;
    const error = new ApiError(503, {
      correlationId: "corr_typed",
      detail: "identity unavailable",
      instance: "/api/v1/projects",
      status: 503,
      title: "Service Unavailable",
      type: "https://example.test/identity-unavailable",
    });

    expect(consume(error)).toBe("503:identity unavailable:corr_typed");
  });

  it.each([
    [
      "unsupported version",
      400,
      () => getApiV1Health({ headers: { "API-Version": "2" } }),
    ],
    ["validation", 400, () => postApiV1Projects({ name: "x" }, crypto.randomUUID())],
    [
      "conflict",
      409,
      () => postApiV1Projects({ name: "Duplicate" }, crypto.randomUUID()),
    ],
    [
      "server error",
      500,
      () => postApiV1Projects({ name: "Failure" }, crypto.randomUUID()),
    ],
  ])("throws a structured error for %s responses", async (_name, status, request) => {
    const problem = {
      correlationId: "corr_test",
      detail: "request failed",
      instance: "/api/v1/projects",
      status,
      title: "Failure",
      type: "https://example.test/problem",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(problem), {
          status,
          headers: { "Content-Type": "application/problem+json" },
        }),
      ),
    );
    await expect(request()).rejects.toMatchObject({ status, problem });
  });

  it.each([
    undefined,
    { "API-Version": "1" },
    new Headers([["API-Version", "1"]]),
    [["API-Version", "1"]] as [string, string][],
  ])(
    "supplies the API version and organization context for every HeadersInit form",
    async (headers) => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: crypto.randomUUID(),
            name: "Test",
            revision: 1,
            createdAt: new Date().toISOString(),
          }),
          {
            status: 201,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
      vi.stubGlobal("fetch", fetchMock);
      const organizationId = crypto.randomUUID();

      await postApiV1Projects({ name: "Test" }, organizationId, { headers });

      const sent = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
      expect(sent.get("API-Version")).toBe("1");
      expect(sent.get("Content-Type")).toBe("application/json");
      expect(sent.get("X-Organization-ID")).toBe(organizationId);
    },
  );

  it("requires organization context at compile time", () => {
    const compileTimeAssertion = () => {
      // @ts-expect-error organizationId is required
      void postApiV1Projects({ name: "Missing organization" });
    };
    expect(compileTimeAssertion).toBeTypeOf("function");
  });
});
