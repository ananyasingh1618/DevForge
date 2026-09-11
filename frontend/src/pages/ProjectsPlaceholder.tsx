import { useNavigate } from "react-router-dom";
import { Button } from "../components/Button.js";
import { useAuth } from "../hooks/useAuth.js";

// Temporary stand-in for the real Projects page (Milestone 10). Exists so
// Milestone 9's register/login flow has somewhere real to land and can be
// verified end-to-end on its own, without pretending project management
// already works.
export function ProjectsPlaceholder() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-xl font-semibold text-text">You&rsquo;re logged in</h1>
      <p className="text-sm text-text-muted">
        Signed in as <span className="text-text">{user?.email}</span>. The project workspace
        (create/list/overview) is built next.
      </p>
      <Button variant="secondary" onClick={handleLogout}>
        Log out
      </Button>
    </div>
  );
}
