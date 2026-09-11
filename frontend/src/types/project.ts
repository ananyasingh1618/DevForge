export type ProjectStatus = "planning" | "active" | "archived";

export type Project = {
  id: string;
  ownerId: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
};
