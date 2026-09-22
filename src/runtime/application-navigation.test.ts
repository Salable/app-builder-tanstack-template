import { describe, expect, it } from "vitest";
import { canonicalApplicationRedirect } from "./application-origin";

const environment = {
  VERCEL: "1",
  VERCEL_ENV: "preview",
  VERCEL_URL: "kanbanado-build-a-team.vercel.app",
  VERCEL_BRANCH_URL: "kanbanado-git-develop-team.vercel.app",
  VERCEL_PROJECT_PRODUCTION_URL: "kanbanado.example.com",
};
const documentRequest = (url: string) =>
  new Request(url, { headers: { accept: "text/html" } });

describe("canonical application navigation", () => {
  it.each(["kanbanado-build-a-team.vercel.app", "kanbanado-build-b-team.vercel.app"])(
    "uses the current deployment %s before showing an account form",
    (deployment) => {
      const input = { ...environment, VERCEL_URL: deployment };
      const response = canonicalApplicationRedirect(
        documentRequest(
          `https://${input.VERCEL_BRANCH_URL}/account/sign-up?next=%2Fprotected`,
        ),
        input,
      );
      expect(response?.status).toBe(307);
      expect(response?.headers.get("location")).toBe(
        `https://${deployment}/account/sign-up?next=%2Fprotected`,
      );
      expect(response?.headers.get("cache-control")).toBe("private, no-store");
      expect(response?.headers.has("set-cookie")).toBe(false);
      expect(
        canonicalApplicationRedirect(
          documentRequest(response!.headers.get("location")!),
          input,
        ),
      ).toBeNull();
    },
  );

  it("uses the Production domain only for Production and never a request header", () => {
    const request = new Request("https://build-alias.vercel.app/protected", {
      headers: {
        accept: "text/html",
        host: "attacker.example",
        "x-forwarded-host": "attacker.example",
      },
    });
    expect(
      canonicalApplicationRedirect(request, {
        ...environment,
        VERCEL_ENV: "production",
      })?.headers.get("location"),
    ).toBe("https://kanbanado.example.com/protected");
    expect(() =>
      canonicalApplicationRedirect(request, { ...environment, VERCEL_URL: undefined }),
    ).toThrow(/VERCEL_URL is required/);
  });

  it("preserves paths without allowing them to replace the trusted origin", () => {
    const response = canonicalApplicationRedirect(
      documentRequest("https://alias.vercel.app//untrusted.example/sign-up"),
      environment,
    );
    expect(new URL(response!.headers.get("location")!).origin).toBe(
      `https://${environment.VERCEL_URL}`,
    );
  });

  it("does not loop when HTTPS terminates before the Node adapter", () => {
    const request = new Request(`http://${environment.VERCEL_URL}/account/sign-up`, {
      headers: {
        accept: "text/html",
        "x-forwarded-proto": "https",
        "x-forwarded-host": "untrusted.example",
      },
    });
    expect(canonicalApplicationRedirect(request, environment)).toBeNull();
  });

  it("never redirects credentials, data requests, or local development", () => {
    expect(
      canonicalApplicationRedirect(
        new Request("https://alias.vercel.app/api/neon-auth/sign-up/email", {
          method: "POST",
          headers: { accept: "text/html" },
          body: "private",
        }),
        environment,
      ),
    ).toBeNull();
    expect(
      canonicalApplicationRedirect(
        new Request("https://alias.vercel.app/data", {
          headers: { accept: "application/json" },
        }),
        environment,
      ),
    ).toBeNull();
    expect(
      canonicalApplicationRedirect(
        documentRequest("http://127.0.0.1:3000/account/sign-up"),
        { NODE_ENV: "test" },
      ),
    ).toBeNull();
  });
});
