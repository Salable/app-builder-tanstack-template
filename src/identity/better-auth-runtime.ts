import { betterAuth } from "better-auth";
import { AsyncLocalStorage } from "node:async_hooks";
import { Pool } from "pg";
import { readBetterAuthConfig } from "./better-auth-config";
import { DiagnosticError, reportError } from "../runtime/error-logger";

let runtime: ReturnType<typeof createBetterAuthRuntime> | undefined;
const responseFailures = new WeakMap<Response, DiagnosticError>();

export function getBetterAuthResponseFailure(
  response: Response,
): DiagnosticError | undefined {
  return responseFailures.get(response);
}

export function getBetterAuthRuntime(): ReturnType<typeof createBetterAuthRuntime> {
  runtime ??= createBetterAuthRuntime(readBetterAuthConfig(process.env));
  return runtime;
}

export function createBetterAuthRuntime(
  config: ReturnType<typeof readBetterAuthConfig>,
) {
  type DiagnosticScope = {
    operation: string;
    active: boolean;
    failure?: DiagnosticError;
  };
  const diagnostics = new AsyncLocalStorage<DiagnosticScope>();
  const capture = (level: "warn" | "error", ...values: unknown[]) => {
    const scope = diagnostics.getStore();
    const cause = values.find((value) => value instanceof Error);
    const failure = new DiagnosticError(
      {
        category: "provider",
        dependency: "better-auth",
        operation: scope?.active ? scope.operation : "identity.background",
        code: level === "warn" ? "IDENTITY_SDK_WARNING" : "IDENTITY_SDK_FAILED",
      },
      cause === undefined ? undefined : { cause },
    );
    if (scope?.active) {
      // Prefer an actual exception over a preceding message-only SDK warning.
      if (!scope.failure || (scope.failure.cause === undefined && cause !== undefined))
        scope.failure = failure;
      return;
    }
    reportError(failure, {
      source: "server",
      operation: "identity.background",
      code: "IDENTITY_BACKGROUND_FAILURE",
    });
  };
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
          dependency: "postgresql",
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
    logger: {
      level: "warn",
      log: (level, message, ...values: unknown[]) => {
        // SDK messages can contain Origin/Referer, SQL and credentials.
        if (level === "warn" || level === "error") capture(level, message, ...values);
      },
    },
    // Better Auth's default API-error hook can bypass its configured logger.
    onAPIError: { onError: (error) => capture("error", error) },
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
    handler(request: Request): Promise<Response> {
      const scope: DiagnosticScope = { operation: "identity.proxy", active: true };
      return diagnostics.run(scope, async () => {
        try {
          const response = await auth.handler(request);
          if (scope.failure) responseFailures.set(response, scope.failure);
          return response;
        } catch (cause) {
          if (scope.failure)
            throw new DiagnosticError(
              {
                category: "provider",
                dependency: "better-auth",
                operation: scope.operation,
                code: "IDENTITY_OPERATION_FAILED",
              },
              { cause: retainFailureCause(scope.failure, cause) },
            );
          throw cause;
        } finally {
          scope.active = false;
        }
      });
    },
    getSession(input: { headers: Headers; query: { disableCookieCache: boolean } }) {
      const scope: DiagnosticScope = {
        operation: "identity.session",
        active: true,
      };
      return diagnostics.run(scope, async () => {
        try {
          const session = await auth.api.getSession(input);
          if (scope.failure)
            reportError(scope.failure, {
              source: "server",
              operation: scope.operation,
              code: "IDENTITY_RESPONSE_DEGRADED",
            });
          return session;
        } catch (cause) {
          throw new DiagnosticError(
            {
              category: "provider",
              dependency: "better-auth",
              operation: scope.operation,
              code: "IDENTITY_OPERATION_FAILED",
            },
            { cause: retainFailureCause(scope.failure, cause) },
          );
        } finally {
          scope.active = false;
        }
      });
    },
    close: () => pool.end(),
  };
}

function retainFailureCause(
  failure: DiagnosticError | undefined,
  cause: unknown,
): unknown {
  if (!failure) return cause;
  if (failure.cause !== undefined) return failure;
  return new DiagnosticError(failure.diagnostic, { cause });
}
