import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getApiV1Health,
  postApiV1Projects,
  type PostApiV1ProjectsMutationError,
} from "./generated/client";
import { ApiError, apiFetch } from "./fetch-mutator";

afterEach(() => vi.unstubAllGlobals());

// Checked by tsc, never invoked: the generated API requires organization context.
void (() => {
  // @ts-expect-error organizationId is required
  void postApiV1Projects({ name: "Missing organization" });
});

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
      type: "about:blank" as const,
      code: "IDENTITY_PROVIDER_UNAVAILABLE",
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
      type: "about:blank" as const,
      code: "TEST_FAILURE",
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
    ["HTML error", 502, "<html>private upstream details</html>"],
    ["empty error", 500, ""],
    ["wrong problem shape", 400, JSON.stringify({ detail: { secret: "private" } })],
    [
      "missing code",
      503,
      JSON.stringify({
        type: "about:blank",
        title: "Service Unavailable",
        status: 503,
        detail: "private obsolete response",
        correlationId: "corr_old",
        instance: "/",
      }),
    ],
    [
      "obsolete problem type",
      503,
      JSON.stringify({
        type: "https://example.test/obsolete",
        code: "UNAVAILABLE",
        title: "Service Unavailable",
        status: 503,
        detail: "private obsolete response",
        correlationId: "corr_old",
        instance: "/",
      }),
    ],
    [
      "mismatched status",
      409,
      JSON.stringify({
        correlationId: "corr_wrong",
        instance: "/",
        title: "Wrong",
        detail: "private",
        type: "about:blank" as const,
        code: "TEST_FAILURE",
        status: 500,
      }),
    ],
    ["malformed success", 200, "private invalid JSON"],
    ["not modified", 304, null],
  ] as const)("normalizes %s into a safe ApiError", async (_name, status, body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status })));
    const result = apiFetch("/api/v1/health", {});
    await expect(result).rejects.toBeInstanceOf(ApiError);
    await expect(result).rejects.toMatchObject({
      status: status >= 400 ? status : 502,
      message: "The API returned an invalid response.",
      problem: { status: status >= 400 ? status : 502, code: "INVALID_RESPONSE" },
    });
    await result.catch((error: ApiError) => {
      expect(JSON.stringify(error)).not.toContain("private");
      expect(error.problem.correlationId).toBeTruthy();
    });
  });

  it("normalizes transport rejection without exposing the provider exception", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("private connection URL")),
    );
    const result = getApiV1Health();
    await expect(result).rejects.toBeInstanceOf(ApiError);
    await expect(result).rejects.toMatchObject({
      status: 503,
      message: "The API could not be reached.",
      problem: { status: 503 },
    });
  });

  it("normalizes an interrupted body read", async () => {
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new Error("private stream failure"));
        },
      }),
      { status: 200 },
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    await expect(getApiV1Health()).rejects.toMatchObject({
      name: "ApiError",
      status: 502,
      message: "The API returned an invalid response.",
    });
  });

  it.each([204, 205])(
    "accepts no-content success %i without parsing JSON",
    async (status) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));
      await expect(apiFetch("/api/v1/health", {})).resolves.toBeUndefined();
    },
  );

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
});
