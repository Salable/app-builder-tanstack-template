import type { AuthenticatedIdentity } from "../authentication/index.ts";
import {
  acceptOrganisationInvitation,
  createOrganisationInvitation,
  revokeOrganisationInvitation,
  type OrganisationInvitation,
} from "../invitations/index.ts";
import type {
  OrganisationMembership,
  OrganisationRole,
} from "../organisations/index.ts";
import {
  assignAcceptedInvitationSeat,
  reconcilePurchasedSeats,
  releaseInvitationSeat,
  releaseMembershipSeat,
  reserveInvitationSeat,
  type SeatLedger,
} from "./index.ts";

type SqlRow = Record<string, unknown>;

export interface FoundationSqlResult<Row extends SqlRow> {
  rows: Row[];
  rowCount: number | null;
}

export interface FoundationPostgresSession {
  query<Row extends SqlRow = SqlRow>(
    text: string,
    values?: unknown[],
  ): Promise<FoundationSqlResult<Row>>;
}

export interface FoundationPostgresDatabase extends FoundationPostgresSession {
  transaction<Result>(
    operation: (session: FoundationPostgresSession) => Promise<Result>,
  ): Promise<Result>;
}

export class FoundationPersistenceConflictError extends Error {
  constructor(readonly reason: string) {
    super(`Foundation persistence conflict: ${reason}`);
  }
}

export class PostgresInvitationSeatRepository {
  constructor(private readonly database: FoundationPostgresDatabase) {}

  async createSeatLedger(
    organisationId: string,
    purchased: number,
  ): Promise<SeatLedger> {
    if (!Number.isSafeInteger(purchased) || purchased < 0) {
      throw new FoundationPersistenceConflictError("invalid_ledger");
    }
    return this.commit(async (session) => {
      await session.query(
        `INSERT INTO foundation_seat_ledgers (
           organization_id,
           purchased,
           revision
         ) VALUES ($1, $2, 0)`,
        [organisationId, purchased],
      );
      return this.readLedgerForUpdate(session, organisationId);
    });
  }

  async createInvitation(input: {
    invitationId: string;
    organisationId: string;
    invitedEmail: string;
    role: OrganisationRole;
    tokenSha256: string;
    expiresAtEpochMs: number;
    nowEpochMs: number;
    actorUserId: string;
    expectedLedgerRevision: number;
  }): Promise<{ invitation: OrganisationInvitation; ledger: SeatLedger }> {
    return this.commit(async (session) => {
      const ledger = await this.readLedgerForUpdate(session, input.organisationId);
      const actorMembership = await readMembership(
        session,
        input.organisationId,
        input.actorUserId,
      );
      const created = createOrganisationInvitation({
        ...input,
        actorMembership,
      });
      if (!created.allowed) fail(created.reason);
      const reserved = reserveInvitationSeat({
        ledger,
        invitation: created.invitation,
        expectedRevision: input.expectedLedgerRevision,
      });
      if (!reserved.allowed) fail(reserved.reason);
      await session.query(
        `INSERT INTO foundation_organization_invitations (
           invitation_id,
           organization_id,
           invited_email,
           role,
           token_sha256,
           status,
           expires_at_epoch_ms,
           revision
         ) VALUES ($1, $2, $3, $4, $5, 'PENDING', $6, 0)`,
        [
          created.invitation.invitationId,
          created.invitation.organisationId,
          created.invitation.invitedEmail,
          created.invitation.role,
          created.invitation.tokenSha256,
          created.invitation.expiresAtEpochMs,
        ],
      );
      await session.query(
        `INSERT INTO foundation_seat_reservations (invitation_id, organization_id)
         VALUES ($1, $2)`,
        [created.invitation.invitationId, created.invitation.organisationId],
      );
      await writeLedger(session, reserved.ledger, ledger.revision);
      return { invitation: created.invitation, ledger: reserved.ledger };
    });
  }

