import { Route, Routes } from "react-router-dom";
import { Button } from "./components/Button.js";
import { Card } from "./components/Card.js";
import { Input } from "./components/Input.js";

// Placeholder home route for Milestone 8 (design-system scaffold only).
// Register/login/projects routes are added in Milestones 9-10.
function Home() {
  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-8 px-4 py-16">
      <div className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-text">DevForge</h1>
        <p className="mt-2 text-sm text-text-muted">
          AI Software Engineering &amp; Codebase Intelligence Platform — foundation phase.
        </p>
      </div>

      <Card className="w-full max-w-sm">
        <h2 className="text-sm font-medium text-text">Design system check</h2>
        <p className="mt-1 text-xs text-text-muted">
          Confirms tokens, focus states, and component styling before wiring real pages.
        </p>
        <div className="mt-4 flex flex-col gap-4">
          <Input label="Email" type="email" placeholder="you@example.com" hint="Not wired up yet." />
          <div className="flex gap-2">
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
    </Routes>
  );
}
