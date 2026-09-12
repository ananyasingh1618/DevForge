import { useCallback, useEffect, useState } from "react";
import { Button } from "./Button.js";
import { Card } from "./Card.js";
import { EmptyState, ErrorState, LoadingState } from "./StateViews.js";
import { ApiError } from "../services/apiClient.js";
import { getRepositoryConnectionRequest } from "../services/repositoryApi.js";
import {
  getCodebaseIndexRequest,
  listFileSymbolsRequest,
  listIndexedFilesRequest,
  reindexRepositoryRequest,
  startIndexingRequest,
} from "../services/codebaseIndexApi.js";
import type {
  CodeSymbol,
  CodebaseIndex,
  FileParseStatus,
  IndexedFile,
} from "../types/codebaseIndex.js";

const statusStyles: Record<CodebaseIndex["status"], string> = {
  completed: "bg-accent/15 text-accent",
  indexing: "bg-surface-2 text-text-muted",
  pending: "bg-surface-2 text-text-muted",
  failed: "bg-danger/15 text-danger",
};

const parseStatusLabels: Record<FileParseStatus, string> = {
  parsed: "Parsed",
  unsupported: "Unsupported",
  parse_error: "Parse error",
  skipped_binary: "Skipped (binary)",
  skipped_too_large: "Skipped (too large)",
  skipped_index_limit: "Skipped (index limit)",
};

function SymbolList({ symbols }: { symbols: CodeSymbol[] }) {
  if (symbols.length === 0) {
    return <p className="pl-4 text-xs text-text-muted">No symbols extracted from this file.</p>;
  }
  return (
    <ul className="flex flex-col gap-1 pl-4">
      {symbols.map((symbol) => (
        <li key={symbol.id} className="text-xs text-text-muted">
          <span className="font-mono text-text">{symbol.type}</span> {symbol.name}
          {symbol.signature ? symbol.signature : ""}{" "}
          <span>
            (L{symbol.startLine}–{symbol.endLine})
          </span>
        </li>
      ))}
    </ul>
  );
}

function FileRow({
  file,
  expanded,
  onToggle,
  symbols,
  symbolsLoading,
  symbolsError,
}: {
  file: IndexedFile;
  expanded: boolean;
  onToggle: () => void;
  symbols: CodeSymbol[] | undefined;
  symbolsLoading: boolean;
  symbolsError: string | null;
}) {
  return (
    <li className="flex flex-col gap-1 border-b border-border py-2 last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 text-left text-sm text-text hover:text-accent"
      >
        <span className="truncate font-mono">{file.path}</span>
        <span className="shrink-0 text-xs text-text-muted">{parseStatusLabels[file.parseStatus]}</span>
      </button>
      {file.parseStatus === "parse_error" && file.parseError && (
        <p className="pl-4 text-xs text-danger">{file.parseError}</p>
      )}
      {expanded && (
        <div className="mt-1">
          {symbolsLoading && <p className="pl-4 text-xs text-text-muted">Loading symbols…</p>}
          {symbolsError && (
            <p className="pl-4 text-xs text-danger" role="alert">
              {symbolsError}
            </p>
          )}
          {!symbolsLoading && !symbolsError && symbols && <SymbolList symbols={symbols} />}
        </div>
      )}
    </li>
  );
}

/** Lists a completed index's files, expandable to show each file's extracted
 * symbols. Fetches once on mount — the parent remounts this whole component
 * via `key={index.updatedAt}` whenever a new indexing run actually completes
 * (the CodebaseIndex row is never deleted/recreated on reindex, unlike
 * RepositoryConnection, so its `id` alone would not change — `updatedAt`
 * does, on every real mutation), so this never needs to reset its own state
 * on a prop change. */
function FilesAndSymbolsBrowser({ projectId }: { projectId: string }) {
  const [files, setFiles] = useState<IndexedFile[] | null>(null);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [expandedFileId, setExpandedFileId] = useState<string | null>(null);
  const [symbolsByFile, setSymbolsByFile] = useState<Record<string, CodeSymbol[]>>({});
  const [symbolsLoadingFileId, setSymbolsLoadingFileId] = useState<string | null>(null);
  const [symbolsError, setSymbolsError] = useState<string | null>(null);

  useEffect(() => {
    listIndexedFilesRequest(projectId)
      .then(({ files }) => setFiles(files))
      .catch((err: unknown) =>
        setFilesError(err instanceof ApiError ? err.message : "Couldn't load indexed files."),
      );
  }, [projectId]);

  async function toggleFile(file: IndexedFile) {
    if (expandedFileId === file.id) {
      setExpandedFileId(null);
      return;
    }
    setExpandedFileId(file.id);
    if (symbolsByFile[file.id]) {
      return;
    }
    setSymbolsLoadingFileId(file.id);
    setSymbolsError(null);
    try {
      const { symbols } = await listFileSymbolsRequest(projectId, file.id);
      setSymbolsByFile((prev) => ({ ...prev, [file.id]: symbols }));
    } catch (err) {
      setSymbolsError(err instanceof ApiError ? err.message : "Couldn't load symbols.");
    } finally {
      setSymbolsLoadingFileId(null);
    }
  }

  if (filesError) {
    return (
      <p className="text-sm text-danger" role="alert">
        {filesError}
      </p>
    );
  }

  if (!files) {
    return <p className="text-sm text-text-muted">Loading indexed files…</p>;
  }

  if (files.length === 0) {
    return <p className="text-sm text-text-muted">No files were found in this branch.</p>;
  }

  return (
    <div>
      <h4 className="text-sm font-medium text-text">Indexed files</h4>
      <ul className="mt-2">
        {files.map((file) => (
          <FileRow
            key={file.id}
            file={file}
            expanded={expandedFileId === file.id}
            onToggle={() => void toggleFile(file)}
            symbols={symbolsByFile[file.id]}
            symbolsLoading={symbolsLoadingFileId === file.id}
            symbolsError={expandedFileId === file.id ? symbolsError : null}
          />
        ))}
      </ul>
    </div>
  );
}

