import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { getIdentityProvider, IdentityConfigurationError } from "./identity-provider";
import { readBetterAuthConfig } from "./better-auth-config";

export function getIdentityProviderAvailability(
  environment: Record<string, string | undefined> = process.env,
) {
  try {
    const config = readBetterAuthConfig(environment);
    return { github: config.github !== undefined };
  } catch (error) {
    if (!(error instanceof IdentityConfigurationError)) throw error;
    return { github: false };
  }
}

export const getProtectedRouteIdentity = createServerFn({ method: "GET" }).handler(
  async () => {
    let identity;
    try {
      identity = await getIdentityProvider().authenticate(getRequestHeaders());
    } catch (error) {
      if (error instanceof IdentityConfigurationError) {
        return { status: "unavailable" as const };
      }
      throw error;
    }
    if (identity === null)
      return {
        providers: getIdentityProviderAvailability(),
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
