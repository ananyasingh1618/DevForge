import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import { useAuth } from "../hooks/useAuth.js";
import { getRepositoryConnectionRequest } from "../services/repositoryApi.js";
import { getCodebaseIndexRequest } from "../services/codebaseIndexApi.js";
import { listJobsRequest } from "../services/jobsApi.js";
import type { RepositoryConnection } from "../types/repository.js";
import type { CodebaseIndex } from "../types/codebaseIndex.js";
import type { Job, JobType } from "../types/job.js";
import { CommandPalette } from "./CommandPalette.js";
import { ProjectSwitcher } from "./ProjectSwitcher.js";
import { StatusIndicator } from "./StatusIndicator.js";
import { Tooltip } from "./Tooltip.js";
import {
  IconClose,
  IconCommand,
  IconDatabase,
  IconFileText,
  IconGithub,
  IconListChecks,
  IconLogOut,
  IconMenu,
  IconMessage,
  IconOverview,
  IconSearch,
  IconSettings,
  IconShieldCheck,
  IconSparkles,
  IconUser,
} from "./icons.js";
import type { IconProps } from "./icons.js";

type NavItem = { label: string; to: string; icon: (props: IconProps) => ReactNode; end?: boolean };
type NavGroup = { label: string; items: NavItem[] };

function projectNavGroups(projectId: string): NavGroup[] {
  return [
    {
      label: "Workspace",
      items: [
        { label: "Overview", to: `/projects/${projectId}`, icon: IconOverview, end: true },
        { label: "Requirements", to: `/projects/${projectId}/requirements`, icon: IconFileText },
      ],
    },
    {
      label: "Intelligence",
      items: [
        { label: "Repository", to: `/projects/${projectId}/repository`, icon: IconGithub },
        { label: "Indexing", to: `/projects/${projectId}/indexing`, icon: IconDatabase },
        { label: "Q&A", to: `/projects/${projectId}/qa`, icon: IconMessage },
        { label: "Code Review", to: `/projects/${projectId}/reviews`, icon: IconShieldCheck },
      ],
    },
    {
      label: "Engineering",
      items: [{ label: "Jobs", to: `/projects/${projectId}/jobs`, icon: IconListChecks }],
    },
    {
      label: "System",
      items: [{ label: "Settings", to: `/projects/${projectId}/settings`, icon: IconSettings }],
    },
  ];
}

function NavLinkRow({ item, onNavigate }: { item: NavItem; onNavigate: () => void }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) =>
        "group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors " +
        (isActive ? "bg-accent-soft text-accent" : "text-text-muted hover:bg-surface-2 hover:text-text")
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <motion.span
              layoutId="nav-active-indicator"
              className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-accent"
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            />
          )}
          <Icon className="h-4 w-4 shrink-0" />
          <span className="truncate">{item.label}</span>
        </>
      )}
    </NavLink>
  );
}

/** Fetches this project's real repository/indexing/job state for the top
 * bar's status pills and the command palette — polls the job list only
 * while a job is actually queued or running, mirroring the Jobs page's
 * own safe-polling pattern rather than a second, divergent one. The
 * caller remounts this (via `key={projectId}`) on project change, so it
 * never needs to reset its own state mid-life. */
function useProjectStatus(projectId: string) {
  const [connection, setConnection] = useState<RepositoryConnection | null | undefined>(undefined);
  const [index, setIndex] = useState<CodebaseIndex | null | undefined>(undefined);
  const [jobs, setJobs] = useState<Job[] | undefined>(undefined);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ref-based self-reference (not a direct closure call) avoids a
  // temporal-dead-zone issue while still letting the scheduled callback
  // always call the latest version — same technique as Jobs.tsx's
  // pollWhileActiveRef.
  const refreshJobsRef = useRef<() => void>(() => {});
  const refreshJobs = useCallback(() => {
    listJobsRequest(projectId)
      .then(({ jobs: fetched }) => {
        setJobs(fetched);
        const active = fetched.some((j) => j.status === "queued" || j.status === "running");
        if (active) {
          pollTimer.current = setTimeout(() => refreshJobsRef.current(), 4000);
        }
      })
      .catch(() => {});
  }, [projectId]);

  useEffect(() => {
    refreshJobsRef.current = refreshJobs;
  }, [refreshJobs]);

  useEffect(() => {
    getRepositoryConnectionRequest(projectId)
      .then(({ connection: c }) => {
        setConnection(c);
        // Mirrors the per-page gating (Q&A/Review/Search all skip the index
        // lookup with no repository connected) — checking indexing status
        // before a repository exists isn't meaningful and would be an
        // extra, pointless request on every project-scoped page.
        if (!c) {
          setIndex(null);
          return;
        }
        getCodebaseIndexRequest(projectId)
          .then(({ index: i }) => setIndex(i))
          .catch(() => setIndex(null));
      })
      .catch(() => {
        setConnection(null);
        setIndex(null);
      });
    refreshJobs();
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshJobs is stable for a given projectId
  }, [projectId]);

  const activeJob = jobs?.find((j) => j.status === "queued" || j.status === "running") ?? null;

  return { connection, index, activeJob };
}

// Fixed display labels — matches the Jobs page's own TYPE_LABEL map, so
// a job's type reads the same way everywhere it appears (never a raw
// enum value run through CSS capitalize(), which turned "qa" into "Qa").
const JOB_TYPE_LABEL: Record<JobType, string> = {
  indexing: "Indexing",
  qa: "Q&A",
  review: "Code Review",
  evaluation: "Evaluation",
};

