import {
  createAuthServer,
  extractNeonAuthCookies,
  handleAuthProxyRequest,
  NEON_AUTH_SESSION_COOKIE_NAME,
  NEON_AUTH_NETWORK_ERROR_CODES,
  parseSetCookies,
  serializeSetCookie,
} from "@neondatabase/auth/server";
import {
  AuthenticatedIdentitySchema,
  IdentityProviderUnavailableError,
  type IdentityProvider,
} from "./identity-provider";
import type { NeonAuthRuntimeConfig } from "./neon-auth-config";
import { DiagnosticError, reportError } from "../runtime/error-logger";

const responseFailures = new WeakMap<Response, DiagnosticError>();

/** The protocol response stays unchanged; its owner logs the safe SDK failure once. */
export function getNeonAuthResponseFailure(
  response: Response,
): DiagnosticError | undefined {
  return responseFailures.get(response);
}

export function createNeonAuthRuntime(config: NeonAuthRuntimeConfig) {
  const identity: IdentityProvider = {
    async authenticate(headers) {
      const cookies = extractNeonAuthCookies(headers);
      if (
        !cookies
          .split("; ")
          .some((cookie) => cookie.startsWith(`${NEON_AUTH_SESSION_COOKIE_NAME}=`))
      )
        return null;
      // The server toolkit holds no browser client, broadcast listener, or user
      // session cache. Each call binds only this request's allowed cookies.
      const diagnostics = captureDiagnostics("identity.authenticate");
      const auth = createAuthServer({
        ...config,
        log: diagnostics.log,
        context: () => ({
          getCookies: () => cookies,
          getHeader: (name) => headers.get(name),
          getOrigin: () => config.applicationOrigin,
          getFramework: () => "tanstack-start",
          // Session reads never mint application identity or mutate its response.
          // Browser session refresh and cookie updates use the proxy below.
          setCookie: () => undefined,
        }),
      });
      const result = await auth
        .getSession({ query: { disableCookieCache: "true" } })
        .catch((cause: unknown) => {
          throw new IdentityProviderUnavailableError(
            { cause },
            undefined,
            "IDENTITY_TRANSPORT_FAILED",
          );
        });
      if (result.error) {
        throw new IdentityProviderUnavailableError(
          { cause: diagnostics.failure() },
          result.error.status,
          "IDENTITY_REQUEST_REJECTED",
        );
      }
      if (result.data === null) {
        reportIdentityDiagnostic(diagnostics.failure());
        return null;
      }
      if (!result.data?.session || !result.data.user) {
        throw new IdentityProviderUnavailableError(
          undefined,
          undefined,
          "IDENTITY_RESPONSE_INVALID",
        );
      }
      const identity = AuthenticatedIdentitySchema.safeParse({
        email: result.data.user.email,
        name: result.data.user.name,
        sessionId: result.data.session.id,
        userId: result.data.user.id,
      });
      if (!identity.success) {
        throw new IdentityProviderUnavailableError(
          { cause: identity.error },
          undefined,
          "IDENTITY_RESPONSE_INVALID",
        );
      }
      reportIdentityDiagnostic(diagnostics.failure());
      return identity.data;
    },
  };

  async function handler(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.slice("/api/auth/".length);
    if (!path || !["GET", "POST"].includes(request.method)) {
      return Response.json(
        { message: "Authentication route not found." },
        { status: 404 },
      );
    }
    if (
      request.method === "POST" &&
      request.headers.get("origin") !== config.applicationOrigin
    ) {
      return Response.json({ message: "Invalid request origin." }, { status: 403 });
    }
    const headers = new Headers(request.headers);
    headers.set("origin", config.applicationOrigin);
    // Session revocation is authoritative for browser reads as well as SSR/API.
    if (path === "get-session") url.searchParams.set("disableCookieCache", "true");
    const proxied = new Request(url, {
      method: request.method,
      headers,
      ...(request.body === null ? {} : { body: await request.text() }),
    });
    const diagnostics = captureDiagnostics("identity.proxy");
    const response = await handleAuthProxyRequest({
      ...config,
      request: proxied,
      path,
      log: diagnostics.log,
    });
    const failure = diagnostics.failure();
    if (failure) responseFailures.set(response, failure);
    const cookies = response.headers.getSetCookie();
    response.headers.delete("set-cookie");
    for (const header of cookies) {
      for (const cookie of parseSetCookies(header)) {
        response.headers.append(
          "set-cookie",
          serializeSetCookie({ ...cookie, domain: undefined, path: "/" }),
        );
      }
    }
    // Fetch decodes upstream bodies. The pinned toolkit retains their original
    // encoding header and drops cache directives; normalize at our HTTP boundary.
    response.headers.delete("content-encoding");
    response.headers.delete("content-length");
    response.headers.set("cache-control", "private, no-store");
    response.headers.set("pragma", "no-cache");
    return response;
  }
  return { identity, handler };
}

function captureDiagnostics(operation: string) {
  let failure: DiagnosticError | undefined;
  const capture = (_message: string, metadata?: unknown) => {
    // SDK metadata also contains private URLs/details. Select only documented
    // status and network-code fields, never message text or response bodies.
    const fields =
      metadata !== null && typeof metadata === "object"
        ? (metadata as Record<string, unknown>)
        : {};
    if (typeof fields.status === "number" && fields.status < 400) return;
    const networkCode =
      typeof fields.code === "string" &&
      NEON_AUTH_NETWORK_ERROR_CODES.some((code) => code === fields.code)
        ? fields.code
        : undefined;
    failure = new DiagnosticError({
      category: "provider",
      dependency: "neon-auth",
      operation,
      code:
        networkCode ??
        (typeof fields.status === "number"
          ? "IDENTITY_REQUEST_REJECTED"
          : "IDENTITY_PROXY_FAILED"),
      ...(typeof fields.status === "number" ? { httpStatus: fields.status } : {}),
    });
  };
  return {
    failure: () => failure,
    log: { error: capture, warn: capture, info: capture, debug: () => undefined },
  };
}

function reportIdentityDiagnostic(failure: DiagnosticError | undefined): void {
  if (!failure) return;
  // SDK cookie refresh can fail while its authoritative identity read succeeds.
  reportError(failure, {
    source: "server",
    operation: "identity.authenticate",
    code: "IDENTITY_RESPONSE_DEGRADED",
  });
}
