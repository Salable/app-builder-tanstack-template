CREATE TABLE IF NOT EXISTS "user" (
  "id" text PRIMARY KEY,
  "name" text NOT NULL,
  "email" text NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL,
  "image" text,
  "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "session" (
  "id" text PRIMARY KEY,
  "expiresAt" timestamptz NOT NULL,
  "token" text NOT NULL UNIQUE,
  "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz NOT NULL,
  "ipAddress" text,
  "userAgent" text,
  "userId" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "account" (
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

CREATE TABLE IF NOT EXISTS "verification" (
  "id" text PRIMARY KEY,
  "identifier" text NOT NULL,
  "value" text NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "session_userId_idx" ON "session" ("userId");
CREATE INDEX IF NOT EXISTS "account_userId_idx" ON "account" ("userId");
CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "verification" ("identifier");

CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT organization_name_not_blank CHECK (length(btrim(name)) >= 1),
  CONSTRAINT organization_slug_not_blank CHECK (length(btrim(slug)) >= 1)
);

CREATE TABLE IF NOT EXISTS organization_memberships (
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (organization_id, user_id),
  CONSTRAINT organization_membership_role_known CHECK (role IN ('OWNER', 'MEMBER'))
);

INSERT INTO organizations (id, name, slug)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'Legacy unassigned projects',
  'legacy-unassigned-projects'
) ON CONFLICT (id) DO NOTHING;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS organization_id uuid NOT NULL
    DEFAULT '00000000-0000-4000-8000-000000000001'
    REFERENCES organizations (id),
  ADD COLUMN IF NOT EXISTS owner_user_id text REFERENCES "user" ("id") ON DELETE RESTRICT;

-- Earlier schemas allowed duplicate normalized names. Preserve every legacy row while
-- deterministically disambiguating all but the lowest project UUID before applying the
-- organization-scoped uniqueness boundary. The UUID suffix keeps migrated duplicate
-- names stable across environments.
WITH ranked_legacy_projects AS (
  SELECT id, row_number() OVER (
    PARTITION BY organization_id, normalized_name
    ORDER BY id
  ) AS duplicate_number
  FROM projects
)
UPDATE projects AS project
SET
  name = project.name || ' (legacy duplicate ' || project.id::text || ')',
  normalized_name = project.normalized_name || ' (legacy duplicate ' || project.id::text || ')'
FROM ranked_legacy_projects AS ranked
WHERE project.id = ranked.id
  AND ranked.duplicate_number > 1;

DO $$
DECLARE
  conflicting_names text;
BEGIN
  SELECT string_agg(normalized_name, ', ' ORDER BY normalized_name)
  INTO conflicting_names
  FROM (
    SELECT normalized_name
    FROM projects
    GROUP BY organization_id, normalized_name
    HAVING count(*) > 1
  ) AS conflicts;

  IF conflicting_names IS NOT NULL THEN
    RAISE EXCEPTION 'Legacy project names still conflict after deterministic renaming: %. Rename these projects under schema 0002 and retry migration 0003.', conflicting_names;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'projects_organization_normalized_name_key'
      AND conrelid = 'projects'::regclass
  ) THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_organization_normalized_name_key
      UNIQUE (organization_id, normalized_name);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS projects_organization_id_idx ON projects (organization_id);
CREATE INDEX IF NOT EXISTS projects_owner_user_id_idx ON projects (owner_user_id);
