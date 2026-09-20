import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "./Badge.js";
import { Button } from "./Button.js";
import { Card } from "./Card.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { EmptyState, ErrorState, LoadingState } from "./StateViews.js";
import { IconExternalLink, IconGithub } from "./icons.js";
import { ApiError } from "../services/apiClient.js";
import {
  connectRepositoryRequest,
  disconnectRepositoryRequest,
  getRepositoryConnectionRequest,
  listRepositoryBranchesRequest,
  updateRepositoryBranchRequest,
  verifyRepositoryAccessRequest,
} from "../services/repositoryApi.js";
import { getCodebaseIndexRequest } from "../services/codebaseIndexApi.js";
import type { ConnectRepositoryInput, GithubBranch, RepositoryConnection } from "../types/repository.js";
import type { CodebaseIndex } from "../types/codebaseIndex.js";

const statusTone: Record<RepositoryConnection["status"], "success" | "neutral" | "danger"> = {
  verified: "success",
  pending: "neutral",
  error: "danger",
};

/**
 * The "Connect repository" form. No GitHub OAuth/App flow exists in this
 * phase (see docs/GITHUB_INTEGRATION_PHASE_PLAN.md) — the user pastes a
 * personal access token they generated themselves; DevForge never invents
 * or assumes one exists. The token is never redisplayed after submission —
 * only its last 4 characters, once connected (see ConnectedView below).
 */
function ConnectForm({
  onSubmit,
  submitting,
  error,
}: {
  onSubmit: (input: ConnectRepositoryInput) => void;
  submitting: boolean;
  error: string | null;
}) {
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [token, setToken] = useState("");

  const canSubmit = owner.trim().length > 0 && repo.trim().length > 0 && token.trim().length >= 10;

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-3 text-left">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="repo-owner" className="text-sm font-medium text-text">
            Owner
          </label>
          <input
            id="repo-owner"
            type="text"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            placeholder="octocat"
            className="h-10 rounded-lg border border-border bg-surface-2 px-3.5 text-sm text-text placeholder:text-text-faint focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="repo-repo" className="text-sm font-medium text-text">
            Repository
          </label>
          <input
            id="repo-repo"
            type="text"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="Hello-World"
            className="h-10 rounded-lg border border-border bg-surface-2 px-3.5 text-sm text-text placeholder:text-text-faint focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25"
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="repo-token" className="text-sm font-medium text-text">
          Personal access token
        </label>
        <input
          id="repo-token"
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="ghp_..."
          autoComplete="off"
          className="h-10 rounded-lg border border-border bg-surface-2 px-3.5 text-sm text-text placeholder:text-text-faint focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25"
        />
        <p className="text-xs text-text-muted">
          Generate one at github.com with read-only access to the repository. DevForge stores it
          encrypted and never displays it again — only its last 4 characters, once connected.
        </p>
      </div>
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      <div>
        <Button
          type="button"
          loading={submitting}
          disabled={!canSubmit}
          onClick={() => onSubmit({ owner: owner.trim(), repo: repo.trim(), token: token.trim() })}
        >
          Connect repository
        </Button>
      </div>
    </div>
  );
}

const healthLabel: Record<RepositoryConnection["status"], string> = {
  verified: "Healthy — access confirmed",
  pending: "Not yet verified",
  error: "Access error — see below",
};

