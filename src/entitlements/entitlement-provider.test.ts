import { describe, expect, it } from "vitest";
import {
  createEntitlementProvider,
  EntitlementProviderUnavailableError,
  getEntitlementProvider,
  PROTECTED_INSIGHTS_CAPABILITY,
  setEntitlementProviderForTesting,
} from "./entitlement-provider";

const organizationId = "596875ff-7396-46f2-8968-7d34b8871872";
const check = {
  capability: PROTECTED_INSIGHTS_CAPABILITY,
  organizationId,
  userId: "owner",
} as const;

describe("authoritative entitlement boundary", () => {
  it.each(["production", "development", undefined])(
    "never grants from environment allowlists in %s",
    async (environment) => {
      const provider = createEntitlementProvider({
        NODE_ENV: environment,
        APP_BUILDER_ENTITLED_ORGANIZATION_IDS: organizationId,
        APP_BUILDER_TEST_ENTITLED_ORGANIZATION_IDS: organizationId,
      });
      await expect(provider.hasEntitlement(check)).rejects.toBeInstanceOf(
        EntitlementProviderUnavailableError,
      );
    },
  );

  it("reports unavailable rather than inventing a denial when no provider is configured", async () => {
    await expect(
      createEntitlementProvider({ NODE_ENV: "production" }).hasEntitlement(check),
    ).rejects.toThrow(EntitlementProviderUnavailableError);
  });

  it("uses only the test-scoped allowlist in the test environment", async () => {
    const provider = createEntitlementProvider({
      NODE_ENV: "test",
      APP_BUILDER_TEST_ENTITLED_ORGANIZATION_IDS: ` , ${organizationId}, `,
    });
    await expect(provider.hasEntitlement(check)).resolves.toBe(true);
    await expect(
      provider.hasEntitlement({ ...check, organizationId: "another-organization" }),
    ).resolves.toBe(false);
    await expect(
      createEntitlementProvider({
        NODE_ENV: "test",
        APP_BUILDER_ENTITLED_ORGANIZATION_IDS: organizationId,
      }).hasEntitlement(check),
    ).resolves.toBe(false);
  });

  it("reuses the selected provider and supports explicit local-test replacement", async () => {
    setEntitlementProviderForTesting(undefined);
    const provider = getEntitlementProvider();
    expect(getEntitlementProvider()).toBe(provider);
    const replacement = createEntitlementProvider({
      NODE_ENV: "test",
      APP_BUILDER_TEST_ENTITLED_ORGANIZATION_IDS: organizationId,
    });
    setEntitlementProviderForTesting(replacement);
    expect(getEntitlementProvider()).toBe(replacement);
    await expect(getEntitlementProvider().hasEntitlement(check)).resolves.toBe(true);
    setEntitlementProviderForTesting(undefined);
  });
});
