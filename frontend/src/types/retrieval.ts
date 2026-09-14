export type SearchResult = {
  chunkId: string;
  filePath: string;
  symbolName: string | null;
  symbolType: string | null;
  content: string;
  startLine: number;
  endLine: number;
  language: string;
  branch: string;
  commitSha: string;
  score: number;
};

export type SearchRequest = {
  query: string;
  branch?: string;
  commit?: string;
  limit?: number;
};
