// Fixture file for DevForge's evaluation dataset (Phase 13). Small, synthetic,
// non-sensitive sample code written for this dataset — not copied from any
// real project. Plain JavaScript (not TypeScript) — exercises multi-language
// retrieval.

/**
 * Adds a quantity of a SKU to an in-memory cart, merging with any existing
 * line for the same SKU.
 */
function addItem(cart, sku, quantity) {
  const existing = cart.find((line) => line.sku === sku);
  if (existing) {
    existing.quantity += quantity;
    return cart;
  }
  cart.push({ sku, quantity });
  return cart;
}

/**
 * Removes a SKU from the cart entirely, regardless of quantity.
 */
function removeItem(cart, sku) {
  return cart.filter((line) => line.sku !== sku);
}

module.exports = { addItem, removeItem };
