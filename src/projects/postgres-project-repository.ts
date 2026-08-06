import type { Database } from "../persistence/database";
import {
  ProjectNameConflictError,
  ProjectOrganizationAccessError,
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

  async create(
    input: { name: string },
    organizationId: string,
    userId: string,
  ): Promise<Project> {
    const normalizedName = input.name.toLocaleLowerCase("en");

    try {
      return await this.database.transaction(async (session) => {
        const result = await session.query<ProjectRow>(
          `INSERT INTO projects (id, name, normalized_name, organization_id, owner_user_id)
           SELECT $1, $2, $3, membership.organization_id, membership.user_id
           FROM organization_memberships AS membership
           WHERE membership.organization_id = $4 AND membership.user_id = $5
           RETURNING id, name, revision, created_at`,
          [crypto.randomUUID(), input.name, normalizedName, organizationId, userId],
        );
        const row = result.rows[0];
        if (row === undefined) throw new ProjectOrganizationAccessError();

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