  async acceptInvitation(input: {
    identity: AuthenticatedIdentity;
    verifiedEmail: string;
    tokenSha256: string;
    expectedInvitationRevision: number;
    expectedLedgerRevision: number;
    nowEpochMs: number;
  }): Promise<{
    invitation: OrganisationInvitation;
    membership: OrganisationMembership;
    ledger: SeatLedger;
  }> {
    return this.commit(async (session) => {
      const scope = await session.query<InvitationScopeRow>(
        `SELECT organization_id
         FROM foundation_organization_invitations
         WHERE token_sha256 = $1`,
        [input.tokenSha256],
      );
      const organisationId = scope.rows[0]?.organization_id;
      if (organisationId === undefined) fail("invitation_denied");
      const ledger = await this.readLedgerForUpdate(session, organisationId);
      const invitation = await readInvitationForUpdate(session, input.tokenSha256);
      const accepted = acceptOrganisationInvitation({
        invitation,
        identity: input.identity,
        verifiedEmail: input.verifiedEmail,
        expectedRevision: input.expectedInvitationRevision,
        nowEpochMs: input.nowEpochMs,
      });
      if (!accepted.allowed) fail(accepted.reason);
      const assigned = assignAcceptedInvitationSeat({
        ledger,
        invitation: accepted.invitation,
        membership: accepted.membership,
        expectedRevision: input.expectedLedgerRevision,
      });
      if (!assigned.allowed) fail(assigned.reason);
      const updated = await session.query(
        `UPDATE foundation_organization_invitations
         SET status = 'ACCEPTED',
             accepted_by_user_id = $2,
             revision = $3
         WHERE invitation_id = $1
           AND status = 'PENDING'
           AND revision = $4`,
        [
          invitation.invitationId,
          accepted.membership.userId,
          accepted.invitation.revision,
          invitation.revision,
        ],
      );
      requireOne(updated.rowCount, "stale_revision");
      await session.query(
        `INSERT INTO organization_memberships (organization_id, user_id, role)
         VALUES ($1, $2, $3)`,
        [
          accepted.membership.organisationId,
          accepted.membership.userId,
          toStoredRole(accepted.membership.role),
        ],
      );
      const released = await session.query(
        `DELETE FROM foundation_seat_reservations
         WHERE invitation_id = $1 AND organization_id = $2`,
        [invitation.invitationId, invitation.organisationId],
      );
      requireOne(released.rowCount, "invitation_denied");
      await session.query(
        `INSERT INTO foundation_seat_assignments (organization_id, user_id)
         VALUES ($1, $2)`,
        [accepted.membership.organisationId, accepted.membership.userId],
      );
      await writeLedger(session, assigned.ledger, ledger.revision);
      return {
        invitation: accepted.invitation,
        membership: accepted.membership,
        ledger: assigned.ledger,
      };
    });
  }

  async revokeInvitation(input: {
    organisationId: string;
    invitationId: string;
    actorUserId: string;
    expectedInvitationRevision: number;
    expectedLedgerRevision: number;
  }): Promise<{ invitation: OrganisationInvitation; ledger: SeatLedger }> {
    return this.commit(async (session) => {
      const ledger = await this.readLedgerForUpdate(session, input.organisationId);
      const [invitation, actorMembership] = await Promise.all([
        readInvitationByIdForUpdate(session, input.invitationId),
        readMembership(session, input.organisationId, input.actorUserId),
      ]);
      const revoked = revokeOrganisationInvitation({
        invitation,
        actorMembership,
        expectedRevision: input.expectedInvitationRevision,
      });
      if (!revoked.allowed) fail(revoked.reason);
      const released = releaseInvitationSeat({
        ledger,
        invitationId: invitation.invitationId,
        expectedRevision: input.expectedLedgerRevision,
      });
      if (!released.allowed) fail(released.reason);
      const updated = await session.query(
        `UPDATE foundation_organization_invitations
         SET status = 'REVOKED', revision = $2
         WHERE invitation_id = $1
           AND organization_id = $3
           AND status = 'PENDING'
           AND revision = $4`,
        [
          invitation.invitationId,
          revoked.invitation.revision,
          invitation.organisationId,
          invitation.revision,
        ],
      );
      requireOne(updated.rowCount, "stale_revision");
      const deleted = await session.query(
        `DELETE FROM foundation_seat_reservations
         WHERE invitation_id = $1 AND organization_id = $2`,
        [invitation.invitationId, invitation.organisationId],
      );
      requireOne(deleted.rowCount, "invitation_denied");
      await writeLedger(session, released.ledger, ledger.revision);
      return { invitation: revoked.invitation, ledger: released.ledger };
    });
  }

