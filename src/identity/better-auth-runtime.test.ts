import { describe, expect, it } from "vitest";
import { IdentityConfigurationError } from "./identity-provider";
import { readBetterAuthConfig } from "./better-auth-config";

const baseEnvironment = {
  BETTER_AUTH_SECRET: "identity-test-secret-with-at-least-32-characters",
  BETTER_AUTH_URL: "http://127.0.0.1:4312",
  DATABASE_URL: "postgresql://example.invalid/generated_app",
};

describe("Better Auth runtime configuration", () => {
  it("accepts the production GitHub identity boundary", () => {
    expect(
      readBetterAuthConfig({
        ...baseEnvironment,
        GITHUB_APP_CLIENT_ID: "github-client",
        GITHUB_APP_CLIENT_SECRET: "github-secret",
        NODE_ENV: "production",
      }),
    ).toMatchObject({
      enableTestPasswordAuth: false,
      github: {
        clientId: "github-client",
        clientSecret: "github-secret",
      },
      secureCookies: false,
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
      enableTestPasswordAuth: true,
      github: undefined,
    });
  });

  it("rejects partial GitHub configuration and permits credential-free production", () => {
    expect(() =>
      readBetterAuthConfig({
        ...baseEnvironment,
        GITHUB_APP_CLIENT_ID: "github-client",
        NODE_ENV: "production",
      }),
    ).toThrow(IdentityConfigurationError);
    expect(
      readBetterAuthConfig({
        ...baseEnvironment,
        APP_BUILDER_TEST_AUTH: "email-password",
        NODE_ENV: "production",
      }),
    ).toMatchObject({ enableTestPasswordAuth: false, github: undefined });
  });
});
