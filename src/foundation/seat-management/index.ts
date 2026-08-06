import type { OrganisationInvitation } from "../invitations/index.ts";
import type { OrganisationMembership } from "../organisations/index.ts";

export type SeatLedger = Readonly<{
  organisationId: string;
  purchased: number;
  revision: number;
  reservations: readonly Readonly<{ invitationId: string }>[];
  assignments: readonly Readonly<{ userId: string }>[];
}>;

export type SeatLedgerDecision =
  | Readonly<{
      allowed: true;
      ledger: SeatLedger;
      condition: Readonly<{ expectedRevision: number; nextRevision: number }>;
    }>
  | Readonly<{
      allowed: false;
      reason:
        | "already_allocated"
        | "insufficient_seats"
        | "invalid_ledger"
        | "invitation_denied"
        | "membership_denied"
        | "scope_mismatch"
        | "stale_revision";
    }>;

export function availableSeats(ledger: SeatLedger): number {
  return ledger.purchased - ledger.reservations.length - ledger.assignments.length;
}

export function reserveInvitationSeat(input: {
  ledger: SeatLedger;
  invitation: OrganisationInvitation;
  expectedRevision: number;
}): SeatLedgerDecision {
  const denial = validateCommandLedger(input.ledger, input.expectedRevision);
  if (denial !== null) return denial;
  if (
    input.invitation.organisationId !== input.ledger.organisationId ||
    input.invitation.status !== "PENDING"
  ) {
    return { allowed: false, reason: "invitation_denied" };
  }
  if (
    input.ledger.reservations.some(
      ({ invitationId }) => invitationId === input.invitation.invitationId,
    )
  ) {
    return { allowed: false, reason: "already_allocated" };
  }
  if (availableSeats(input.ledger) < 1) {
    return { allowed: false, reason: "insufficient_seats" };
  }
  return advance(input.ledger, {
    ...input.ledger,
    reservations: [
      ...input.ledger.reservations,
      { invitationId: input.invitation.invitationId },
    ],
  });
}

export function assignAcceptedInvitationSeat(input: {
  ledger: SeatLedger;
  invitation: OrganisationInvitation;
  membership: OrganisationMembership;
  expectedRevision: number;
}): SeatLedgerDecision {
  const denial = validateCommandLedger(input.ledger, input.expectedRevision);
  if (denial !== null) return denial;
  if (
    input.invitation.status !== "ACCEPTED" ||
    input.invitation.acceptedByUserId !== input.membership.userId
  ) {
    return { allowed: false, reason: "invitation_denied" };
  }
  if (
    input.membership.status !== "ACTIVE" ||
    input.membership.organisationId !== input.ledger.organisationId
  ) {
    return { allowed: false, reason: "membership_denied" };
  }
  if (input.invitation.organisationId !== input.ledger.organisationId) {
    return { allowed: false, reason: "scope_mismatch" };
  }
  const reservation = input.ledger.reservations.find(
    ({ invitationId }) => invitationId === input.invitation.invitationId,
  );
  if (reservation === undefined) {
    return { allowed: false, reason: "invitation_denied" };
  }
  if (
    input.ledger.assignments.some(({ userId }) => userId === input.membership.userId)
  ) {
    return { allowed: false, reason: "already_allocated" };
  }
  return advance(input.ledger, {
    ...input.ledger,
    reservations: input.ledger.reservations.filter(
      ({ invitationId }) => invitationId !== input.invitation.invitationId,
    ),
    assignments: [...input.ledger.assignments, { userId: input.membership.userId }],
  });
}

export function releaseInvitationSeat(input: {
  ledger: SeatLedger;
  invitationId: string;
  expectedRevision: number;
}): SeatLedgerDecision {
  const denial = validateCommandLedger(input.ledger, input.expectedRevision);
  if (denial !== null) return denial;
  if (
    !input.ledger.reservations.some(
      ({ invitationId }) => invitationId === input.invitationId,
    )
  ) {
    return { allowed: false, reason: "invitation_denied" };
  }
  return advance(input.ledger, {
    ...input.ledger,
    reservations: input.ledger.reservations.filter(
      ({ invitationId }) => invitationId !== input.invitationId,
    ),
  });
}

export function releaseMembershipSeat(input: {
  ledger: SeatLedger;
  membership: OrganisationMembership;
  expectedRevision: number;
}): SeatLedgerDecision {
  const denial = validateCommandLedger(input.ledger, input.expectedRevision);
  if (denial !== null) return denial;
  if (
    input.membership.status !== "ACTIVE" ||
    input.membership.organisationId !== input.ledger.organisationId
  ) {
    return { allowed: false, reason: "membership_denied" };
  }
  if (
    !input.ledger.assignments.some(({ userId }) => userId === input.membership.userId)
  ) {
    return { allowed: false, reason: "membership_denied" };
  }
  return advance(input.ledger, {
    ...input.ledger,
    assignments: input.ledger.assignments.filter(
      ({ userId }) => userId !== input.membership.userId,
    ),
  });
}

export function reconcilePurchasedSeats(input: {
  ledger: SeatLedger;
  purchased: number;
  expectedRevision: number;
}): SeatLedgerDecision {
  const denial = validateCommandLedger(input.ledger, input.expectedRevision);
  if (denial !== null) return denial;
  if (
    !Number.isSafeInteger(input.purchased) ||
    input.purchased < input.ledger.reservations.length + input.ledger.assignments.length
  ) {
    return { allowed: false, reason: "insufficient_seats" };
  }
  return advance(input.ledger, {
    ...input.ledger,
    purchased: input.purchased,
  });
}

function validateCommandLedger(
  ledger: SeatLedger,
  expectedRevision: number,
): Extract<SeatLedgerDecision, { allowed: false }> | null {
  if (!isValidSeatLedger(ledger)) {
    return { allowed: false, reason: "invalid_ledger" };
  }
  if (ledger.revision !== expectedRevision) {
    return { allowed: false, reason: "stale_revision" };
  }
  return null;
}

function isValidSeatLedger(ledger: SeatLedger): boolean {
  const invitations = ledger.reservations.map(({ invitationId }) => invitationId);
  const users = ledger.assignments.map(({ userId }) => userId);
  return (
    ledger.organisationId.trim().length > 0 &&
    Number.isSafeInteger(ledger.purchased) &&
    ledger.purchased >= 0 &&
    Number.isSafeInteger(ledger.revision) &&
    ledger.revision >= 0 &&
    new Set(invitations).size === invitations.length &&
    new Set(users).size === users.length &&
    availableSeats(ledger) >= 0
  );
}

function advance(
  current: SeatLedger,
  next: Omit<SeatLedger, "revision"> & Readonly<{ revision: number }>,
): Extract<SeatLedgerDecision, { allowed: true }> {
  const nextRevision = current.revision + 1;
  return {
    allowed: true,
    ledger: { ...next, revision: nextRevision },
    condition: {
      expectedRevision: current.revision,
      nextRevision,
    },
  };
}
