DROP INDEX projects_owner_user_id_idx;
DROP INDEX projects_organization_id_idx;

ALTER TABLE projects
  DROP COLUMN owner_user_id,
  DROP COLUMN organization_id;

DROP TABLE organization_memberships;
DROP TABLE organizations;
DROP TABLE "verification";
DROP TABLE "account";
DROP TABLE "session";
DROP TABLE "user";
