import { PostgresDatabase } from "../persistence/database";
import { PostgresProjectRepository } from "./postgres-project-repository";
import type { ProjectRepository } from "./project-repository";

let repository: ProjectRepository | undefined;

export function getProjectRepository(): ProjectRepository {
  repository ??= createProjectRepository();
  return repository;
}

export function setProjectRepositoryForTesting(
  replacement: ProjectRepository | undefined,
): void {
  repository = replacement;
}

function createProjectRepository(): ProjectRepository {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString === undefined || connectionString.trim() === "") {
    throw new Error("Generated application persistence is not configured.");
  }

  return new PostgresProjectRepository(
    new PostgresDatabase(connectionString),
    readPersistenceFaultName(process.env),
  );
}

export function readPersistenceFaultName(
  environment: NodeJS.ProcessEnv,
): string | undefined {
  return environment.NODE_ENV === "test"
    ? environment.APP_BUILDER_TEST_FAULT_AFTER_INSERT_NAME
    : undefined;
}
