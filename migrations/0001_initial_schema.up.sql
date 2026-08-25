CREATE TABLE "user" (
  "id" text PRIMARY KEY,
  "name" text NOT NULL,
  "email" text NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL,
  "image" text,
  "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "session" (
  "id" text PRIMARY KEY,
  "expiresAt" timestamptz NOT NULL,
  "token" text NOT NULL UNIQUE,
  "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz NOT NULL,
  "ipAddress" text,
  "userAgent" text,
  "userId" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE
);

CREATE TABLE "account" (
  "id" text PRIMARY KEY,
  "accountId" text NOT NULL,
  "providerId" text NOT NULL,
  "userId" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  "scope" text,
  "password" text,
  "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz NOT NULL
);

CREATE TABLE "verification" (
  "id" text PRIMARY KEY,
  "identifier" text NOT NULL,
  "value" text NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "session_userId_idx" ON "session" ("userId");
CREATE INDEX "account_userId_idx" ON "account" ("userId");
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");

CREATE TABLE organizations (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT organization_name_not_blank CHECK (length(btrim(name)) >= 1),
  CONSTRAINT organization_slug_not_blank CHECK (length(btrim(slug)) >= 1)
);

CREATE TABLE organization_memberships (
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (organization_id, user_id),
  CONSTRAINT organization_membership_role_known CHECK (role IN ('OWNER', 'MEMBER'))
);

CREATE TABLE projects (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  owner_user_id text NOT NULL REFERENCES "user" ("id") ON DELETE RESTRICT,
  name text NOT NULL,
  normalized_name text NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT project_revision_positive CHECK (revision > 0),
  CONSTRAINT projects_organization_normalized_name_key UNIQUE (
    organization_id,
    normalized_name
  )
);

CREATE INDEX projects_organization_id_idx ON projects (organization_id);
CREATE INDEX projects_owner_user_id_idx ON projects (owner_user_id);

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
  CONSTRAINT foundation_invitation_email_normalized CHECK (
    invited_email = lower(btrim(invited_email))
  ),
  CONSTRAINT foundation_invitation_role_known CHECK (role IN ('owner', 'member')),
  CONSTRAINT foundation_invitation_token_sha256 CHECK (
    token_sha256 ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT foundation_invitation_status_known CHECK (
    status IN ('PENDING', 'ACCEPTED', 'REVOKED')
  ),
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
