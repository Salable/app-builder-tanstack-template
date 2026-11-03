import {
  AuthenticatedIdentitySchema,
  type IdentityProvider,
} from "./identity-provider";
import { DiagnosticError } from "../runtime/error-logger";

type SessionReader = {
  api: {
    getSession(input: {
      headers: Headers;
      query: { disableCookieCache: boolean };
    }): Promise<{
      session: { id: string };
      user: { email: string; id: string; name: string };
    } | null>;
  };
};

export class BetterAuthIdentityProvider implements IdentityProvider {
  constructor(private readonly getAuth: () => SessionReader) {}

  async authenticate(headers: Headers) {
    const result = await this.getAuth()
      .api.getSession({
        headers,
        query: { disableCookieCache: true },
      })
      .catch((cause: unknown) => {
        throw new DiagnosticError(
          {
            category: "provider",
            dependency: "better-auth",
            operation: "identity.authenticate",
            code: "IDENTITY_REQUEST_FAILED",
          },
          { cause },
        );
      });
    if (result === null) return null;

    return AuthenticatedIdentitySchema.parse({
      email: result.user.email,
      name: result.user.name,
      sessionId: result.session.id,
      userId: result.user.id,
    });
  }
}