function ConnectedView({
  projectId,
  connection,
  index,
  onChanged,
}: {
  projectId: string;
  connection: RepositoryConnection;
  index: CodebaseIndex | null;
  onChanged: (connection: RepositoryConnection | null) => void;
}) {
  const [branches, setBranches] = useState<GithubBranch[] | null>(null);
  const [branchesError, setBranchesError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [updatingBranch, setUpdatingBranch] = useState(false);
  const [branchUpdateError, setBranchUpdateError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);

  // No dependency on connection.id here — the parent remounts this whole
  // component via `key={connection.id}` when the connection changes (same
  // technique every prior phase's VersionDetail uses), so this effect only
  // ever runs once per real connection, and never needs to reset state
  // itself (avoiding the synchronous-setState-in-effect issue that pattern
  // is chosen to sidestep).
  useEffect(() => {
    listRepositoryBranchesRequest(projectId)
      .then(({ branches }) => setBranches(branches))
      .catch((err: unknown) =>
        setBranchesError(err instanceof ApiError ? err.message : "Couldn't load branches."),
      );
  }, [projectId]);

  async function handleVerify() {
    setVerifying(true);
    setVerifyError(null);
    try {
      const { connection: verified } = await verifyRepositoryAccessRequest(projectId);
      onChanged(verified);
    } catch (err) {
      setVerifyError(err instanceof ApiError ? err.message : "Verification failed.");
    } finally {
      setVerifying(false);
    }
  }

  async function handleBranchChange(branch: string) {
    setUpdatingBranch(true);
    setBranchUpdateError(null);
    try {
      const { connection: updated } = await updateRepositoryBranchRequest(projectId, branch);
      onChanged(updated);
    } catch (err) {
      setBranchUpdateError(err instanceof ApiError ? err.message : "Couldn't update the branch.");
    } finally {
      setUpdatingBranch(false);
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      await disconnectRepositoryRequest(projectId);
      onChanged(null);
    } catch {
      setDisconnecting(false);
    } finally {
      setConfirmingDisconnect(false);
    }
  }

  return (
    <Card className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-text-muted">
            <IconGithub className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-medium text-text">
              {connection.githubOwner}/{connection.githubRepo}
            </h3>
            <a
              href={connection.repositoryUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 truncate text-xs text-text-muted hover:text-accent"
            >
              {connection.repositoryUrl}
              <IconExternalLink className="h-3 w-3 shrink-0" />
            </a>
          </div>
        </div>
        <Badge tone={statusTone[connection.status]} dot>
          {connection.status}
        </Badge>
      </div>

      <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-text-muted">Connected as</dt>
          <dd className="mt-0.5 text-text">{connection.githubAccountLogin ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">Token</dt>
          <dd className="mt-0.5 font-mono text-text">•••• {connection.tokenLast4}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">Last synchronized</dt>
          <dd className="mt-0.5 text-text">
            {connection.lastVerifiedAt ? new Date(connection.lastVerifiedAt).toLocaleString() : "Never"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">Repository health</dt>
          <dd className={`mt-0.5 ${connection.status === "error" ? "text-danger" : "text-text"}`}>
            {healthLabel[connection.status]}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">Indexing readiness</dt>
          <dd className="mt-0.5 text-text">
            {index ? (
              <Link to={`/projects/${projectId}/indexing`} className="text-accent hover:underline">
                {index.status === "completed"
                  ? `Indexed — ${index.parsedFileCount}/${index.fileCount} files`
                  : index.status === "indexing"
                    ? "Indexing in progress"
                    : index.status === "failed"
                      ? "Last index failed"
                      : "Index pending"}
              </Link>
            ) : (
              <Link to={`/projects/${projectId}/indexing`} className="text-accent hover:underline">
                Not indexed yet
              </Link>
            )}
          </dd>
        </div>
        {connection.lastError && (
          <div>
            <dt className="text-xs text-text-muted">Last error</dt>
            <dd className="mt-0.5 text-danger">{connection.lastError}</dd>
          </div>
        )}
      </dl>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="repo-branch" className="text-sm font-medium text-text">
          Branch
        </label>
        {branchesError && (
          <p className="text-sm text-danger" role="alert">
            {branchesError}
          </p>
        )}
        {!branchesError && !branches && <p className="text-sm text-text-muted">Loading branches…</p>}
        {branches && (
          <select
            id="repo-branch"
            value={connection.selectedBranch ?? ""}
            disabled={updatingBranch}
            onChange={(e) => handleBranchChange(e.target.value)}
            className="h-10 rounded-lg border border-border bg-surface-2 px-3.5 text-sm text-text focus-visible:border-accent focus-visible:outline-none"
          >
            {connection.selectedBranch && !branches.some((b) => b.name === connection.selectedBranch) && (
              <option value={connection.selectedBranch}>{connection.selectedBranch}</option>
            )}
            {branches.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
                {b.protected ? " (protected)" : ""}
              </option>
            ))}
          </select>
        )}
        {branchUpdateError && (
          <p className="text-sm text-danger" role="alert">
            {branchUpdateError}
          </p>
        )}
      </div>

      {verifyError && (
        <p className="text-sm text-danger" role="alert">
          {verifyError}
        </p>
      )}

      <div className="flex gap-2 border-t border-border pt-4">
        <Button type="button" variant="secondary" size="sm" loading={verifying} onClick={handleVerify}>
          Reverify access
        </Button>
        <Button type="button" variant="danger" size="sm" onClick={() => setConfirmingDisconnect(true)}>
          Disconnect
        </Button>
      </div>

      <ConfirmDialog
        open={confirmingDisconnect}
        title="Disconnect repository?"
        description={`DevForge will forget its access to ${connection.githubOwner}/${connection.githubRepo}. Existing indexed data, Q&A history, and reviews are kept, but nothing new can be indexed until you reconnect.`}
        confirmLabel="Disconnect"
        loading={disconnecting}
        onConfirm={() => void handleDisconnect()}
        onCancel={() => setConfirmingDisconnect(false)}
      />
    </Card>
  );
}

type SectionState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "disconnected" }
  | { status: "connected"; connection: RepositoryConnection };

export function RepositoryConnectionSection({ projectId }: { projectId: string }) {
  const [state, setState] = useState<SectionState>({ status: "loading" });
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [index, setIndex] = useState<CodebaseIndex | null>(null);

  const fetchConnection = useCallback(() => {
    getRepositoryConnectionRequest(projectId)
      .then(({ connection }) => {
        setState(connection ? { status: "connected", connection } : { status: "disconnected" });
      })
      .catch(() =>
        setState({ status: "error", message: "Couldn't load the repository connection." }),
      );
    getCodebaseIndexRequest(projectId)
      .then(({ index: i }) => setIndex(i))
      .catch(() => setIndex(null));
  }, [projectId]);

  useEffect(() => {
    fetchConnection();
  }, [fetchConnection]);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    fetchConnection();
  }, [fetchConnection]);

  async function handleConnect(input: ConnectRepositoryInput) {
    setConnecting(true);
    setConnectError(null);
    try {
      const { connection } = await connectRepositoryRequest(projectId, input);
      setState({ status: "connected", connection });
    } catch (err) {
      setConnectError(
        err instanceof ApiError ? err.message : "Couldn't connect the repository. Please try again.",
      );
    } finally {
      setConnecting(false);
    }
  }

  function handleChanged(connection: RepositoryConnection | null) {
    setState(connection ? { status: "connected", connection } : { status: "disconnected" });
  }

  if (state.status === "loading") {
    return <LoadingState label="Loading repository connection…" />;
  }

  if (state.status === "error") {
    return <ErrorState message={state.message} onRetry={retry} />;
  }

  if (state.status === "disconnected") {
    return (
      <Card>
        <EmptyState
          icon={<IconGithub className="h-5 w-5" />}
          title="No repository connected"
          description="Connect a GitHub repository using a personal access token you generate yourself — DevForge never invents or assumes one exists."
          action={<ConnectForm onSubmit={handleConnect} submitting={connecting} error={connectError} />}
        />
      </Card>
    );
  }

  return (
    <ConnectedView
      key={state.connection.id}
      projectId={projectId}
      connection={state.connection}
      index={index}
      onChanged={handleChanged}
    />
  );
}
