ALTER TABLE projects
  ADD COLUMN revision integer NOT NULL DEFAULT 1,
  ADD CONSTRAINT project_revision_positive CHECK (revision > 0);