function TopBarStatus({ projectId }: { projectId: string }) {
  const { connection, index, activeJob } = useProjectStatus(projectId);

  return (
    <div className="hidden items-center gap-4 lg:flex">
      <StatusIndicator
        tone={connection ? "success" : "neutral"}
        label={connection ? "Repository connected" : "No repository"}
      />
      <StatusIndicator
        tone={index?.status === "completed" ? "success" : index?.status === "failed" ? "danger" : index?.status === "indexing" ? "accent" : "neutral"}
        pulse={index?.status === "indexing"}
        label={
          index?.status === "completed"
            ? "Indexed"
            : index?.status === "indexing"
              ? "Indexing…"
              : index?.status === "failed"
                ? "Indexing failed"
                : "Not indexed"
        }
      />
      <StatusIndicator
        tone={activeJob ? "accent" : "neutral"}
        pulse={Boolean(activeJob)}
        label={activeJob ? `${JOB_TYPE_LABEL[activeJob.type]} running` : "No active jobs"}
      />
    </div>
  );
}

function SidebarContent({
  projectId,
  projectName,
  onNavigate,
}: {
  projectId?: string;
  projectName?: string;
  onNavigate: () => void;
}) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
        <Link to="/projects" className="flex shrink-0 items-center gap-2 text-text" onClick={onNavigate}>
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-accent-fg">
            <IconSparkles className="h-4 w-4" />
          </span>
        </Link>
        <span className="text-[15px] font-semibold tracking-tight text-text">DevForge</span>
      </div>

      {projectId && (
        <div className="shrink-0 border-b border-border p-2.5">
          <ProjectSwitcher currentProjectId={projectId} currentProjectName={projectName} onNavigate={onNavigate} />
        </div>
      )}

      <nav className="flex-1 overflow-y-auto px-3 py-3">
        {projectId ? (
          <div className="flex flex-col gap-4">
            {projectNavGroups(projectId).map((group) => (
              <div key={group.label}>
                <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wide text-text-faint">
                  {group.label}
                </p>
                <div className="flex flex-col gap-0.5">
                  {group.items.map((item) => (
                    <NavLinkRow key={item.to} item={item} onNavigate={onNavigate} />
                  ))}
                </div>
              </div>
            ))}
            <div>
              <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wide text-text-faint">Account</p>
              <div className="flex flex-col gap-0.5">
                <NavLinkRow item={{ label: "Evaluations", to: "/evaluations", icon: IconListChecks }} onNavigate={onNavigate} />
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            <NavLinkRow item={{ label: "Projects", to: "/projects", icon: IconOverview, end: true }} onNavigate={onNavigate} />
            <NavLinkRow item={{ label: "Evaluations", to: "/evaluations", icon: IconListChecks }} onNavigate={onNavigate} />
          </div>
        )}
      </nav>

      <div className="shrink-0 border-t border-border p-3">
        <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-3 text-text-muted">
            <IconUser className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-text">{user?.name || user?.email}</p>
          </div>
          <Tooltip label="Log out">
            <button
              type="button"
              onClick={() => void handleLogout()}
              aria-label="Log out"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-faint transition-colors hover:bg-surface-2 hover:text-text"
            >
              <IconLogOut className="h-4 w-4" />
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

export function AppShell({
  children,
  projectId,
  projectName,
}: {
  children: ReactNode;
  projectId?: string;
  projectName?: string;
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="min-h-screen bg-bg">
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} projectId={projectId} />

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-60 border-r border-border bg-surface md:block">
        <SidebarContent projectId={projectId} projectName={projectName} onNavigate={() => {}} />
      </aside>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileNavOpen && (
          <motion.div
            className="fixed inset-0 z-40 md:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <button
              type="button"
              aria-label="Close navigation"
              className="absolute inset-0 bg-black/60"
              onClick={() => setMobileNavOpen(false)}
            />
            <motion.div
              className="relative flex h-full w-64 flex-col bg-surface shadow-[var(--shadow-elevated)]"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            >
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                aria-label="Close navigation"
                className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-2"
              >
                <IconClose className="h-4 w-4" />
              </button>
              <SidebarContent
                projectId={projectId}
                projectName={projectName}
                onNavigate={() => setMobileNavOpen(false)}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface/95 px-4 backdrop-blur md:pl-60 lg:px-6">
        <button
          type="button"
          onClick={() => setMobileNavOpen(true)}
          aria-label="Open navigation"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-surface-2 md:hidden"
        >
          <IconMenu className="h-5 w-5" />
        </button>
        <span className="text-sm font-semibold text-text md:hidden">DevForge</span>

        {projectId && (
          <div className="hidden md:block">
            <TopBarStatus key={projectId} projectId={projectId} />
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Tooltip label="Command palette" shortcut="⌘K">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-xs text-text-muted transition-colors hover:border-border-strong hover:text-text"
            >
              <IconSearch className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Search</span>
              <span className="hidden items-center gap-0.5 rounded border border-border-strong bg-surface px-1 py-0.5 text-[10px] text-text-faint sm:flex">
                <IconCommand className="h-2.5 w-2.5" />K
              </span>
            </button>
          </Tooltip>
        </div>
      </header>

      <main className="md:pl-60">
        <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">{children}</div>
      </main>
    </div>
  );
}
