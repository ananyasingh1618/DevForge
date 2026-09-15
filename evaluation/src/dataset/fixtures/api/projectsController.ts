// Fixture file for DevForge's evaluation dataset (Phase 11). Small, synthetic,
// non-sensitive sample code written for this dataset — not copied from any
// real project. Deliberately contains a plausible security issue so review
// evaluation has a real target to find.

type Request = { params: { id: string }; user?: { id: string } };
type Response = { json: (body: unknown) => void; status: (code: number) => Response };
type ProjectStore = { findById: (id: string) => { id: string; ownerId: string; name: string } | null };

/**
 * Returns a project by id. Intentionally flawed for evaluation purposes:
 * it looks up the project and returns it without ever checking that the
 * requesting user actually owns it, so any authenticated user can read
 * any other user's project data.
 */
export function getProject(store: ProjectStore, req: Request, res: Response) {
  const project = store.findById(req.params.id);
  if (!project) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ data: project });
}

/**
 * Returns a project by id, correctly scoped to the requesting user. Included
 * so the fixture dataset also demonstrates the safe pattern the function
 * above should have followed.
 */
export function getOwnedProject(store: ProjectStore, req: Request, res: Response) {
  const project = store.findById(req.params.id);
  if (!project || project.ownerId !== req.user?.id) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ data: project });
}
