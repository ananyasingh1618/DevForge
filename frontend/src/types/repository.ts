export type RepositoryConnectionStatus = "pending" | "verified" | "error";

export type RepositoryConnection = {
  id: string;
  projectId: string;
  githubOwner: string;
  githubRepo: string;
  githubRepoId: string | null;
  githubAccountLogin: string | null;
  repositoryUrl: string;
  defaultBranch: string | null;
  selectedBranch: string | null;
  status: RepositoryConnectionStatus;
  lastVerifiedAt: string | null;
  lastError: string | null;
  tokenLast4: string;
  createdAt: string;
  updatedAt: string;
};

export type GithubBranch = {
  name: string;
  protected: boolean;
};

export type ConnectRepositoryInput = {
  token: string;
  owner: string;
  repo: string;
};
