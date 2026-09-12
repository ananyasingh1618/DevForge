import { useCallback, useEffect, useState } from "react";
import { Button } from "./Button.js";
import { Card } from "./Card.js";
import { EmptyState, ErrorState, LoadingState } from "./StateViews.js";
import { ApiError } from "../services/apiClient.js";
import {
  connectRepositoryRequest,
  disconnectRepositoryRequest,
  getRepositoryConnectionRequest,
  listRepositoryBranchesRequest,
  updateRepositoryBranchRequest,
  verifyRepositoryAccessRequest,
} from "../services/repositoryApi.js";
import type { ConnectRepositoryInput, GithubBranch, RepositoryConnection } from "../types/repository.js";

const statusStyles: Record<RepositoryConnection["status"], string> = {
  verified: "bg-accent/15 text-accent",
  pending: "bg-surface-2 text-text-muted",
  error: "bg-danger/15 text-danger",
};

/**
 * The "Connect repository" form. No GitHub OAuth/App flow exists in this
 * phase (see docs/GITHUB_INTEGRATION_PHASE_PLAN.md) — the user pastes a
 * personal access token they generated themselves; DevForge never invents
 * or assumes one exists.
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
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted focus-visible:outline-none"
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
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted focus-visible:outline-none"
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
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted focus-visible:outline-none"
        />
        <p className="text-xs text-text-muted">
          Generate one at github.com with read access to the repository. DevForge stores it
          encrypted and never displays it again.
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

function ConnectedView({
  projectId,
  connection,
  onChanged,
}: {
  projectId: string;
  connection: RepositoryConnection;
  onChanged: (connection: RepositoryConnection | null) => void;
}) {
  const [branches, setBranches] = useState<GithubBranch[] | null>(null);
  const [branchesError, setBranchesError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [updatingBranch, setUpdatingBranch] = useState(false);
  const [branchUpdateError, setBranchUpdateError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

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
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium text-text">
            {connection.githubOwner}/{connection.githubRepo}
          </h3>
          <a
            href={connection.repositoryUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-text-muted hover:text-text"
          >
            {connection.repositoryUrl}
          </a>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusStyles[connection.status]}`}>
          {connection.status}
        </span>
      </div>

      <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-text-muted">Connected as</dt>
          <dd className="text-text">{connection.githubAccountLogin ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-text-muted">Token</dt>
          <dd className="text-text">•••• {connection.tokenLast4}</dd>
        </div>
        <div>
          <dt className="text-text-muted">Last verified</dt>
          <dd className="text-text">
            {connection.lastVerifiedAt ? new Date(connection.lastVerifiedAt).toLocaleString() : "Never"}
          </dd>
        </div>
        {connection.lastError && (
          <div>
            <dt className="text-text-muted">Last error</dt>
            <dd className="text-danger">{connection.lastError}</dd>
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
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus-visible:outline-none"
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

      <div className="flex gap-2">
        <Button type="button" variant="secondary" loading={verifying} onClick={handleVerify}>
          Reverify access
        </Button>
        <Button type="button" variant="danger" loading={disconnecting} onClick={handleDisconnect}>
          Disconnect
        </Button>
      </div>
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

  const fetchConnection = useCallback(() => {
    getRepositoryConnectionRequest(projectId)
      .then(({ connection }) => {
        setState(connection ? { status: "connected", connection } : { status: "disconnected" });
      })
      .catch(() =>
        setState({ status: "error", message: "Couldn't load the repository connection." }),
      );
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
      <EmptyState
        title="No repository connected"
        description="Connect a GitHub repository using a personal access token you generate yourself — DevForge never invents or assumes one exists."
        action={<ConnectForm onSubmit={handleConnect} submitting={connecting} error={connectError} />}
      />
    );
  }

  return (
    <ConnectedView
      key={state.connection.id}
      projectId={projectId}
      connection={state.connection}
      onChanged={handleChanged}
    />
  );
}
