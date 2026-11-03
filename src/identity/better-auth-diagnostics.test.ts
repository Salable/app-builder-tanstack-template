import { createHmac } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start/server-entry", () => ({
  default: { fetch: async () => new Response("rendered") },
  createServerEntry: (entry: unknown) => entry,
}));

const origin = "http://127.0.0.1:3000";
const secret = "diagnostic-test-secret-with-at-least-32-characters";
let close: (() => Promise<void>) | undefined;

beforeEach(() => {
  for (const key of [
    "NEON_AUTH_BASE_URL",
    "VITE_NEON_AUTH_URL",
    "NEON_AUTH_COOKIE_SECRET",
    "VERCEL",
    "VERCEL_ENV",
    "VERCEL_URL",
    "VERCEL_PROJECT_PRODUCTION_URL",
  ])
    vi.stubEnv(key, undefined);
  // Better Auth deliberately bypasses origin checks under NODE_ENV=test.
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("TEST", undefined);
  vi.stubEnv("HOST", "127.0.0.1");
  vi.stubEnv("PORT", "3000");
  vi.stubEnv("DATABASE_URL", "postgresql://example.invalid/generated_app");
  vi.stubEnv("BETTER_AUTH_SECRET", secret);
});

afterEach(async () => {
  await close?.();
  close = undefined;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function application() {
  const { getBetterAuthRuntime } = await import("./better-auth-runtime");
  const runtime = getBetterAuthRuntime();
  close = runtime.close;
  const { default: entry } = await import("../server");
  return { runtime, entry };
}

function cookie() {
  const token = "private-session-token";
  const signature = createHmac("sha256", secret).update(token).digest("base64");
  return `generated-app.session_token=${encodeURIComponent(`${token}.${signature}`)}`;
}

const signOut = (requestOrigin = origin) =>
  new Request(`${origin}/api/auth/sign-out`, {
    method: "POST",
    headers: {
      origin: requestOrigin,
      cookie: cookie(),
      "content-type": "application/json",
    },
    body: "{}",
  });

const databaseFailure = () =>
  Object.assign(new Error("private SQL and credentials"), { code: "08006" });

function failSessionDelete(failure: Promise<never> | Error) {
  const query = vi
    .fn()
    .mockResolvedValueOnce({
      command: "SELECT",
      rowCount: 1,
      rows: [
        {
          id: "session-1",
          token: "private-session-token",
          userId: "user-1",
          expiresAt: new Date("2099-01-01"),
        },
      ],
    })
    .mockImplementationOnce(() =>
      failure instanceof Error ? Promise.reject(failure) : failure,
    );
  const client = { query, release: vi.fn() } as unknown as PoolClient;
  vi.spyOn(Pool.prototype, "connect").mockImplementation(async () => client);
  return query;
}

describe("Better Auth safe SDK diagnostics", () => {
  it.each([false, true])(
    "keeps a real SDK sign-in database failure as one safe correlated empty500 response (sink fails: %s)",
    async (sinkFails) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {
        if (sinkFails) throw new Error("sink unavailable");
      });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      // Fail the external PostgreSQL connection, retaining the SDK's real
      // findUserByEmail, dispatch, error hook and Better Call router path.
      const connect = vi
        .spyOn(Pool.prototype, "connect")
        .mockRejectedValue(databaseFailure());
      const { entry } = await application();
      const [response, healthy] = await Promise.all([
        entry.fetch(
          new Request(`${origin}/api/auth/sign-in/email`, {
            method: "POST",
            headers: { origin, "content-type": "application/json" },
            body: JSON.stringify({
              email: "private@example.test",
              password: "private-password",
            }),
          }),
        ),
        entry.fetch(new Request(`${origin}/api/auth/get-session`)),
      ]);
      expect(connect).toHaveBeenCalledOnce();
      expect(response.status).toBe(500);
      expect(response.statusText).toBe("Internal Server Error");
      expect(await response.text()).toBe("");
      expect(response.headers.getSetCookie()).toEqual([]);
      expect(healthy.status).toBe(200);
      expect(await healthy.json()).toBeNull();
      expect(log).toHaveBeenCalledOnce();
      expect(warn).not.toHaveBeenCalled();
      expect(log.mock.calls[0]).toHaveLength(1);
      expect(JSON.parse(log.mock.calls[0]![0])).toMatchObject({
        code: "AUTH_REQUEST_REJECTED",
        status: 500,
        correlationId: response.headers.get("X-Correlation-ID"),
        error: {
          diagnostic: { dependency: "better-auth", operation: "identity.proxy" },
          cause: { code: "08006" },
        },
      });
      expect(JSON.stringify(log.mock.calls)).not.toContain("private");
    },
  );
  it.each([false, true])(
    "logs a swallowed sign-out database error once while preserving success and cookies (sink fails: %s)",
    async (sinkFails) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {
        if (sinkFails) throw new Error("sink unavailable");
      });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      // Fault injection is at the external PostgreSQL driver boundary. The SDK's
      // cookie validation, sign-out route and swallowed-error behavior remain real.
      const query = failSessionDelete(databaseFailure());
      const { entry } = await application();
      const response = await entry.fetch(signOut());
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ success: true });
      expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
      expect(query).toHaveBeenCalledTimes(2);
      expect(log).toHaveBeenCalledOnce();
      expect(warn).not.toHaveBeenCalled();
      expect(JSON.parse(log.mock.calls[0]![0])).toMatchObject({
        code: "AUTH_RESPONSE_DEGRADED",
        status: 200,
        correlationId: response.headers.get("X-Correlation-ID"),
        error: {
          diagnostic: { dependency: "better-auth", operation: "identity.proxy" },
          cause: { type: "Error", code: "08006" },
        },
      });
      expect(JSON.stringify(log.mock.calls)).not.toContain("private");
      expect(log.mock.calls[0]).toHaveLength(1);
    },
  );

  it.each(["origin", "referer"])(
    "redacts the SDK's invalid %s message and reports the rejection only at the response boundary",
    async (header) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const { entry } = await application();
      const request = signOut();
      request.headers.delete("origin");
      request.headers.set(
        header,
        "https://private-secret.invalid/path?token=private-token",
      );
      const response = await entry.fetch(request);
      expect(response.status).toBe(403);
      expect((await response.json()).code).toBe("INVALID_ORIGIN");
      expect(log).not.toHaveBeenCalled();
      expect(warning).toHaveBeenCalledOnce();
      expect(JSON.parse(warning.mock.calls[0]![0])).toMatchObject({
        code: "AUTH_REQUEST_REJECTED",
        status: 403,
        correlationId: response.headers.get("X-Correlation-ID"),
        error: { diagnostic: { dependency: "better-auth" } },
      });
      expect(JSON.stringify(warning.mock.calls)).not.toContain("private");
    },
  );

  it("keeps the database cause when the SDK's API-error hook also reports its public wrapper", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(Pool.prototype, "connect").mockRejectedValue(databaseFailure());
    const { entry } = await application();
    const response = await entry.fetch(
      new Request(`${origin}/api/auth/get-session`, { headers: { cookie: cookie() } }),
    );
    expect(response.status).toBe(500);
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.parse(log.mock.calls[0]![0])).toMatchObject({
      code: "AUTH_REQUEST_REJECTED",
      status: 500,
      error: { cause: { type: "Error", code: "08006" } },
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("private");
  });

  it("leaves a session lookup without credentials unchanged and quiet", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { runtime } = await application();
    await expect(
      runtime.getSession({
        headers: new Headers(),
        query: { disableCookieCache: true },
      }),
    ).resolves.toBeNull();
    expect(log).not.toHaveBeenCalled();
  });

  it.each(["handler", "getSession"])(
    "retains a real %s exception after a message-only SDK warning",
    async (boundary) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const { runtime, entry } = await application();
      const context = await runtime.auth.$context;
      const cause = databaseFailure();
      const fail = async () => {
        context.logger.warn("private warning without an Error argument");
        throw cause;
      };
      if (boundary === "handler") {
        vi.spyOn(runtime.auth, "handler").mockImplementation(fail);
        await expect(entry.fetch(signOut())).rejects.toMatchObject({
          cause: { cause },
        });
        expect(log).toHaveBeenCalledOnce();
        expect(JSON.stringify(log.mock.calls)).not.toContain("private");
      } else {
        vi.spyOn(runtime.auth.api, "getSession").mockImplementation(fail);
        await expect(
          runtime.getSession({
            headers: new Headers(),
            query: { disableCookieCache: true },
          }),
        ).rejects.toMatchObject({ cause: { cause } });
        expect(log).not.toHaveBeenCalled();
      }
    },
  );

  it("retains the original database cause from real SDK getSession failure through the API", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(Pool.prototype, "connect").mockRejectedValue(databaseFailure());
    const { entry } = await application();
    const response = await entry.fetch(
      new Request(
        `${origin}/api/v1/projects/33333333-3333-4333-8333-333333333333/protected-feature`,
        {
          headers: { cookie: cookie(), "API-Version": "1" },
        },
      ),
    );
    const problem = await response.json();
    expect(response.status).toBe(500);
    expect(log).toHaveBeenCalledOnce();
    const record = JSON.parse(log.mock.calls[0]![0]);
    expect(record.correlationId).toBe(problem.correlationId);
    expect(record.error.cause.cause.cause).toMatchObject({
      type: "Error",
      code: "08006",
    });
    expect(JSON.stringify([problem, log.mock.calls])).not.toContain("private");
  });

  it("keeps overlapping SDK diagnostics attached to their own request", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let rejectConnection!: (error: Error) => void;
    const query = failSessionDelete(
      new Promise<never>((_, reject) => {
        rejectConnection = reject;
      }),
    );
    const { entry } = await application();
    const pending = entry.fetch(signOut());
    await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(2));
    const rejected = await entry.fetch(signOut("https://private-other.invalid"));
    expect(rejected.status).toBe(403);
    rejectConnection(databaseFailure());
    const completed = await pending;
    expect(completed.status).toBe(200);
    const failure = JSON.parse(errorLog.mock.calls[0]![0]);
    const denied = JSON.parse(warning.mock.calls[0]![0]);
    expect(failure.correlationId).toBe(completed.headers.get("X-Correlation-ID"));
    expect(failure.error.cause.code).toBe("08006");
    expect(denied.correlationId).toBe(rejected.headers.get("X-Correlation-ID"));
    expect(JSON.stringify(denied)).not.toContain("08006");
    expect(errorLog).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledOnce();
  });

  it("uses safe background diagnostics when SDK logging has no request owner", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { runtime } = await application();
    const context = await runtime.auth.$context;
    context.logger.error("private background URL", databaseFailure());
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.parse(log.mock.calls[0]![0])).toMatchObject({
      operation: "identity.background",
      code: "IDENTITY_BACKGROUND_FAILURE",
      error: { cause: { code: "08006" } },
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("private");
  });

  it("retains a successful SDK session result when its warning or the log sink fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {
      throw new Error("sink unavailable");
    });
    const { runtime } = await application();
    const context = await runtime.auth.$context;
    vi.spyOn(runtime.auth.api, "getSession").mockImplementation(async () => {
      context.logger.warn("private warning");
      return null;
    });
    await expect(
      runtime.getSession({
        headers: new Headers(),
        query: { disableCookieCache: true },
      }),
    ).resolves.toBeNull();
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.parse(log.mock.calls[0]![0])).toMatchObject({
      code: "IDENTITY_RESPONSE_DEGRADED",
      error: { diagnostic: { operation: "identity.session" } },
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("private");
  });

  it.each(["handler", "getSession"])(
    "preserves a %s failure when the SDK emits no diagnostic",
    async (boundary) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const { runtime, entry } = await application();
      const cause = databaseFailure();
      if (boundary === "handler") {
        vi.spyOn(runtime.auth, "handler").mockRejectedValue(cause);
        await expect(entry.fetch(signOut())).rejects.toBe(cause);
        expect(log).toHaveBeenCalledOnce();
      } else {
        vi.spyOn(runtime.auth.api, "getSession").mockRejectedValue(cause);
        await expect(
          runtime.getSession({
            headers: new Headers(),
            query: { disableCookieCache: true },
          }),
        ).rejects.toMatchObject({ cause });
        expect(log).not.toHaveBeenCalled();
      }
    },
  );

  it("does not attach detached SDK diagnostics to a completed request", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { runtime, entry } = await application();
    const context = await runtime.auth.$context;
    let release!: () => void;
    let logged: Promise<void> | undefined;
    vi.spyOn(runtime.auth, "handler").mockImplementation(async () => {
      logged = new Promise<void>((resolve) => {
        release = resolve;
      }).then(() =>
        context.logger.error("private detached diagnostic", databaseFailure()),
      );
      return Response.json({ success: true });
    });
    expect((await entry.fetch(signOut())).status).toBe(200);
    expect(log).not.toHaveBeenCalled();
    release();
    await logged;
    expect(log).toHaveBeenCalledOnce();
    const record = JSON.parse(log.mock.calls[0]![0]);
    expect(record.operation).toBe("identity.background");
    expect(record).not.toHaveProperty("correlationId");
    expect(JSON.stringify(record)).not.toContain("private");
  });
});
