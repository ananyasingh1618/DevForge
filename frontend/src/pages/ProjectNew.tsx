import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "../components/AppShell.js";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { Input } from "../components/Input.js";
import { createProjectRequest } from "../services/projectsApi.js";
import { ApiError } from "../services/apiClient.js";

export function ProjectNew() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [nameError, setNameError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (name.trim().length === 0) {
      setNameError("Name is required.");
      return;
    }
    setNameError(undefined);

    setSubmitting(true);
    try {
      const { project } = await createProjectRequest({
        name: name.trim(),
        description: description.trim() || undefined,
      });
      navigate(`/projects/${project.id}`, { replace: true });
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : "Something went wrong. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-lg">
        <h1 className="text-lg font-semibold text-text">New project</h1>
        <Card className="mt-4">
          <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
            <Input
              label="Name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={nameError}
            />
            <div className="flex flex-col gap-1.5">
              <label htmlFor="description" className="text-sm font-medium text-text">
                Description (optional)
              </label>
              <textarea
                id="description"
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted focus-visible:outline-none"
              />
            </div>

            {formError && (
              <p className="text-sm text-danger" role="alert">
                {formError}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button type="submit" loading={submitting}>
                Create project
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </AppShell>
  );
}
