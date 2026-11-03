import { z } from "zod";
import { DiagnosticError } from "../runtime/error-logger";

export const AuthenticatedIdentitySchema = z
  .object({
    email: z.email(),
    name: z.string().min(1),
    sessionId: z.string().min(1),
    userId: z.string().min(1),
  })
  .strict();

export type AuthenticatedIdentity = z.infer<typeof AuthenticatedIdentitySchema>;

export interface IdentityProvider {
  authenticate(headers: Headers): Promise<AuthenticatedIdentity | null>;
}

export class IdentityConfigurationError extends DiagnosticError {
  constructor(
    message = "Generated application identity is not configured.",
    options?: ErrorOptions,
  ) {
    super(
      {
        category: "configuration",
        operation: "identity.configure",
        code: "IDENTITY_CONFIGURATION_MISSING",
      },
      options,
    );
    this.message = message;
    this.name = "IdentityConfigurationError";
  }
}

export class IdentityProviderUnavailableError extends DiagnosticError {
  constructor(
    options?: ErrorOptions,
    httpStatus?: number,
    code = "IDENTITY_PROVIDER_UNAVAILABLE",
  ) {
    super(
      {
        category: "provider",
        dependency: "identity",
        operation: "identity.session",
        httpStatus,
        code,
      },
      options,
    );
    this.message = "The identity provider could not complete the request.";
    this.name = "IdentityProviderUnavailableError";
  }
}

let identityProvider: IdentityProvider | undefined;

export function getIdentityProvider(): IdentityProvider {
  identityProvider ??= createIdentityProvider();
  return identityProvider;
}

export function setIdentityProviderForTesting(
  provider: IdentityProvider | undefined,
): void {
  identityProvider = provider;
}

function createIdentityProvider(): IdentityProvider {
  return {
    async authenticate(headers) {
      if (!headers.has("cookie")) return null;
      const { getAuthenticationRuntime } = await import("./auth-runtime");
      return getAuthenticationRuntime().identity.authenticate(headers);
    },
  };
}
