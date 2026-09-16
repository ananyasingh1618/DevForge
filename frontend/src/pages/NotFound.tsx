import { Link } from "react-router-dom";
import { AppShell } from "../components/AppShell.js";
import { Button } from "../components/Button.js";
import { EmptyState } from "../components/StateViews.js";

export function NotFound() {
  return (
    <AppShell>
      <EmptyState
        title="Page not found"
        description="The page you're looking for doesn't exist, or the link may be out of date."
        action={
          <Link to="/projects">
            <Button type="button">Back to projects</Button>
          </Link>
        }
      />
    </AppShell>
  );
}
