// Fixture file for DevForge's evaluation dataset (Phase 13, hidden-style
// anti-overfitting fixture — see docs/BENCHMARK_EXPANSION_PHASE_PLAN.md,
// "Anti-overfitting controls"). Small, synthetic, non-sensitive sample
// code written after Phase 13/14's ranking and grounding work was already
// finalized, in a domain (warehouse inventory) unrelated to every other
// fixture file, specifically to check the system generalizes rather than
// being tuned to the rest of this dataset's own content.

const stock = new Map<string, number>();

/**
 * Reserves a quantity of a SKU from available stock, throwing if there
 * isn't enough on hand.
 */
export function reserveStock(sku: string, quantity: number): void {
  const available = stock.get(sku) ?? 0;
  if (available < quantity) {
    throw new Error(`Insufficient stock for ${sku}: have ${available}, need ${quantity}`);
  }
  stock.set(sku, available - quantity);
}

/**
 * Releases a previously reserved quantity of a SKU back into available
 * stock.
 */
export function releaseStock(sku: string, quantity: number): void {
  stock.set(sku, (stock.get(sku) ?? 0) + quantity);
}
