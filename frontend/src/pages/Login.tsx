import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "../components/Button.js";
import { Input } from "../components/Input.js";
import { Card } from "../components/Card.js";
import { IconSparkles } from "../components/icons.js";
import { useAuth } from "../hooks/useAuth.js";
import { ApiError } from "../services/apiClient.js";

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await login({ email, password });
      navigate("/projects", { replace: true });
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : "Something went wrong. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-16">
      <div className="animate-fade-in flex flex-col gap-6">
        <div className="flex items-center justify-center gap-2 text-text">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-accent-fg">
            <IconSparkles className="h-5 w-5" />
          </span>
          <span className="text-[17px] font-semibold tracking-tight">DevForge</span>
        </div>

        <Card>
          <h1 className="text-xl font-semibold text-text">Log in</h1>
          <p className="mt-1 text-sm text-text-muted">Welcome back to DevForge.</p>

          <form className="mt-6 flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
            <Input
              label="Email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Input
              label="Password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />

            {formError && (
              <p className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
                {formError}
              </p>
            )}

            <Button type="submit" loading={submitting} className="mt-2 w-full">
              Log in
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-text-muted">
            Don&rsquo;t have an account?{" "}
            <Link to="/register" className="font-medium text-accent hover:underline">
              Create one
            </Link>
          </p>
        </Card>
      </div>
    </div>
  );
}
