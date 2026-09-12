export type CodebaseIndexStatus = "pending" | "indexing" | "completed" | "failed";

export type CodebaseIndex = {
  id: string;
  projectId: string;
  repositoryConnectionId: string;
  branch: string;
  commitSha: string | null;
  status: CodebaseIndexStatus;
  truncated: boolean;
  fileCount: number;
  parsedFileCount: number;
  failedFileCount: number;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FileParseStatus =
  | "parsed"
  | "unsupported"
  | "parse_error"
  | "skipped_binary"
  | "skipped_too_large"
  | "skipped_index_limit";

export type IndexedFile = {
  id: string;
  indexId: string;
  path: string;
  language: string | null;
  sizeBytes: number;
  contentHash: string;
  parseStatus: FileParseStatus;
  parseError: string | null;
  createdAt: string;
};

export type CodeSymbol = {
  id: string;
  fileId: string;
  name: string;
  type: string;
  startLine: number;
  endLine: number;
  parentId: string | null;
  signature: string | null;
};
