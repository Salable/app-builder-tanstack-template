CREATE TABLE foundation_seat_ledgers (
  organization_id uuid PRIMARY KEY REFERENCES organizations (id) ON DELETE CASCADE,
  purchased integer NOT NULL,
  revision integer NOT NULL DEFAULT 0,
  CONSTRAINT foundation_seat_purchased_nonnegative CHECK (purchased >= 0),
  CONSTRAINT foundation_seat_revision_nonnegative CHECK (revision >= 0)
);

CREATE TABLE foundation_organization_invitations (
  invitation_id text PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES foundation_seat_ledgers (organization_id) ON DELETE CASCADE,
  invited_email text NOT NULL,
  role text NOT NULL,
  token_sha256 char(64) NOT NULL UNIQUE,
  status text NOT NULL,
  expires_at_epoch_ms bigint NOT NULL,
  revision integer NOT NULL DEFAULT 0,
  accepted_by_user_id text REFERENCES "user" ("id") ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT foundation_invitation_email_normalized CHECK (invited_email = lower(btrim(invited_email))),
  CONSTRAINT foundation_invitation_role_known CHECK (role IN ('owner', 'member')),
  CONSTRAINT foundation_invitation_token_sha256 CHECK (token_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT foundation_invitation_status_known CHECK (status IN ('PENDING', 'ACCEPTED', 'REVOKED')),
  CONSTRAINT foundation_invitation_revision_nonnegative CHECK (revision >= 0)
);

CREATE TABLE foundation_seat_reservations (
  invitation_id text PRIMARY KEY REFERENCES foundation_organization_invitations (invitation_id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES foundation_seat_ledgers (organization_id) ON DELETE CASCADE
);

CREATE INDEX foundation_seat_reservations_organization_idx
  ON foundation_seat_reservations (organization_id);

CREATE TABLE foundation_seat_assignments (
  organization_id uuid NOT NULL,
  user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (organization_id, user_id),
  FOREIGN KEY (organization_id) REFERENCES foundation_seat_ledgers (organization_id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, user_id) REFERENCES organization_memberships (organization_id, user_id) ON DELETE CASCADE
);
