CREATE TABLE projects (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  normalized_name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT project_name_not_blank CHECK (length(btrim(name)) >= 3)
);
