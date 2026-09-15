// Fixture file for DevForge's evaluation dataset (Phase 13, hidden-style
// anti-overfitting fixture). Small, synthetic, non-sensitive sample code.
// Deliberately clean.

export type InventoryItem = { sku: string; quantityOnHand: number };

/**
 * Returns the subset of items whose quantity on hand is at or below the
 * given low-stock threshold, sorted by quantity ascending.
 */
export function summarizeLowStockItems(items: InventoryItem[], threshold: number): InventoryItem[] {
  return items
    .filter((item) => item.quantityOnHand <= threshold)
    .sort((a, b) => a.quantityOnHand - b.quantityOnHand);
}
