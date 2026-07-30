import { z } from "zod";
import { PostgresDatabase, type Database } from "../persistence/database";

export const ProjectAccessSchema = z
  .object({
    organizationId: z.uuid(),
    projectId: z.uuid(),
  })
  .strict();

export type ProjectAccess = z.infer<typeof ProjectAccessSchema>;

export interface ProjectAccessRepository {
  findOwnedProject(projectId: string, userId: string): Promise<ProjectAccess | null>;
}

type ProjectAccessRow = {
  organization_id: string;
  project_id: string;
};

export class PostgresProjectAccessRepository implements ProjectAccessRepository {
  constructor(private readonly database: Database) {}

  async findOwnedProject(
    projectId: string,
    userId: string,
  ): Promise<ProjectAccess | null> {
    const result = await this.database.query<ProjectAccessRow>(
      `SELECT project.id AS project_id,
              project.organization_id
       FROM projects AS project
       INNER JOIN organization_memberships AS membership
         ON membership.organization_id = project.organization_id
        AND membership.user_id = $2
       WHERE project.id = $1
         AND project.owner_user_id = $2`,
      [projectId, userId],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    return ProjectAccessSchema.parse({
      organizationId: row.organization_id,
      projectId: row.project_id,
    });
  }
}

let repository: ProjectAccessRepository | undefined;

export function getProjectAccessRepository(): ProjectAccessRepository {
  repository ??= createProjectAccessRepository();
  return repository;
}

export function setProjectAccessRepositoryForTesting(
  replacement: ProjectAccessRepository | undefined,
): void {
  repository = replacement;
}

function createProjectAccessRepository(): ProjectAccessRepository {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString === undefined || connectionString.trim() === "") {
    throw new Error("Generated application authorization is not configured.");
  }
  return new PostgresProjectAccessRepository(new PostgresDatabase(connectionString));
}
