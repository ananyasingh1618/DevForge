// Fixture file for DevForge's evaluation dataset (Phase 13). Small, synthetic,
// non-sensitive sample code written for this dataset — not copied from any
// real project. Exercises the "cross-file dependency" / "imported functions"
// retrieval categories: this module exists only to import and re-export
// cartService's functions under a public-facing name.

const { addItem, removeItem } = require("./cartService");

/**
 * Public entry point for adding an item to the cart — delegates entirely
 * to cartService's addItem.
 */
function addToCart(cart, sku, quantity) {
  return addItem(cart, sku, quantity);
}

/**
 * Public entry point for removing an item from the cart — delegates
 * entirely to cartService's removeItem.
 */
function removeFromCart(cart, sku) {
  return removeItem(cart, sku);
}

module.exports = { addToCart, removeFromCart };
