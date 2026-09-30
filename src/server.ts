import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { publicApi } from "./api/app";
import { getAuthenticationRuntime } from "./identity/auth-runtime";
import { IdentityConfigurationError } from "./identity/identity-provider";
import { canonicalApplicationRedirect } from "./runtime/application-origin";
import { createProblemDetail, reportProblem } from "./api/problem-detail";

export default createServerEntry({
  async fetch(request) {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/api/v1" || pathname.startsWith("/api/v1/")) {
      return publicApi.fetch(request);
    }
    if (pathname === "/api/auth" || pathname.startsWith("/api/auth/")) {
      try {
        return await getAuthenticationRuntime().handler(request);
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
          reportProblem(problem);
          return response;
        }
        throw error;
      }
    }
    return canonicalApplicationRedirect(request) ?? handler.fetch(request);
  },
});
