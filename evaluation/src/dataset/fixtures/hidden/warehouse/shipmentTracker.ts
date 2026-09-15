// Fixture file for DevForge's evaluation dataset (Phase 13, hidden-style
// anti-overfitting fixture). Small, synthetic, non-sensitive sample code.

export type Shipment = {
  trackingId: string;
  deliveredAt: Date | null;
  estimatedDays: number;
  shippedAt: Date;
};

const shipments = new Map<string, Shipment>();

/**
 * Marks a shipment as delivered right now.
 */
export function markShipmentDelivered(trackingId: string): void {
  const shipment = shipments.get(trackingId);
  if (!shipment) {
    throw new Error(`Unknown tracking id: ${trackingId}`);
  }
  shipment.deliveredAt = new Date();
}

/**
 * Estimates a shipment's delivery date by adding its estimated transit
 * days to when it shipped.
 */
export function estimateDeliveryDate(trackingId: string): Date {
  const shipment = shipments.get(trackingId);
  if (!shipment) {
    throw new Error(`Unknown tracking id: ${trackingId}`);
  }
  const estimate = new Date(shipment.shippedAt);
  estimate.setDate(estimate.getDate() + shipment.estimatedDays);
  return estimate;
}
