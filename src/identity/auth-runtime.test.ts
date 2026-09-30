import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

function configureNeon() {
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("VERCEL_URL", "changing-preview.vercel.app");
  vi.stubEnv("NEON_AUTH_BASE_URL", "https://branch.auth.neon.tech/auth");
  vi.stubEnv("VITE_NEON_AUTH_URL", "https://branch.auth.neon.tech/auth");
  vi.stubEnv(
    "NEON_AUTH_COOKIE_SECRET",
    "a-test-cookie-secret-with-at-least-32-characters",
  );
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("BETTER_AUTH_SECRET", "");
}

describe("authentication runtime selection", () => {
  it("selects the managed runtime without local database credentials and reuses its configuration", async () => {
    configureNeon();
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json(null));
    vi.stubGlobal("fetch", transport);
    const { getAuthenticationRuntime } = await import("./auth-runtime");
    const runtime = getAuthenticationRuntime();
    expect(getAuthenticationRuntime()).toBe(runtime);
    await expect(runtime.identity.authenticate(new Headers())).resolves.toBeNull();
    expect(transport).not.toHaveBeenCalled();
    const response = await runtime.handler(
      new Request("https://changing-preview.vercel.app/api/auth/get-session"),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
    expect(String(transport.mock.calls[0]?.[0])).toContain(
      "branch.auth.neon.tech/auth/get-session",
    );
  });

  it("rejects incomplete managed configuration and permits correction before initialization", async () => {
    configureNeon();
    vi.stubEnv("VITE_NEON_AUTH_URL", "");
    const transport = vi.fn();
    vi.stubGlobal("fetch", transport);
    const { getAuthenticationRuntime } = await import("./auth-runtime");
    expect(() => getAuthenticationRuntime()).toThrow(
      "Both Neon Auth URLs must be configured.",
    );
    expect(transport).not.toHaveBeenCalled();
    vi.stubEnv("VITE_NEON_AUTH_URL", "https://branch.auth.neon.tech/auth");
    await expect(
      getAuthenticationRuntime().identity.authenticate(new Headers()),
    ).resolves.toBeNull();
    expect(transport).not.toHaveBeenCalled();
  });
});
