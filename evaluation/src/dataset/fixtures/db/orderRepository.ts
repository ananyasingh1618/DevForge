// Fixture file for DevForge's evaluation dataset (Phase 13). Small, synthetic,
// non-sensitive sample code written for this dataset — not copied from any
// real project. Both queries here are correctly parameterized (unlike
// db/userRepository.ts's deliberately vulnerable findUserByEmail) — this
// file exercises the "database access" category with a clean example.

export type Order = {
  id: string;
  userId: string;
  status: "pending" | "paid" | "shipped" | "cancelled";
};

type FakeDb = { query: (sql: string, params: unknown[]) => Promise<Order[]> };
declare const db: FakeDb;

/**
 * Loads every order placed by a given user, ordered newest first. Uses a
 * parameterized query — the userId is never concatenated into the SQL text.
 */
export async function findOrdersByUserId(userId: string): Promise<Order[]> {
  return db.query("SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC", [userId]);
}

/**
 * Loads every order in a given status, used by the admin dashboard. Also
 * parameterized.
 */
export async function findOrdersByStatus(status: Order["status"]): Promise<Order[]> {
  return db.query("SELECT * FROM orders WHERE status = $1", [status]);
}
