import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { publicApi } from "./api/app";
import { getAuthenticationRuntime } from "./identity/auth-runtime";
import { IdentityConfigurationError } from "./identity/identity-provider";
import { canonicalApplicationRedirect } from "./runtime/application-origin";
import { createProblemDetail, reportProblem } from "./api/problem-detail";
import { reportError } from "./runtime/error-logger";
import { getNeonAuthResponseFailure } from "./identity/neon-auth-runtime";

export default createServerEntry({
  async fetch(request) {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/api/v1" || pathname.startsWith("/api/v1/")) {
      return publicApi.fetch(request);
    }
    if (pathname === "/api/auth" || pathname.startsWith("/api/auth/")) {
      try {
        const response = await getAuthenticationRuntime().handler(request);
        const failure = getNeonAuthResponseFailure(response);
        if (response.status >= 400 || failure) {
          const correlationId = `corr_${crypto.randomUUID()}`;
          try {
            response.headers.set("X-Correlation-ID", correlationId);
          } catch {
            // A read-only response remains valid even if diagnostics cannot annotate it.
          }
          reportError(failure, {
            source: "server",
            operation: "identity.request",
            code: "AUTH_REQUEST_REJECTED",
            status: response.status,
            method: request.method,
            path: "/api/auth/*",
            correlationId,
          });
        }
        return response;
      } catch (error) {
        if (error instanceof IdentityConfigurationError) {
          const problem = createProblemDetail({
            detail:
              "The application's sign-in configuration is incomplete. Contact the application owner with this reference.",
            status: 503,
            code: "IDENTITY_CONFIGURATION_MISSING",
            correlationId: `corr_${crypto.randomUUID()}`,
            instance: pathname,
          });
          const response = Response.json(problem, {
            headers: {
              "Content-Type": "application/problem+json",
              "X-Correlation-ID": problem.correlationId,
            },
            status: 503,
          });
          reportProblem(problem, error, {
            method: request.method,
            path: "/api/auth/*",
          });
          return response;
        }
        reportError(error, {
          source: "server",
          operation: "identity.request",
          code: "AUTH_REQUEST_FAILED",
          method: request.method,
          path: "/api/auth/*",
        });
        throw error;
      }
    }
    try {
      return canonicalApplicationRedirect(request) ?? (await handler.fetch(request));
    } catch (error) {
      reportError(error, {
        source: "server",
        operation: "http.render",
        code: "SERVER_RENDER_FAILED",
        method: request.method,
      });
      throw error;
    }
  },
});
