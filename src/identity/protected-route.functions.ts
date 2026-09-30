import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import {
  getIdentityProvider,
  IdentityConfigurationError,
  IdentityProviderUnavailableError,
} from "./identity-provider";
import { createProblemDetail, reportProblem } from "../api/problem-detail";

export const getProtectedRouteIdentity = createServerFn({ method: "GET" }).handler(
  async () => {
    let identity;
    try {
      identity = await getIdentityProvider().authenticate(getRequestHeaders());
    } catch (error) {
      if (
        error instanceof IdentityConfigurationError ||
        error instanceof IdentityProviderUnavailableError
      ) {
        const configurationMissing = error instanceof IdentityConfigurationError;
        const problem = createProblemDetail({
          status: 503,
          code: configurationMissing
            ? "IDENTITY_CONFIGURATION_MISSING"
            : "IDENTITY_PROVIDER_UNAVAILABLE",
          detail: configurationMissing
            ? "Sign-in is not configured for this deployment."
            : "The sign-in service is temporarily unavailable. Please try again.",
          correlationId: `corr_${crypto.randomUUID()}`,
          instance: "/protected",
        });
        const result = {
          status: "unavailable" as const,
          detail: problem.detail,
          correlationId: problem.correlationId,
        };
        reportProblem(problem);
        return result;
      }
      throw error;
    }
    if (identity === null)
      return {
        status: "unauthenticated" as const,
      };
    return {
      identity: {
        email: identity.email,
        name: identity.name,
      },
      status: "authenticated" as const,
    };
  },
);
