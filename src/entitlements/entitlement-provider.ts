export const PROTECTED_INSIGHTS_CAPABILITY = "protected-insights";

export type EntitlementCheck = {
  capability: typeof PROTECTED_INSIGHTS_CAPABILITY;
  organizationId: string;
  userId: string;
};

export interface EntitlementProvider {
  hasEntitlement(check: EntitlementCheck): Promise<boolean>;
}

export class FakeEntitlementProvider implements EntitlementProvider {
  readonly #entitledOrganizations: ReadonlySet<string>;

  constructor(entitledOrganizations: Iterable<string> = []) {
    this.#entitledOrganizations = new Set(entitledOrganizations);
  }

  async hasEntitlement(check: EntitlementCheck): Promise<boolean> {
    return this.#entitledOrganizations.has(check.organizationId);
  }
}

let entitlementProvider: EntitlementProvider | undefined;

export function getEntitlementProvider(): EntitlementProvider {
  entitlementProvider ??= createEntitlementProvider();
  return entitlementProvider;
}

export function setEntitlementProviderForTesting(
  replacement: EntitlementProvider | undefined,
): void {
  entitlementProvider = replacement;
}

function createEntitlementProvider(): EntitlementProvider {
  const environment: Record<string, string | undefined> = process.env;
  if (environment.NODE_ENV !== "test") return new FakeEntitlementProvider();
  const organizationIds = (environment.APP_BUILDER_TEST_ENTITLED_ORGANIZATION_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return new FakeEntitlementProvider(organizationIds);
}
