import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { publicApi } from "./api/app";
import { getAuthenticationRuntime } from "./identity/auth-runtime";
import { IdentityConfigurationError } from "./identity/identity-provider";

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
          return Response.json(
            {
              detail: "The identity service is not available.",
              status: 503,
              title: "Service Unavailable",
              type: "https://generated-app.salable.dev/problems/identity-unavailable",
            },
            {
              headers: { "Content-Type": "application/problem+json" },
              status: 503,
            },
          );
        }
        throw error;
      }
    }
    return handler.fetch(request);
  },
});
