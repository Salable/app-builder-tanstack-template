import { describe, expect, it } from "vitest";
import { readBetterAuthConfig } from "./better-auth-config";

const baseEnvironment = {
  BETTER_AUTH_SECRET: "identity-test-secret-with-at-least-32-characters",
  DATABASE_URL: "postgresql://example.invalid/generated_app",
  HOST: "127.0.0.1",
  NODE_ENV: "test",
  PORT: "4312",
};

describe("Better Auth runtime configuration", () => {
  it("accepts the self-hosted production identity boundary without a sign-in provider", () => {
    expect(
      readBetterAuthConfig({
        ...baseEnvironment,
        NODE_ENV: "production",
        VERCEL: "1",
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "app.example.test",
      }),
    ).toMatchObject({
      baseUrl: "https://app.example.test",
      enableTestPasswordAuth: false,
      secureCookies: true,
    });
  });

  it("permits deterministic password auth only in an explicit test process", () => {
    expect(
      readBetterAuthConfig({
        ...baseEnvironment,
        APP_BUILDER_TEST_AUTH: "email-password",
        NODE_ENV: "test",
      }),
    ).toMatchObject({
      baseUrl: "http://127.0.0.1:4312",
      enableTestPasswordAuth: true,
    });
  });

  it("does not enable the test sign-in method in production", () => {
    expect(
      readBetterAuthConfig({
        ...baseEnvironment,
        APP_BUILDER_TEST_AUTH: "email-password",
        NODE_ENV: "production",
        VERCEL: "1",
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "app.example.test",
      }),
    ).toMatchObject({ enableTestPasswordAuth: false });
  });
});
