import { betterAuth } from "better-auth";
import { Pool } from "pg";
import { IdentityConfigurationError } from "./identity-provider";

const TEST_PASSWORD_AUTH_FLAG = "email-password";

type RuntimeEnvironment = Record<string, string | undefined>;

let runtime: ReturnType<typeof createBetterAuthRuntime> | undefined;

export function getBetterAuthRuntime(): ReturnType<typeof createBetterAuthRuntime> {
  runtime ??= createBetterAuthRuntime(readBetterAuthConfig(process.env));
  return runtime;
}

export function createBetterAuthRuntime(
  config: ReturnType<typeof readBetterAuthConfig>,
) {
  const pool = new Pool({
    allowExitOnIdle: true,
    connectionString: config.databaseUrl,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
    max: 5,
  });
  pool.on("error", () => {
    console.error("An idle Better Auth PostgreSQL connection failed.");
  });

  const auth = betterAuth({
    advanced: {
      cookiePrefix: "generated-app",
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: config.secureCookies,
      },
      useSecureCookies: config.secureCookies,
    },
    appName: "Generated Application",
    basePath: "/api/auth",
    baseURL: config.baseUrl,
    database: pool,
    emailAndPassword: config.enableTestPasswordAuth
      ? {
          disableSignUp: false,
          enabled: true,
          requireEmailVerification: false,
        }
      : undefined,
    secret: config.secret,
    session: {
      cookieCache: { enabled: false },
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    socialProviders:
      config.github === undefined
        ? {}
        : {
            github: {
              clientId: config.github.clientId,
              clientSecret: config.github.clientSecret,
            },
          },
    telemetry: { enabled: false },
    trustedOrigins: [new URL(config.baseUrl).origin],
  });

  return {
    auth,
    close: () => pool.end(),
  };
}

export function readBetterAuthConfig(environment: RuntimeEnvironment) {
  const databaseUrl = required(environment, "DATABASE_URL");
  const baseUrl = required(environment, "BETTER_AUTH_URL");
  const secret = required(environment, "BETTER_AUTH_SECRET");
  if (secret.length < 32) {
    throw new IdentityConfigurationError(
      "BETTER_AUTH_SECRET must contain at least 32 characters.",
    );
  }

  const enableTestPasswordAuth =
    environment.NODE_ENV === "test" &&
    environment.APP_BUILDER_TEST_AUTH === TEST_PASSWORD_AUTH_FLAG;
  const clientId = optional(environment.GITHUB_APP_CLIENT_ID);
  const clientSecret = optional(environment.GITHUB_APP_CLIENT_SECRET);
  if ((clientId === undefined) !== (clientSecret === undefined)) {
    throw new IdentityConfigurationError(
      "GitHub identity requires both client ID and client secret.",
    );
  }
  if (!enableTestPasswordAuth && clientId === undefined) {
    throw new IdentityConfigurationError(
      "GitHub identity credentials are not configured.",
    );
  }

  let parsedBaseUrl: URL;
  try {
    parsedBaseUrl = new URL(baseUrl);
  } catch {
    throw new IdentityConfigurationError("BETTER_AUTH_URL must be an absolute URL.");
  }
  if (!["http:", "https:"].includes(parsedBaseUrl.protocol)) {
    throw new IdentityConfigurationError("BETTER_AUTH_URL must use HTTP or HTTPS.");
  }

  return {
    baseUrl: parsedBaseUrl.toString().replace(/\/$/, ""),
    databaseUrl,
    enableTestPasswordAuth,
    github:
      clientId === undefined || clientSecret === undefined
        ? undefined
        : { clientId, clientSecret },
    secret,
    secureCookies: parsedBaseUrl.protocol === "https:",
  };
}

function optional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized === "" ? undefined : normalized;
}

function required(environment: RuntimeEnvironment, name: string): string {
  const value = optional(environment[name]);
  if (value === undefined) {
    throw new IdentityConfigurationError(`${name} is required for identity.`);
  }
  return value;
}