  async removeMembership(input: {
    organisationId: string;
    actorUserId: string;
    memberUserId: string;
    expectedLedgerRevision: number;
  }): Promise<SeatLedger> {
    return this.commit(async (session) => {
      const ledger = await this.readLedgerForUpdate(session, input.organisationId);
      const [actor, membership] = await Promise.all([
        readMembership(session, input.organisationId, input.actorUserId),
        readMembership(session, input.organisationId, input.memberUserId),
      ]);
      if (actor?.role !== "owner" || membership?.role !== "member") {
        fail("membership_denied");
      }
      const released = releaseMembershipSeat({
        ledger,
        membership,
        expectedRevision: input.expectedLedgerRevision,
      });
      if (!released.allowed) fail(released.reason);
      const deleted = await session.query(
        `DELETE FROM organization_memberships
         WHERE organization_id = $1 AND user_id = $2 AND role = 'MEMBER'`,
        [input.organisationId, input.memberUserId],
      );
      requireOne(deleted.rowCount, "membership_denied");
      await writeLedger(session, released.ledger, ledger.revision);
      return released.ledger;
    });
  }

  async reconcilePurchased(input: {
    organisationId: string;
    purchased: number;
    expectedLedgerRevision: number;
  }): Promise<SeatLedger> {
    return this.commit(async (session) => {
      const ledger = await this.readLedgerForUpdate(session, input.organisationId);
      const reconciled = reconcilePurchasedSeats({
        ledger,
        purchased: input.purchased,
        expectedRevision: input.expectedLedgerRevision,
      });
      if (!reconciled.allowed) fail(reconciled.reason);
      await writeLedger(session, reconciled.ledger, ledger.revision);
      return reconciled.ledger;
    });
  }

  private async readLedgerForUpdate(
    session: FoundationPostgresSession,
    organisationId: string,
  ): Promise<SeatLedger> {
    const result = await session.query<LedgerRow>(
      `SELECT organization_id, purchased, revision
       FROM foundation_seat_ledgers
       WHERE organization_id = $1
       FOR UPDATE`,
      [organisationId],
    );
    const row = result.rows[0];
    if (row === undefined) fail("invalid_ledger");
    const [reservations, assignments] = await Promise.all([
      session.query<ReservationRow>(
        `SELECT invitation_id
         FROM foundation_seat_reservations
         WHERE organization_id = $1
         ORDER BY invitation_id`,
        [organisationId],
      ),
      session.query<AssignmentRow>(
        `SELECT user_id
         FROM foundation_seat_assignments
         WHERE organization_id = $1
         ORDER BY user_id`,
        [organisationId],
      ),
    ]);
    return {
      organisationId: row.organization_id,
      purchased: row.purchased,
      revision: row.revision,
      reservations: reservations.rows.map(({ invitation_id }) => ({
        invitationId: invitation_id,
      })),
      assignments: assignments.rows.map(({ user_id }) => ({ userId: user_id })),
    };
  }

  private async commit<Result>(
    operation: (session: FoundationPostgresSession) => Promise<Result>,
  ): Promise<Result> {
    try {
      return await this.database.transaction(operation);
    } catch (error) {
      if (error instanceof FoundationPersistenceConflictError) throw error;
      throw new FoundationPersistenceConflictError("storage_conflict");
    }
  }
}

