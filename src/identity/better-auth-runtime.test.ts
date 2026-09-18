import { describe, expect, it } from "vitest";
import { readBetterAuthConfig } from "./better-auth-config";
import { createBetterAuthRuntime } from "./better-auth-runtime";

const baseEnvironment = {
  BETTER_AUTH_SECRET: "identity-test-secret-with-at-least-32-characters",
  DATABASE_URL: "postgresql://example.invalid/generated_app",
  HOST: "127.0.0.1",
  PORT: "4312",
  NODE_ENV: "test",
};

describe("Better Auth runtime configuration", () => {
  it("provides standard email/password accounts in production without social providers", async () => {
    const config = readBetterAuthConfig({
      ...baseEnvironment,
      NODE_ENV: "production",
      VERCEL: "1",
      VERCEL_ENV: "production",
      VERCEL_PROJECT_PRODUCTION_URL: "app.example.test",
    });
    expect(config).toMatchObject({
      baseUrl: "https://app.example.test",
      secureCookies: true,
    });
    const runtime = createBetterAuthRuntime(config);
    try {
      expect(runtime.auth.options.emailAndPassword).toEqual({
        enabled: true,
        disableSignUp: false,
        requireEmailVerification: false,
      });
      expect(runtime.auth.options).not.toHaveProperty("socialProviders");
      expect(runtime.auth.options.session?.cookieCache?.enabled).toBe(false);
    } finally {
      await runtime.close();
    }
  });
  it("uses the shared local origin and rejects missing identity credentials", () => {
    expect(readBetterAuthConfig(baseEnvironment)).toMatchObject({
      baseUrl: "http://127.0.0.1:4312",
      secureCookies: false,
    });
    expect(() =>
      readBetterAuthConfig({ ...baseEnvironment, BETTER_AUTH_SECRET: undefined }),
    ).toThrow("BETTER_AUTH_SECRET");
  });
});
