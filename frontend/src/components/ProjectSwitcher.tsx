import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { listProjectsRequest } from "../services/projectsApi.js";
import type { Project } from "../types/project.js";
import { IconChevronsUpDown, IconFolder, IconPlus } from "./icons.js";

/** A compact project switcher for the sidebar header — lists the user's
 * real projects (fetched on open, not preloaded/faked) and links straight
 * into each one's Overview page, plus a real "New project" action. */
export function ProjectSwitcher({
  currentProjectId,
  currentProjectName,
  onNavigate,
}: {
  currentProjectId?: string;
  currentProjectName?: string;
  onNavigate?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open || projects !== null) return;
    listProjectsRequest()
      .then(({ projects: fetched }) => setProjects(fetched))
      .catch(() => setError("Couldn't load projects."));
  }, [open, projects]);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-2"
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface-3 text-text-muted">
          <IconFolder className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text">
          {currentProjectName ?? "Switch project"}
        </span>
        <IconChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-text-faint" />
      </button>

      {open && (
        <div className="animate-fade-in absolute left-0 right-0 top-full z-50 mt-1.5 overflow-hidden rounded-lg border border-border bg-surface-2 shadow-[var(--shadow-popover)]">
          <ul role="listbox" className="max-h-64 overflow-y-auto p-1.5">
            {projects === null && !error && (
              <li className="px-2.5 py-2 text-xs text-text-muted">Loading…</li>
            )}
            {error && <li className="px-2.5 py-2 text-xs text-danger">{error}</li>}
            {projects?.length === 0 && (
              <li className="px-2.5 py-2 text-xs text-text-muted">No projects yet.</li>
            )}
            {projects?.map((project) => (
              <li key={project.id}>
                <Link
                  to={`/projects/${project.id}`}
                  onClick={() => {
                    setOpen(false);
                    onNavigate?.();
                  }}
                  className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] transition-colors ${
                    project.id === currentProjectId
                      ? "bg-accent-soft text-accent"
                      : "text-text hover:bg-surface-3"
                  }`}
                >
                  <span className="truncate">{project.name}</span>
                </Link>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onNavigate?.();
              navigate("/projects/new");
            }}
            className="flex w-full items-center gap-2 border-t border-border px-3.5 py-2.5 text-[13px] font-medium text-text-muted transition-colors hover:bg-surface-3 hover:text-text"
          >
            <IconPlus className="h-3.5 w-3.5" />
            New project
          </button>
        </div>
      )}
    </div>
  );
}
