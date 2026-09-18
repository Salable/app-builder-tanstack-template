import { afterEach, describe, expect, it, vi } from "vitest";
import { getGlobalBroadcastChannel } from "better-auth/client";
import { createNeonAuthRuntime } from "./neon-auth-runtime";
const config = {
  applicationOrigin: "https://app.example.test",
  baseUrl: "https://branch.auth.neon.tech/neondb/auth",
  cookieSecret: "cookie-secret-with-at-least-32-characters",
};
const session = (id: string) => ({
  session: {
    id: `session-${id}`,
    userId: id,
    token: `token-${id}`,
    expiresAt: "2099-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  user: {
    id,
    email: `${id}@example.test`,
    name: id,
    emailVerified: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
});
afterEach(() => vi.unstubAllGlobals());
describe("managed Neon authentication runtime", () => {
  it("isolates concurrent server identities, reads current sessions, and never creates broadcast subscribers", async () => {
    const channel = getGlobalBroadcastChannel();
    const subscribe = vi.spyOn(channel, "subscribe");
    const requests: { url: string; cookie: string }[] = [];
    let revoked = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, options: RequestInit) => {
        const cookie = new Headers(options.headers).get("cookie")!;
        requests.push({ url, cookie });
        expect(new Headers(options.headers).get("origin")).toBe(
          config.applicationOrigin,
        );
        return Response.json(
          revoked ? null : session(cookie.endsWith("alice") ? "alice" : "bob"),
        );
      }),
    );
    const runtime = createNeonAuthRuntime(config);
    const headers = (id: string) =>
      new Headers({
        cookie: `analytics=private; __Secure-neon-auth.session_token=${id}; app-secret=private`,
      });
    try {
      const results = await Promise.all(
        Array.from({ length: 40 }, (_, index) =>
          runtime.identity.authenticate(headers(index % 2 ? "bob" : "alice")),
        ),
      );
      expect(results.map((result) => result?.userId)).toEqual(
        Array.from({ length: 40 }, (_, index) => (index % 2 ? "bob" : "alice")),
      );
      expect(requests).toHaveLength(40);
      expect(
        requests.every(
          ({ url, cookie }) =>
            url.endsWith("/get-session?disableCookieCache=true") &&
            /^__Secure-neon-auth\.session_token=(alice|bob)$/.test(cookie),
        ),
      ).toBe(true);
      expect(subscribe).not.toHaveBeenCalled();
      revoked = true;
      expect(await runtime.identity.authenticate(headers("alice"))).toBeNull();
      expect(requests).toHaveLength(41);
      expect(
        await runtime.identity.authenticate(
          new Headers({ cookie: "analytics=private" }),
        ),
      ).toBeNull();
      expect(requests).toHaveLength(41);
    } finally {
      subscribe.mockRestore();
    }
  });
  it("preserves proxy JSON semantics, prevents caching, and verifies mutation origins", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify(session("alice")), {
          headers: {
            "content-type": "application/json",
            "content-encoding": "gzip",
            "cache-control": "public, max-age=3600",
          },
        }),
    );
    vi.stubGlobal("fetch", fetch);
    const runtime = createNeonAuthRuntime(config);
    const response = await runtime.handler(
      new Request(`${config.applicationOrigin}/api/auth/get-session`, {
        headers: {
          cookie: "__Secure-neon-auth.session_token=alice; unrelated=private",
        },
      }),
    );
    expect(await response.json()).toEqual(session("alice"));
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(fetch).toHaveBeenCalledOnce();
    const rejected = await runtime.handler(
      new Request(`${config.applicationOrigin}/api/auth/sign-out`, {
        method: "POST",
        headers: { origin: "https://unrelated.example.test" },
        body: "{}",
      }),
    );
    expect(rejected.status).toBe(403);
    expect(fetch).toHaveBeenCalledOnce();
  });
});