type LedgerRow = SqlRow & {
  organization_id: string;
  purchased: number;
  revision: number;
};
type ReservationRow = SqlRow & { invitation_id: string };
type AssignmentRow = SqlRow & { user_id: string };
type InvitationScopeRow = SqlRow & { organization_id: string };
type InvitationRow = SqlRow & {
  invitation_id: string;
  organization_id: string;
  invited_email: string;
  role: OrganisationRole;
  token_sha256: string;
  status: OrganisationInvitation["status"];
  expires_at_epoch_ms: string;
  revision: number;
  accepted_by_user_id: string | null;
};
type MembershipRow = SqlRow & { user_id: string; role: "OWNER" | "MEMBER" };

async function readMembership(
  session: FoundationPostgresSession,
  organisationId: string,
  userId: string,
): Promise<OrganisationMembership | null> {
  const result = await session.query<MembershipRow>(
    `SELECT user_id, role
     FROM organization_memberships
     WHERE organization_id = $1 AND user_id = $2`,
    [organisationId, userId],
  );
  const row = result.rows[0];
  return row === undefined
    ? null
    : {
        userId: row.user_id,
        organisationId,
        role: row.role === "OWNER" ? "owner" : "member",
        status: "ACTIVE",
      };
}

async function readInvitationForUpdate(
  session: FoundationPostgresSession,
  tokenSha256: string,
): Promise<OrganisationInvitation> {
  const result = await session.query<InvitationRow>(
    `${INVITATION_SELECT} WHERE token_sha256 = $1 FOR UPDATE`,
    [tokenSha256],
  );
  return toInvitation(result.rows[0]);
}

async function readInvitationByIdForUpdate(
  session: FoundationPostgresSession,
  invitationId: string,
): Promise<OrganisationInvitation> {
  const result = await session.query<InvitationRow>(
    `${INVITATION_SELECT} WHERE invitation_id = $1 FOR UPDATE`,
    [invitationId],
  );
  return toInvitation(result.rows[0]);
}

function toInvitation(row: InvitationRow | undefined): OrganisationInvitation {
  if (row === undefined) fail("invitation_denied");
  const expiresAtEpochMs = Number(row.expires_at_epoch_ms);
  if (!Number.isSafeInteger(expiresAtEpochMs)) fail("invitation_denied");
  return {
    invitationId: row.invitation_id,
    organisationId: row.organization_id,
    invitedEmail: row.invited_email,
    role: row.role,
    tokenSha256: row.token_sha256,
    status: row.status,
    expiresAtEpochMs,
    revision: row.revision,
    ...(row.accepted_by_user_id === null
      ? {}
      : { acceptedByUserId: row.accepted_by_user_id }),
  };
}

async function writeLedger(
  session: FoundationPostgresSession,
  ledger: SeatLedger,
  expectedRevision: number,
): Promise<void> {
  const result = await session.query(
    `UPDATE foundation_seat_ledgers
     SET purchased = $2, revision = $3
     WHERE organization_id = $1 AND revision = $4`,
    [ledger.organisationId, ledger.purchased, ledger.revision, expectedRevision],
  );
  requireOne(result.rowCount, "stale_revision");
}

function toStoredRole(role: OrganisationRole): "OWNER" | "MEMBER" {
  return role === "owner" ? "OWNER" : "MEMBER";
}

function requireOne(rowCount: number | null, reason: string): void {
  if (rowCount !== 1) fail(reason);
}

function fail(reason: string): never {
  throw new FoundationPersistenceConflictError(reason);
}

const INVITATION_SELECT = `SELECT
  invitation_id,
  organization_id,
  invited_email,
  role,
  token_sha256,
  status,
  expires_at_epoch_ms,
  revision,
  accepted_by_user_id
FROM foundation_organization_invitations`;
