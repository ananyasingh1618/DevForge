import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "./Button.js";
import { useAuth } from "../hooks/useAuth.js";

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
          <Link to="/projects" className="text-sm font-semibold tracking-tight text-text">
            DevForge
          </Link>
          <div className="flex min-w-0 items-center gap-3">
            <Link to="/evaluations" className="text-sm text-text-muted hover:text-text">
              Evaluations
            </Link>
            {user && <span className="max-w-[160px] truncate text-sm text-text-muted">{user.email}</span>}
            <Button variant="ghost" onClick={handleLogout}>
              Log out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
