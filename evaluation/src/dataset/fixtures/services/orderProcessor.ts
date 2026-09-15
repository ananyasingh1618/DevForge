// Fixture file for DevForge's evaluation dataset (Phase 13). Small, synthetic,
// non-sensitive sample code written for this dataset — not copied from any
// real project. Exercises parent/neighboring-symbol and data-flow retrieval
// categories: processOrder orchestrates the two functions below it.

import { findOrdersByUserId } from "../db/orderRepository.js";
import { normalizeOrderPayload } from "../utils/dataTransform.js";

export type OrderItem = {
  sku: string;
  quantity: number;
  unitPriceCents: number;
};

/**
 * Validates that every line item has a positive quantity and a known SKU
 * format before an order can be processed. A neighboring helper called by
 * processOrder below, not meant to be called directly by callers.
 */
export function validateOrderItems(items: OrderItem[]): void {
  for (const item of items) {
    if (item.quantity <= 0) {
      throw new Error(`Invalid quantity for SKU ${item.sku}`);
    }
    if (!/^[A-Z0-9-]{4,20}$/.test(item.sku)) {
      throw new Error(`Invalid SKU format: ${item.sku}`);
    }
  }
}

/**
 * Sums each line item's unit price times quantity. A second neighboring
 * helper called by processOrder below.
 */
export function calculateOrderTotal(items: OrderItem[]): number {
  return items.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
}

/**
 * Orchestrates end-to-end order processing: normalizes the raw payload,
 * validates line items, computes the total, and loads the user's existing
 * orders for a duplicate-order check. The parent symbol that ties
 * validateOrderItems and calculateOrderTotal together — a query about "how
 * is an order processed" should surface this function, while a query about
 * one specific step should surface the neighboring helper instead.
 */
export async function processOrder(userId: string, rawPayload: unknown): Promise<{ total: number }> {
  const payload = normalizeOrderPayload(rawPayload);
  validateOrderItems(payload.items);
  const total = calculateOrderTotal(payload.items);
  await findOrdersByUserId(userId);
  return { total };
}
