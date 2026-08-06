import type { AuthenticatedIdentity } from "../authentication/index.ts";
import type {
  OrganisationMembership,
  OrganisationRole,
} from "../organisations/index.ts";

export type OrganisationInvitation = Readonly<{
  invitationId: string;
  organisationId: string;
  invitedEmail: string;
  role: OrganisationRole;
  tokenSha256: string;
  status: "PENDING" | "ACCEPTED" | "REVOKED";
  expiresAtEpochMs: number;
  revision: number;
  acceptedByUserId?: string;
}>;

export type InvitationCreationDecision =
  | Readonly<{ allowed: true; invitation: OrganisationInvitation }>
  | Readonly<{
      allowed: false;
      reason: "invalid_invitation" | "not_owner" | "scope_mismatch";
    }>;

export function createOrganisationInvitation(input: {
  invitationId: string;
  organisationId: string;
  invitedEmail: string;
  role: OrganisationRole;
  tokenSha256: string;
  expiresAtEpochMs: number;
  nowEpochMs: number;
  actorMembership: OrganisationMembership | null;
}): InvitationCreationDecision {
  if (
    input.actorMembership === null ||
    input.actorMembership.organisationId !== input.organisationId
  ) {
    return { allowed: false, reason: "scope_mismatch" };
  }
  if (
    input.actorMembership.status !== "ACTIVE" ||
    input.actorMembership.role !== "owner"
  ) {
    return { allowed: false, reason: "not_owner" };
  }
  const invitedEmail = normalizeEmail(input.invitedEmail);
  if (
    input.invitationId.trim().length === 0 ||
    input.organisationId.trim().length === 0 ||
    !invitedEmail.includes("@") ||
    !/^[a-f0-9]{64}$/.test(input.tokenSha256) ||
    !Number.isSafeInteger(input.expiresAtEpochMs) ||
    input.expiresAtEpochMs <= input.nowEpochMs
  ) {
    return { allowed: false, reason: "invalid_invitation" };
  }
  return {
    allowed: true,
    invitation: {
      invitationId: input.invitationId,
      organisationId: input.organisationId,
      invitedEmail,
      role: input.role,
      tokenSha256: input.tokenSha256,
      status: "PENDING",
      expiresAtEpochMs: input.expiresAtEpochMs,
      revision: 0,
    },
  };
}

export type InvitationAcceptanceDecision =
  | Readonly<{
      allowed: true;
      invitation: OrganisationInvitation;
      membership: OrganisationMembership;
      condition: Readonly<{ expectedRevision: number; nextRevision: number }>;
    }>
  | Readonly<{
      allowed: false;
      reason:
        | "email_mismatch"
        | "expired"
        | "identity_mismatch"
        | "not_pending"
        | "stale_revision";
    }>;

export function acceptOrganisationInvitation(input: {
  invitation: OrganisationInvitation;
  identity: AuthenticatedIdentity;
  verifiedEmail: string;
  expectedRevision: number;
  nowEpochMs: number;
}): InvitationAcceptanceDecision {
  const { invitation } = input;
  if (invitation.revision !== input.expectedRevision) {
    return { allowed: false, reason: "stale_revision" };
  }
  if (invitation.status !== "PENDING") {
    return { allowed: false, reason: "not_pending" };
  }
  if (input.nowEpochMs >= invitation.expiresAtEpochMs) {
    return { allowed: false, reason: "expired" };
  }
  if (
    input.identity.userId.trim().length === 0 ||
    input.identity.userId !== input.identity.userId.trim()
  ) {
    return { allowed: false, reason: "identity_mismatch" };
  }
  if (normalizeEmail(input.verifiedEmail) !== invitation.invitedEmail) {
    return { allowed: false, reason: "email_mismatch" };
  }

  const nextRevision = invitation.revision + 1;
  return {
    allowed: true,
    invitation: {
      ...invitation,
      status: "ACCEPTED",
      acceptedByUserId: input.identity.userId,
      revision: nextRevision,
    },
    membership: {
      userId: input.identity.userId,
      organisationId: invitation.organisationId,
      role: invitation.role,
      status: "ACTIVE",
    },
    condition: {
      expectedRevision: invitation.revision,
      nextRevision,
    },
  };
}

export type InvitationRevocationDecision =
  | Readonly<{
      allowed: true;
      invitation: OrganisationInvitation;
      condition: Readonly<{ expectedRevision: number; nextRevision: number }>;
    }>
  | Readonly<{
      allowed: false;
      reason: "not_owner" | "not_pending" | "scope_mismatch" | "stale_revision";
    }>;

export function revokeOrganisationInvitation(input: {
  invitation: OrganisationInvitation;
  actorMembership: OrganisationMembership | null;
  expectedRevision: number;
}): InvitationRevocationDecision {
  const { invitation } = input;
  if (invitation.revision !== input.expectedRevision) {
    return { allowed: false, reason: "stale_revision" };
  }
  if (invitation.status !== "PENDING") {
    return { allowed: false, reason: "not_pending" };
  }
  if (
    input.actorMembership === null ||
    input.actorMembership.organisationId !== invitation.organisationId
  ) {
    return { allowed: false, reason: "scope_mismatch" };
  }
  if (
    input.actorMembership.status !== "ACTIVE" ||
    input.actorMembership.role !== "owner"
  ) {
    return { allowed: false, reason: "not_owner" };
  }

  const nextRevision = invitation.revision + 1;
  return {
    allowed: true,
    invitation: {
      ...invitation,
      status: "REVOKED",
      revision: nextRevision,
    },
    condition: {
      expectedRevision: invitation.revision,
      nextRevision,
    },
  };
}

export function normalizeInvitationEmail(email: string): string {
  return normalizeEmail(email);
}

function normalizeEmail(email: string): string {
  return email.trim().toLocaleLowerCase("en-US");
}