type SectionState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "no-repository" }
  | { status: "ready"; index: CodebaseIndex | null };

export function CodebaseIndexSection({ projectId }: { projectId: string }) {
  const [state, setState] = useState<SectionState>({ status: "loading" });
  const [indexing, setIndexing] = useState(false);
  const [indexError, setIndexError] = useState<string | null>(null);

  const fetchState = useCallback(() => {
    getRepositoryConnectionRequest(projectId)
      .then(({ connection }) => {
        if (!connection) {
          setState({ status: "no-repository" });
          return undefined;
        }
        return getCodebaseIndexRequest(projectId).then(({ index }) => {
          setState({ status: "ready", index });
        });
      })
      .catch(() => setState({ status: "error", message: "Couldn't load the codebase index." }));
  }, [projectId]);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    fetchState();
  }, [fetchState]);

  async function handleStart() {
    setIndexing(true);
    setIndexError(null);
    try {
      const { index } = await startIndexingRequest(projectId);
      setState({ status: "ready", index });
    } catch (err) {
      setIndexError(err instanceof ApiError ? err.message : "Indexing failed. Please try again.");
    } finally {
      setIndexing(false);
    }
  }

  async function handleReindex() {
    setIndexing(true);
    setIndexError(null);
    try {
      const { index } = await reindexRepositoryRequest(projectId);
      setState({ status: "ready", index });
    } catch (err) {
      setIndexError(err instanceof ApiError ? err.message : "Reindexing failed. Please try again.");
    } finally {
      setIndexing(false);
    }
  }

  if (state.status === "loading") {
    return <LoadingState label="Loading codebase index…" />;
  }

  if (state.status === "error") {
    return <ErrorState message={state.message} onRetry={retry} />;
  }

  if (state.status === "no-repository") {
    return (
      <EmptyState
        title="No repository connected"
        description="Connect a GitHub repository above before indexing its codebase."
      />
    );
  }

  if (!state.index) {
    return (
      <Card className="flex flex-col gap-4">
        <p className="text-sm text-text-muted">
          Ready to index the connected repository's selected branch.
        </p>
        {indexError && (
          <p className="text-sm text-danger" role="alert">
            {indexError}
          </p>
        )}
        <div>
          <Button type="button" loading={indexing} onClick={() => void handleStart()}>
            Start indexing
          </Button>
        </div>
      </Card>
    );
  }

  const index = state.index;

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium text-text">{index.branch}</h3>
          {index.commitSha && (
            <p className="font-mono text-xs text-text-muted">{index.commitSha.slice(0, 12)}</p>
          )}
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusStyles[index.status]}`}>
          {index.status}
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-text-muted">Files</dt>
          <dd className="text-text">{index.fileCount}</dd>
        </div>
        <div>
          <dt className="text-text-muted">Parsed</dt>
          <dd className="text-text">{index.parsedFileCount}</dd>
        </div>
        <div>
          <dt className="text-text-muted">Failed</dt>
          <dd className="text-text">{index.failedFileCount}</dd>
        </div>
        <div>
          <dt className="text-text-muted">Last run</dt>
          <dd className="text-text">
            {index.completedAt ? new Date(index.completedAt).toLocaleString() : "Never"}
          </dd>
        </div>
      </dl>

      {index.truncated && (
        <p className="text-xs text-text-muted">
          GitHub truncated this repository's file tree — not every file may be represented.
        </p>
      )}

      {index.error && (
        <div>
          <dt className="text-sm text-text-muted">Last error</dt>
          <dd className="text-sm text-danger">{index.error}</dd>
        </div>
      )}

      {indexError && (
        <p className="text-sm text-danger" role="alert">
          {indexError}
        </p>
      )}

      <div>
        <Button type="button" variant="secondary" loading={indexing} onClick={() => void handleReindex()}>
          Reindex
        </Button>
      </div>

      {index.status === "completed" && (
        <FilesAndSymbolsBrowser key={index.updatedAt} projectId={projectId} />
      )}
    </Card>
  );
}
