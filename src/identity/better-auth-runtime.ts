import { betterAuth } from "better-auth";
import { Pool } from "pg";
import { readBetterAuthConfig } from "./better-auth-config";
import { DiagnosticError, reportError } from "../runtime/error-logger";

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
  pool.on("error", (cause) => {
    reportError(
      new DiagnosticError(
        {
          category: "database",
          dependency: "postgres",
          operation: "identity.idle_connection",
        },
        { cause },
      ),
      {
        source: "server",
        operation: "identity.idle_connection",
        code: "DATABASE_CONNECTION_FAILED",
      },
    );
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
    emailAndPassword: {
      disableSignUp: false,
      enabled: true,
      requireEmailVerification: false,
    },
    secret: config.secret,
    session: {
      cookieCache: { enabled: false },
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    telemetry: { enabled: false },
    trustedOrigins: [new URL(config.baseUrl).origin],
  });

  return {
    auth,
    close: () => pool.end(),
  };
}
