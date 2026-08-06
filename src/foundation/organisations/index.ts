import type { AuthenticatedIdentity } from "../authentication/index.ts";

export type OrganisationRole = "member" | "owner";

export type OrganisationMembership = Readonly<{
  userId: string;
  organisationId: string;
  role: OrganisationRole;
  status: "ACTIVE" | "REVOKED";
}>;

export function hasActiveOrganisationMembership(
  identity: AuthenticatedIdentity,
  membership: OrganisationMembership | null,
  organisationId: string,
): membership is OrganisationMembership {
  return (
    membership !== null &&
    membership.status === "ACTIVE" &&
    membership.userId === identity.userId &&
    membership.organisationId === organisationId
  );
}
