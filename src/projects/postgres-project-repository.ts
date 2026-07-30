import type { Database } from "../persistence/database";
import {
  ProjectNameConflictError,
  type Project,
  type ProjectRepository,
} from "./project-repository";

type ProjectRow = {
  created_at: Date;
  id: string;
  name: string;
  revision: number;
};

type PostgresError = {
  code?: string;
};

export class PostgresProjectRepository implements ProjectRepository {
  constructor(
    private readonly database: Database,
    private readonly faultAfterInsertName?: string,
  ) {}

  async create(input: { name: string }): Promise<Project> {
    const normalizedName = input.name.toLocaleLowerCase("en");

    try {
      return await this.database.transaction(async (session) => {
        const result = await session.query<ProjectRow>(
          `INSERT INTO projects (id, name, normalized_name)
           VALUES ($1, $2, $3)
           RETURNING id, name, revision, created_at`,
          [crypto.randomUUID(), input.name, normalizedName],
        );
        const row = result.rows[0];
        if (row === undefined) throw new Error("Project insert returned no row.");

        if (normalizedName === this.faultAfterInsertName) {
          throw new Error("Injected post-insert persistence failure.");
        }

        return {
          createdAt: row.created_at.toISOString(),
          id: row.id,
          name: row.name,
          revision: row.revision,
        };
      });
    } catch (error) {
      if ((error as PostgresError).code === "23505") {
        throw new ProjectNameConflictError();
      }
      throw error;
    }
  }
}
