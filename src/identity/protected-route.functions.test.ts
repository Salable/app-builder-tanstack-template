import { describe, expect, it } from "vitest";
import { getIdentityProviderAvailability } from "./protected-route.functions";

const completeIdentityEnvironment = {
  BETTER_AUTH_SECRET: "s".repeat(32),
  BETTER_AUTH_URL: "https://app.example.test",
  DATABASE_URL: "postgres://runtime@example.test/app",
  GITHUB_APP_CLIENT_ID: "client-id",
  GITHUB_APP_CLIENT_SECRET: "client-secret",
};

describe("protected route identity availability", () => {
  it("advertises GitHub only when the complete identity runtime is valid", () => {
    expect(getIdentityProviderAvailability(completeIdentityEnvironment)).toEqual({
      github: true,
    });
  });

  it.each(["DATABASE_URL", "BETTER_AUTH_URL", "BETTER_AUTH_SECRET"])(
    "does not advertise GitHub when %s is missing",
    (missing) => {
      expect(
        getIdentityProviderAvailability({
          ...completeIdentityEnvironment,
          [missing]: undefined,
        }),
      ).toEqual({ github: false });
    },
  );
});
