// Fixture file for DevForge's evaluation dataset (Phase 13). Small, synthetic,
// non-sensitive sample code written for this dataset — not copied from any
// real project. Deliberately clean utility file, plain JavaScript.

/**
 * Formats a price given in integer cents as a "$X.YZ" string.
 */
function formatPrice(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Applies a tax rate (as a decimal fraction) to a price in cents, rounding
 * to the nearest cent.
 */
function applyTax(cents, rate) {
  return Math.round(cents * (1 + rate));
}

module.exports = { formatPrice, applyTax };
