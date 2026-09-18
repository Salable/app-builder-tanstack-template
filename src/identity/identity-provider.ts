import { z } from "zod";

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

export class IdentityConfigurationError extends Error {
  constructor(message = "Generated application identity is not configured.") {
    super(message);
    this.name = "IdentityConfigurationError";
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
