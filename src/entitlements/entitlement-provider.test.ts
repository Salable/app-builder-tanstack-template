import { describe, expect, it } from "vitest";
import {
  createEntitlementProvider,
  PROTECTED_INSIGHTS_CAPABILITY,
} from "./entitlement-provider";

const organizationId = "596875ff-7396-46f2-8968-7d34b8871872";
const check = {
  capability: PROTECTED_INSIGHTS_CAPABILITY,
  organizationId,
  userId: "owner",
} as const;

describe("production entitlement configuration", () => {
  it("allows configured organizations in production", async () => {
    const provider = createEntitlementProvider({
      NODE_ENV: "production",
      APP_BUILDER_ENTITLED_ORGANIZATION_IDS: organizationId,
    });
    await expect(provider.hasEntitlement(check)).resolves.toBe(true);
  });

  it("denies by default when production configuration is unavailable", async () => {
    await expect(
      createEntitlementProvider({ NODE_ENV: "production" }).hasEntitlement(check),
    ).resolves.toBe(false);
  });
});
