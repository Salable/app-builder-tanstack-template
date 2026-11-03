import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const render = vi.hoisted(() =>
  vi.fn(async (_request: Request) => new Response("rendered")),
);
// The framework renderer is an external boundary; API/auth/application handlers remain real.
vi.mock("@tanstack/react-start/server-entry", () => ({
  default: { fetch: render },
  createServerEntry: (entry: unknown) => entry,
}));

beforeEach(() => {
  for (const name of [
    "DATABASE_URL",
    "BETTER_AUTH_SECRET",
    "NEON_AUTH_BASE_URL",
    "VITE_NEON_AUTH_URL",
    "NEON_AUTH_COOKIE_SECRET",
    "VERCEL",
    "VERCEL_ENV",
    "VERCEL_URL",
    "VERCEL_PROJECT_PRODUCTION_URL",
  ])
    vi.stubEnv(name, undefined);
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("HOST", "127.0.0.1");
  vi.stubEnv("PORT", "3000");
  render.mockReset().mockResolvedValue(new Response("rendered"));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

function configureNeon() {
  vi.stubEnv("NEON_AUTH_BASE_URL", "http://127.0.0.1:4000/auth");
  vi.stubEnv("VITE_NEON_AUTH_URL", "http://127.0.0.1:4000/auth");
  vi.stubEnv("NEON_AUTH_COOKIE_SECRET", "test-cookie-secret-at-least-32-characters");
}

describe("server entry diagnostics", () => {
  it("logs incomplete auth configuration with the response reference and leaves successful rendering quiet", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { default: entry } = await import("./server");
    const page = await entry.fetch(new Request("http://127.0.0.1:3000/"));
    expect(await page.text()).toBe("rendered");
    expect(log).not.toHaveBeenCalled();
    const response = await entry.fetch(
      new Request("http://127.0.0.1:3000/api/auth/get-session?private=credential"),
    );
    const problem = await response.json();
    expect(response.status).toBe(503);
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.parse(log.mock.calls[0]![0])).toMatchObject({
      code: "IDENTITY_CONFIGURATION_MISSING",
      correlationId: problem.correlationId,
      path: "/api/auth/*",
      error: { diagnostic: { category: "configuration" } },
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("private");
  });

  it("logs an auth protocol rejection once without exposing request credentials", async () => {
    configureNeon();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { default: entry } = await import("./server");
    const response = await entry.fetch(
      new Request("http://127.0.0.1:3000/api/auth/sign-in/email", {
        method: "POST",
        headers: { origin: "http://untrusted.invalid" },
        body: "private credentials",
      }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ message: "Invalid request origin." });
    expect(warning).toHaveBeenCalledOnce();
    expect(JSON.parse(warning.mock.calls[0]![0])).toMatchObject({
      code: "AUTH_REQUEST_REJECTED",
      status: 403,
      method: "POST",
      correlationId: response.headers.get("X-Correlation-ID"),
    });
    expect(JSON.stringify(warning.mock.calls)).not.toContain("private");
  });

  it("keeps the real auth response when its diagnostic sink fails", async () => {
    configureNeon();
    vi.spyOn(console, "error").mockImplementation(() => {
      throw new Error("sink failed");
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ message: "Unavailable" }, { status: 503 })),
    );
    const { default: entry } = await import("./server");
    const response = await entry.fetch(
      new Request("http://127.0.0.1:3000/api/auth/get-session"),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ message: "Unavailable" });
  });

  it("retains the SDK's auth transport classification without altering its protocol response", async () => {
    configureNeon();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failure = new TypeError("private connection details", {
      cause: Object.assign(new Error("private socket"), { code: "ECONNREFUSED" }),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw failure;
      }),
    );
    const { default: entry } = await import("./server");
    const response = await entry.fetch(
      new Request("http://127.0.0.1:3000/api/auth/get-session"),
    );
    expect(response.status).toBe(502);
    expect((await response.json()).code).toBe("NETWORK_REFUSED");
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.parse(log.mock.calls[0]![0])).toMatchObject({
      code: "AUTH_REQUEST_REJECTED",
      error: {
        type: "DiagnosticError",
        diagnostic: {
          category: "provider",
          dependency: "neon-auth",
          code: "NETWORK_REFUSED",
        },
      },
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("private");
  });

  it("keeps thrown rendering failures terminal even if the logger fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failure = new TypeError("private rendering details");
    render.mockRejectedValue(failure);
    const { default: entry } = await import("./server");
    await expect(
      entry.fetch(new Request("http://127.0.0.1:3000/private-user")),
    ).rejects.toBe(failure);
    expect(JSON.parse(log.mock.calls[0]![0])).toMatchObject({
      source: "server",
      code: "SERVER_RENDER_FAILED",
      error: { type: "TypeError" },
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("private");
    log.mockImplementation(() => {
      throw new Error("sink failed");
    });
    await expect(entry.fetch(new Request("http://127.0.0.1:3000/"))).rejects.toBe(
      failure,
    );
  });

  it("logs an auth handler exception without changing the thrown error", async () => {
    configureNeon();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { default: entry } = await import("./server");
    const request = new Request("http://127.0.0.1:3000/api/auth/sign-out", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:3000" },
      body: "{}",
    });
    await request.text();
    await expect(entry.fetch(request)).rejects.toBeInstanceOf(TypeError);
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.parse(log.mock.calls[0]![0])).toMatchObject({
      code: "AUTH_REQUEST_FAILED",
      error: { type: "TypeError" },
    });
  });

  it("preserves an auth response when diagnostic headers cannot be changed", async () => {
    configureNeon();
    const log = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const set = Headers.prototype.set;
    vi.spyOn(Headers.prototype, "set").mockImplementation(function (
      this: Headers,
      name,
      value,
    ) {
      if (name.toLowerCase() === "x-correlation-id")
        throw new TypeError("immutable headers");
      return set.call(this, name, value);
    });
    const { default: entry } = await import("./server");
    const response = await entry.fetch(
      new Request("http://127.0.0.1:3000/api/auth/sign-out", {
        method: "POST",
        headers: { origin: "http://untrusted.invalid" },
        body: "{}",
      }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ message: "Invalid request origin." });
    expect(log).toHaveBeenCalledOnce();
  });

  it("keeps a successful auth protocol response unchanged and quiet", async () => {
    configureNeon();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(null)),
    );
    const { default: entry } = await import("./server");
    const response = await entry.fetch(
      new Request("http://127.0.0.1:3000/api/auth/get-session"),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
    expect(log).not.toHaveBeenCalled();
  });

  it("does not classify a normal provider redirect as a failure", async () => {
    configureNeon();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 302 })),
    );
    const { default: entry } = await import("./server");
    const response = await entry.fetch(
      new Request("http://127.0.0.1:3000/api/auth/sign-in"),
    );
    expect(response.status).toBe(302);
    expect(log).not.toHaveBeenCalled();
  });

  it.each(["malformed JSON", "invalid session dates", "logger failure"])(
    "records cookie-mint %s after successful sign-in without changing the response",
    async (scenario) => {
      configureNeon();
      const log = vi.spyOn(console, "error").mockImplementation(() => {
        if (scenario === "logger failure")
          throw new Error("diagnostic sink unavailable");
      });
      const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const fetch = vi.fn(async (url: string) => {
        if (url.endsWith("/get-session")) {
          if (scenario === "invalid session dates")
            return Response.json({
              session: {
                id: "private-session",
                createdAt: "private-invalid-date",
                updatedAt: "2026-01-01T00:00:00Z",
                expiresAt: "2099-01-01T00:00:00Z",
              },
              user: {
                id: "private-user",
                createdAt: "2026-01-01T00:00:00Z",
                updatedAt: "2026-01-01T00:00:00Z",
              },
            });
          return new Response("private malformed upstream session", {
            headers: { "content-type": "application/json" },
          });
        }
        return Response.json(
          { ok: true },
          {
            headers: {
              "set-cookie":
                "__Secure-neon-auth.session_token=private-token; Path=/; Secure; HttpOnly",
            },
          },
        );
      });
      vi.stubGlobal("fetch", fetch);
      const { default: entry } = await import("./server");
      const response = await entry.fetch(
        new Request("http://127.0.0.1:3000/api/auth/sign-in/email", {
          method: "POST",
          headers: {
            origin: "http://127.0.0.1:3000",
            "content-type": "application/json",
          },
          body: '{"email":"private@example.test","password":"private-password"}',
        }),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
      expect(response.headers.get("set-cookie")).toContain(
        "session_token=private-token",
      );
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(log).toHaveBeenCalledOnce();
      expect(warning).not.toHaveBeenCalled();
      expect(JSON.parse(log.mock.calls[0]![0])).toMatchObject({
        code: "AUTH_RESPONSE_DEGRADED",
        status: 200,
        correlationId: response.headers.get("X-Correlation-ID"),
        error: {
          diagnostic: {
            category: "provider",
            dependency: "neon-auth",
            operation: "identity.proxy",
            code: "IDENTITY_SDK_FAILED",
          },
        },
      });
      expect(JSON.stringify(log.mock.calls)).not.toContain("private");
      expect(log.mock.calls[0]).toHaveLength(1);
    },
  );

  it("leaves API error serialization and reporting with the API boundary", async () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { default: entry } = await import("./server");
    const response = await entry.fetch(
      new Request("http://127.0.0.1:3000/api/v1/health"),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("UNSUPPORTED_API_VERSION");
    expect(log).toHaveBeenCalledOnce();
  });
});
