import { BetterAuthIdentityProvider } from "./better-auth-identity-provider";
import { getBetterAuthRuntime } from "./better-auth-runtime";
import { readNeonAuthConfig } from "./neon-auth-config";
import { createNeonAuthRuntime } from "./neon-auth-runtime";

let runtime: ReturnType<typeof createAuthenticationRuntime> | undefined;

export function getAuthenticationRuntime() {
  runtime ??= createAuthenticationRuntime();
  return runtime;
}

function createAuthenticationRuntime() {
  const neon = readNeonAuthConfig(process.env);
  if (neon !== null) return createNeonAuthRuntime(neon);
  const { auth } = getBetterAuthRuntime();
  return {
    identity: new BetterAuthIdentityProvider(() => auth),
    handler: (request: Request) => auth.handler(request),
  };
}
