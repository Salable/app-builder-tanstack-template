import { describe, expect, it, vi } from "vitest";
import { BetterAuthIdentityProvider } from "./better-auth-identity-provider";

describe("BetterAuthIdentityProvider", () => {
  it("maps an authoritative database session into the application identity", async () => {
    const getSession = vi.fn(async () => ({
      session: { id: "session-1" },
      user: {
        email: "user@example.test",
        id: "user-1",
        name: "Example User",
      },
    }));
    const provider = new BetterAuthIdentityProvider(() => ({
      api: { getSession },
    }));
    const headers = new Headers({ cookie: "generated-app.session_token=opaque" });

    await expect(provider.authenticate(headers)).resolves.toEqual({
      email: "user@example.test",
      name: "Example User",
      sessionId: "session-1",
      userId: "user-1",
    });
    expect(getSession).toHaveBeenCalledWith({
      headers,
      query: { disableCookieCache: true },
    });
  });

  it("does not manufacture an identity for a missing or revoked session", async () => {
    const provider = new BetterAuthIdentityProvider(() => ({
      api: {
        getSession: async () => null,
      },
    }));

    await expect(provider.authenticate(new Headers())).resolves.toBeNull();
  });
});
