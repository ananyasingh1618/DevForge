// Fixture file for DevForge's evaluation dataset (Phase 13). Small, synthetic,
// non-sensitive sample code written for this dataset — not copied from any
// real project. Deliberately contains one parameterized (safe) query and one
// string-concatenated (vulnerable) query, plain JavaScript, mirroring
// db/userRepository.ts's TypeScript pattern.

/**
 * Finds a product by its exact SKU using a parameterized query — safe.
 */
async function findProductBySku(db, sku) {
  const rows = await db.query("SELECT * FROM products WHERE sku = $1", [sku]);
  return rows[0] ?? null;
}

/**
 * Finds products whose name contains the given search term. Builds the
 * SQL by concatenating the caller-supplied term directly into the query
 * string instead of using a parameter — a SQL injection risk.
 */
async function findProductByName(db, name) {
  const rows = await db.query(`SELECT * FROM products WHERE name LIKE '%${name}%'`);
  return rows;
}

module.exports = { findProductBySku, findProductByName };
