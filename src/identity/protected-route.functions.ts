import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { getIdentityProvider } from "./identity-provider";

export const getProtectedRouteIdentity = createServerFn({ method: "GET" }).handler(
  async () => {
    const identity = await getIdentityProvider().authenticate(getRequestHeaders());
    if (identity === null) return { status: "unauthenticated" as const };
    return {
      identity: {
        email: identity.email,
        name: identity.name,
      },
      status: "authenticated" as const,
    };
  },
);
