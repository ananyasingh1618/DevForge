// Fixture file for DevForge's evaluation dataset (Phase 13, hidden-style
// anti-overfitting fixture). Small, synthetic, non-sensitive sample code.
// Deliberately flawed: fetchSupplierPrice treats a 404 as a real $0 price
// instead of a missing-item error.

type SupplierApi = { get: (path: string) => Promise<{ status: number; body: { priceCents: number } }> };
declare const supplierApi: SupplierApi;

/**
 * Fetches the current wholesale price for a SKU from the supplier's API.
 * Does not check the response status — a 404 (SKU not carried by this
 * supplier) is silently treated as a real price of $0 rather than an
 * error, which could cause a $0 wholesale cost to be used in a purchase
 * order.
 */
export async function fetchSupplierPrice(sku: string): Promise<number> {
  const response = await supplierApi.get(`/prices/${sku}`);
  return response.body.priceCents;
}
