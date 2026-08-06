export type Project = {
  createdAt: string;
  id: string;
  name: string;
  revision: number;
};

export interface ProjectRepository {
  create(
    input: { name: string },
    organizationId: string,
    userId: string,
  ): Promise<Project>;
}

export class ProjectOrganizationAccessError extends Error {
  constructor() {
    super("The user is not a member of the requested organization.");
    this.name = "ProjectOrganizationAccessError";
  }
}

export class ProjectNameConflictError extends Error {
  constructor() {
    super("A project with that name already exists.");
    this.name = "ProjectNameConflictError";
  }
}
