import { apiRequest } from "./apiClient.js";
import type { CodebaseIndex, CodeSymbol, IndexedFile } from "../types/codebaseIndex.js";

export function startIndexingRequest(projectId: string): Promise<{ index: CodebaseIndex }> {
  return apiRequest(`/projects/${projectId}/codebase-index/start`, {
    method: "POST",
  });
}

export function getCodebaseIndexRequest(
  projectId: string,
): Promise<{ index: CodebaseIndex | null }> {
  return apiRequest(`/projects/${projectId}/codebase-index`);
}

export function listIndexedFilesRequest(projectId: string): Promise<{ files: IndexedFile[] }> {
  return apiRequest(`/projects/${projectId}/codebase-index/files`);
}

export function listFileSymbolsRequest(
  projectId: string,
  fileId: string,
): Promise<{ symbols: CodeSymbol[] }> {
  return apiRequest(`/projects/${projectId}/codebase-index/files/${fileId}/symbols`);
}

export function reindexRepositoryRequest(projectId: string): Promise<{ index: CodebaseIndex }> {
  return apiRequest(`/projects/${projectId}/codebase-index/reindex`, {
    method: "POST",
  });
}
