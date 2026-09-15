// Fixture file for DevForge's evaluation dataset (Phase 13). Small, synthetic,
// non-sensitive sample code written for this dataset — not copied from any
// real project. Exercises the "data flow" retrieval category: this
// function's output feeds directly into services/orderProcessor.ts's
// processOrder.

import type { OrderItem } from "../services/orderProcessor.js";

/**
 * Normalizes a raw, untyped order payload (as received from an HTTP
 * request body) into the shape processOrder expects: trims string fields,
 * coerces quantity/price to numbers, and drops unknown keys. The first
 * step in the order-processing data flow — its output is passed directly
 * into validateOrderItems and calculateOrderTotal.
 */
export function normalizeOrderPayload(raw: unknown): { items: OrderItem[] } {
  const input = raw as { items?: unknown[] } | null;
  const items = Array.isArray(input?.items) ? input.items : [];
  return {
    items: items.map((item) => {
      const i = item as Record<string, unknown>;
      return {
        sku: String(i["sku"] ?? "").trim().toUpperCase(),
        quantity: Number(i["quantity"] ?? 0),
        unitPriceCents: Number(i["unitPriceCents"] ?? 0),
      };
    }),
  };
}
