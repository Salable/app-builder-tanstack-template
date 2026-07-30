import { PostgresDatabase } from "../persistence/database";
import { PostgresProjectRepository } from "./postgres-project-repository";
import type { ProjectRepository } from "./project-repository";

let repository: ProjectRepository | undefined;

export function getProjectRepository(): ProjectRepository {
  repository ??= createProjectRepository();
  return repository;
}

function createProjectRepository(): ProjectRepository {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString === undefined || connectionString.trim() === "") {
    throw new Error("Generated application persistence is not configured.");
  }

  return new PostgresProjectRepository(
    new PostgresDatabase(connectionString),
    process.env.APP_BUILDER_TEST_FAULT_AFTER_INSERT_NAME,
  );
}
