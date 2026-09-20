import { Link } from "react-router-dom";
import { AppShell } from "../components/AppShell.js";
import { Button } from "../components/Button.js";
import { EmptyState } from "../components/StateViews.js";
import { IconAlertCircle } from "../components/icons.js";

export function NotFound() {
  return (
    <AppShell>
      <div className="flex min-h-[60vh] items-center justify-center">
        <EmptyState
          icon={<IconAlertCircle className="h-5 w-5" />}
          title="Page not found"
          description="The page you're looking for doesn't exist, or the link may be out of date."
          action={
            <Link to="/projects">
              <Button type="button">Back to projects</Button>
            </Link>
          }
        />
      </div>
    </AppShell>
  );
}
