export type Project = {
  createdAt: string;
  id: string;
  name: string;
  revision: number;
};

export interface ProjectRepository {
  create(input: { name: string }): Promise<Project>;
}

export class ProjectNameConflictError extends Error {
  constructor() {
    super("A project with that name already exists.");
    this.name = "ProjectNameConflictError";
  }
}
