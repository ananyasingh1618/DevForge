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
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link to="/projects" className="text-sm font-semibold tracking-tight text-text">
            DevForge
          </Link>
          <div className="flex items-center gap-3">
            {user && <span className="text-sm text-text-muted">{user.email}</span>}
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
