import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Modal } from "./Modal.js";
import {
  IconDatabase,
  IconFileText,
  IconFolder,
  IconGithub,
  IconListChecks,
  IconMessage,
  IconOverview,
  IconPlus,
  IconSearch,
  IconSettings,
  IconShieldCheck,
} from "./icons.js";
import type { IconProps } from "./icons.js";

type Command = {
  id: string;
  label: string;
  /** Extra search terms beyond the label itself — e.g. "qa" as an alias
   * for "Q&A", since a plain substring match on the label would miss it
   * (the "&" breaks the substring). */
  keywords?: string[];
  group: "Navigate" | "Actions";
  icon: (props: IconProps) => React.ReactNode;
  run: (navigate: ReturnType<typeof useNavigate>) => void;
};

/** The command palette's action list is built from real, working routes
 * and calls only — no placeholder or aspirational entries. Project-scoped
 * navigation only appears when a project is actually selected. */
function buildCommands(projectId: string | undefined): Command[] {
  const commands: Command[] = [
    { id: "projects", label: "Go to Projects", group: "Navigate", icon: IconFolder, run: (n) => n("/projects") },
    { id: "new-project", label: "Create Project", group: "Actions", icon: IconPlus, run: (n) => n("/projects/new") },
  ];

  if (projectId) {
    commands.push(
      { id: "overview", label: "Go to Overview", group: "Navigate", icon: IconOverview, run: (n) => n(`/projects/${projectId}`) },
      { id: "requirements", label: "Go to Requirements", group: "Navigate", icon: IconFileText, run: (n) => n(`/projects/${projectId}/requirements`) },
      { id: "repository", label: "Go to Repository", group: "Navigate", icon: IconGithub, run: (n) => n(`/projects/${projectId}/repository`) },
      { id: "indexing", label: "Go to Indexing", group: "Navigate", icon: IconDatabase, run: (n) => n(`/projects/${projectId}/indexing`) },
      { id: "qa", label: "Go to Q&A", keywords: ["qa", "question", "ask"], group: "Navigate", icon: IconMessage, run: (n) => n(`/projects/${projectId}/qa`) },
      { id: "review", label: "Go to Code Review", keywords: ["review"], group: "Navigate", icon: IconShieldCheck, run: (n) => n(`/projects/${projectId}/reviews`) },
      { id: "jobs", label: "Go to Jobs", group: "Navigate", icon: IconListChecks, run: (n) => n(`/projects/${projectId}/jobs`) },
      { id: "settings", label: "Go to Settings", group: "Navigate", icon: IconSettings, run: (n) => n(`/projects/${projectId}/settings`) },
      { id: "connect-repo", label: "Connect Repository", group: "Actions", icon: IconGithub, run: (n) => n(`/projects/${projectId}/repository`) },
    );
  }

  return commands;
}

export function CommandPalette({
  open,
  onClose,
  projectId,
}: {
  open: boolean;
  onClose: () => void;
  projectId?: string;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo(() => buildCommands(projectId), [projectId]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (c) => c.label.toLowerCase().includes(q) || c.keywords?.some((k) => k.includes(q)),
    );
  }, [commands, query]);

  // Reset the query and highlighted row whenever the palette opens, and
  // re-clamp the highlighted row whenever the query changes — done during
  // render (React's documented pattern for "adjust state when a prop
  // changes") rather than in an effect, so there's no extra render pass.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setQuery("");
      setActiveIndex(0);
    }
  }
  const [prevQuery, setPrevQuery] = useState(query);
  if (query !== prevQuery) {
    setPrevQuery(query);
    setActiveIndex(0);
  }

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  function runCommand(cmd: Command) {
    cmd.run(navigate);
    onClose();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = filtered[activeIndex];
      if (cmd) runCommand(cmd);
    }
  }

  const seenGroups = new Set<string>();
  const rows = filtered.map((cmd) => {
    const showGroupLabel = !seenGroups.has(cmd.group);
    seenGroups.add(cmd.group);
    return { cmd, showGroupLabel };
  });

  return (
    <Modal open={open} onClose={onClose} widthClassName="max-w-xl">
      <div className="flex flex-col" onKeyDown={handleKeyDown}>
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-3.5">
          <IconSearch className="h-4 w-4 shrink-0 text-text-faint" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command or search…"
            aria-label="Command palette"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-list"
            className="w-full bg-transparent text-sm text-text placeholder:text-text-faint focus-visible:outline-none"
          />
          <kbd className="shrink-0 rounded border border-border-strong bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-text-faint">
            Esc
          </kbd>
        </div>

        <ul id="command-palette-list" role="listbox" className="max-h-80 overflow-y-auto p-2">
          {filtered.length === 0 && (
            <li className="px-3 py-8 text-center text-sm text-text-muted">No matching commands.</li>
          )}
          {rows.map(({ cmd, showGroupLabel }, i) => {
            const Icon = cmd.icon;
            return (
              <li key={cmd.id}>
                {showGroupLabel && (
                  <p className="mb-1 mt-2 px-2.5 text-[11px] font-semibold uppercase tracking-wide text-text-faint first:mt-0">
                    {cmd.group}
                  </p>
                )}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === activeIndex}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => runCommand(cmd)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                    i === activeIndex ? "bg-accent-soft text-accent" : "text-text hover:bg-surface-2"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {cmd.label}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </Modal>
  );
}
