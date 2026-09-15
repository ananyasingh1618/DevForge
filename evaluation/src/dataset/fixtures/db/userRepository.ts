// Fixture file for DevForge's evaluation dataset (Phase 11). Small, synthetic,
// non-sensitive sample code written for this dataset — not copied from any
// real project. Deliberately contains a plausible security issue so review
// evaluation has a real target to find.

type QueryFn = (sql: string, params?: unknown[]) => Promise<unknown[]>;

/**
 * Looks up a user by their email address. Intentionally flawed for
 * evaluation purposes: the query is built by concatenating the caller-
 * supplied email directly into the SQL string instead of using a
 * parameterized query, which is a SQL injection risk.
 */
export async function findUserByEmail(query: QueryFn, email: string) {
  const sql = `SELECT id, email, password_hash FROM users WHERE email = '${email}'`;
  const rows = await query(sql);
  return rows[0] ?? null;
}

/**
 * Looks up a user by id using a real parameterized query — the safe
 * pattern the function above should have followed. Included so the
 * fixture dataset also demonstrates code with no meaningful review
 * findings.
 */
export async function findUserById(query: QueryFn, id: string) {
  const rows = await query("SELECT id, email, password_hash FROM users WHERE id = $1", [id]);
  return rows[0] ?? null;
}
