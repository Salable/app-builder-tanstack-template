ALTER TABLE projects
  DROP CONSTRAINT project_revision_positive,
  DROP COLUMN revision;
