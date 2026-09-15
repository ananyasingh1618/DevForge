// Fixture file for DevForge's evaluation dataset (Phase 13). Small, synthetic,
// non-sensitive sample code written for this dataset — not copied from any
// real project. Deliberately contains a plausible authorization bug in
// getOrder, and a correct counterpart in getOwnedOrder, mirroring
// api/projectsController.ts's TypeScript pattern in plain JavaScript.

/**
 * Loads an order by id and returns it directly. Does not check that the
 * requester owns the order — any authenticated user can read any order.
 */
async function getOrder(db, req) {
  const order = await db.orders.findById(req.params.id);
  return order;
}

/**
 * Loads an order by id and verifies the requester owns it before
 * returning it — the safe counterpart to getOrder above.
 */
async function getOwnedOrder(db, req) {
  const order = await db.orders.findById(req.params.id);
  if (!order || order.userId !== req.user.id) {
    throw new Error("Not found");
  }
  return order;
}

module.exports = { getOrder, getOwnedOrder };
